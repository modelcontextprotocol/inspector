#!/usr/bin/env node
/**
 * Pack-and-verify: build the exact tarball npm would publish, install it into a
 * clean throwaway consumer, and drive the real `mcp-inspector` bin against that
 * installed package — web, cli, and tui (#1636).
 *
 * Why this exists, and why the `smoke:*` scripts aren't enough: the smokes run
 * against the in-repo build tree (`clients/<name>/build`, `clients/web/dist`) via the
 * launcher's relative paths. That tree is NOT the published package. We have
 * repeatedly been bitten by things that work in `--dev` / in-repo yet break for
 * a real consumer running `npx @modelcontextprotocol/inspector …`, because:
 *
 *   - the `files` allowlist (root + each nested client `package.json`) silently
 *     omits something the runtime needs (this is exactly how `clients/web/build`
 *     was missing from the tarball while `clients/web/dist` slipped through);
 *   - path resolution that is correct relative to the repo differs once the code
 *     lives under `node_modules/@modelcontextprotocol/inspector/…`;
 *   - the `postinstall` client-install cascade misbehaves for an end user.
 *
 * This script closes that gap by exercising the package the way npm publishes
 * and a user installs it, end to end. It:
 *
 *   1. builds every client (`npm run build`);
 *   2. packs the publishable tarball (`npm pack`) and inspects its file list —
 *      asserting NO source maps ship and that `clients/web/{build,dist,static}`
 *      are all present (the packaging fixes this work landed);
 *   3. installs that tarball into a fresh temp dir (real `npm install <tgz>`,
 *      which runs the package's `postinstall`);
 *   4. runs the installed `mcp-inspector` bin: `--help`, `--cli`/`--tui` help
 *      dispatch, a real `--cli` `tools/list` over stdio, and a prod `--web` boot
 *      that must serve `/` (HTTP 200) with the injected auth-token global from
 *      the shipped `dist` — all from the INSTALLED location, not the repo;
 *   5. drives the **MCP Apps** path in headless Chromium against that same
 *      installed `--web` server — connect → open app → `data-app-status="ready"`
 *      (#2003). Asserting the sandbox proxy page merely *exists* (step 2/3) is
 *      not the same as loading a widget through it: a rename with a stale
 *      reader, or a wrong position relative to `clients/web/build`, ships a file
 *      that is present and unreachable. The flow is shared with `smoke:web:app`
 *      via `lib/mcp-app-flow.mjs` so the deep-link shape cannot drift between
 *      the repo-tree check and this one.
 *
 * The **client** under test comes from the install; the **test server** stays a
 * repo fixture (`test-servers/build/server-composable.js`) — it is not in the
 * tarball and should not be.
 *
 * Exits non-zero on the first failure. Requires network access (step 3 pulls the
 * package's runtime dependencies from the registry) — it is a local / release
 * verification tool, not part of the fast `validate` loop.
 *
 * Usage: `npm run pack:verify` (from the repo root).
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hasExited, removeSafe, stopChild } from "./lib/child-cleanup.mjs";
import {
  ensureTestServers,
  testServerEntryPath,
} from "./lib/ensure-test-servers.mjs";
import { attachPageDiagnostics, loadBrowser } from "./lib/headless-browser.mjs";
import {
  APP_TOOL,
  buildAppDeepLink,
  driveAppFlow,
  startMcpAppServer,
} from "./lib/mcp-app-flow.mjs";
import { winShellArgs } from "./lib/win-shell-args.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const testServer = testServerEntryPath(repoRoot, "stdio");

// Mirrors INSPECTOR_API_TOKEN_GLOBAL in core/mcp/remote/constants.ts; kept as a
// literal because this plain .mjs script can't import the TS source.
const TOKEN_GLOBAL = "__INSPECTOR_API_TOKEN__";

// Set once the throwaway consumer dir exists. `fail()` is the single
// failure-exit point (called from everywhere, including deep inside the run),
// and it calls process.exit(), which skips any `finally` — so cleanup has to
// happen here, not in a trailing `finally`. On failure we remove the heavy work
// dir (a full node_modules from the real install) but leave the packed tarball
// in place for post-mortem inspection.
let workDir = null;
// The live `--web` child during verifyWeb(), if any. fail() kills it so a
// failure in the web phase doesn't orphan the server — which would linger on
// the port and could even serve a stale false-200 to a later run (verifyWeb's
// own `finally { stop() }` is skipped when fail() calls process.exit()).
let webChild = null;
// The composable MCP App test server spawned for the step-5 App render, if any.
// Same reasoning as `webChild`: fail() calls process.exit(), which skips the
// `finally` that would otherwise stop it, and an orphan holds its port.
let appServerChild = null;

const LABEL = "pack:verify";

function fail(message) {
  console.error(`\npack:verify FAILED — ${message}`);
  // fail() is the single failure-exit point and is called from synchronous
  // contexts (top-level statements, loop bodies), so it cannot await the
  // child's exit the way the success path does — it best-effort signals and
  // moves on. That is why removeSafe() matters most here: this path is already
  // exiting 1, so an ENOTEMPTY could only bury the real diagnostic under an
  // rmSync stack (and skip the "tarball retained" hint below), never turn a
  // green run red.
  for (const child of [webChild, appServerChild]) {
    if (child && !hasExited(child)) {
      child.kill("SIGTERM");
    }
  }
  if (workDir) {
    removeSafe(workDir, { label: LABEL });
    // `tarball` is initialized before `workDir` is ever set, so this is safe.
    console.error(
      `pack:verify — tarball retained for inspection at ${tarball}`,
    );
  }
  process.exit(1);
}

function step(message) {
  console.log(`\npack:verify — ${message}`);
}

// This script keeps `shell: true` on Windows because its children are `npm` and
// `npx` — the two commands `resolve-node-bin.mjs` deliberately cannot replace
// (see the note at the top of `lib/win-shell-args.mjs`) — plus the installed
// `.bin` shim. The shell then re-parses the argv, so every generated path we
// pass has to be quoted for `cmd.exe`.
const WIN_SHELL = process.platform === "win32";
const shellArgs = (args) => winShellArgs(args);

/** Run a command to completion, inheriting stdio. Returns the exit status. */
function runInherit(command, args, cwd = repoRoot) {
  const r = spawnSync(command, shellArgs(args), {
    cwd,
    stdio: "inherit",
    shell: WIN_SHELL,
  });
  return r.status;
}

/**
 * Build the bundled test servers — both the stdio entry (step 4b) and the
 * composable one (step 5). One `tsc -p test-servers` emits both, and the shared
 * helper is unconditional-per-process, so the second call here is a no-op while
 * a fresh run always picks up an edit to `test-servers/src` (#2111). It also
 * runs tsc through `process.execPath` rather than the `npx` this used to shell
 * out to, which is what made this one script unrunnable on Windows (#1939).
 */
function ensureTestServer() {
  try {
    ensureTestServers({
      repoRoot,
      label: "pack:verify",
      log: step,
      requires: ["stdio", "composable"],
    });
  } catch (e) {
    fail(e.message);
  }
}

// ---------------------------------------------------------------------------
// 1. Build every client exactly as the publish would.
// ---------------------------------------------------------------------------
step("building all clients (npm run build)...");
if (runInherit("npm", ["run", "build"]) !== 0) {
  fail("`npm run build` failed");
}

// ---------------------------------------------------------------------------
// 2. Pack the publishable tarball and inspect its file list.
//    --ignore-scripts: we just built, so skip the prepack rebuild AND keep
//    stdout clean JSON (prepack build output would otherwise pollute it).
// ---------------------------------------------------------------------------
step("packing the publishable tarball (npm pack)...");
const pack = spawnSync(
  "npm",
  // npm is npm.cmd on Windows, which needs a shell to resolve (#1939) — the
  // same idiom as runInherit/runBin. `shellArgs` quotes `tmpdir()`, which the
  // shell would otherwise split on a space in the user profile path.
  shellArgs([
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    tmpdir(),
  ]),
  { cwd: repoRoot, encoding: "utf8", shell: WIN_SHELL },
);
if (pack.status !== 0) {
  fail(`\`npm pack\` failed:\n${pack.stderr || pack.stdout}`);
}
let packInfo;
try {
  packInfo = JSON.parse(pack.stdout)[0];
} catch {
  fail(`could not parse \`npm pack --json\` output:\n${pack.stdout}`);
}
const tarball = join(tmpdir(), packInfo.filename.replace(/^.*[/\\]/, ""));
if (!existsSync(tarball)) {
  fail(`packed tarball not found at ${tarball}`);
}
const tarredPaths = packInfo.files.map((f) => f.path);

// 2a. No source maps in the published bundle.
const maps = tarredPaths.filter((p) => p.endsWith(".map"));
if (maps.length > 0) {
  fail(
    `${maps.length} source map(s) leaked into the tarball — they should be disabled ` +
      `in the client bundlers:\n  ${maps.slice(0, 10).join("\n  ")}`,
  );
}

// 2b. Runtime files that are easy to omit from the packlist and only fail once
//     installed: the web artifacts — the prod server runner (build), the SPA
//     (dist), and the MCP Apps sandbox proxy page (static). `clients/web/build`
//     was previously dropped by the nested .gitignore; `clients/web/static` was
//     never listed in the root "files" allowlist at all, so the Apps tab failed
//     with "Sandbox not loaded" on every published build (#1859). None of these
//     are checked-in-tree failures — only an installed tarball reveals them.
//     (The version the CLI/TUI report is read from the root package.json —
//     always shipped — via readInspectorVersion(), so no client package.json
//     needs to ship; that read is exercised by driving the bin in step 4.)
for (const required of [
  "clients/web/build/index.js",
  "clients/web/dist/index.html",
  "clients/web/static/sandbox_proxy.html",
]) {
  if (!tarredPaths.includes(required)) {
    fail(
      `expected \`${required}\` in the published tarball but it is missing — ` +
        `check the "files" field in the root package.json (and that ` +
        `clients/web/.npmignore does not exclude it)`,
    );
  }
}
console.log(
  `pack:verify — tarball OK: ${tarredPaths.length} files, no source maps, ` +
    `clients/web/{build,dist,static} present (${(packInfo.unpackedSize / 1048576).toFixed(2)} MB unpacked)`,
);

// ---------------------------------------------------------------------------
// 3. Install the tarball into a clean throwaway consumer (real npm install,
//    runs the package's postinstall).
// ---------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "pack-verify-"));
workDir = work; // from now on, fail() cleans this up
try {
  ensureTestServer();
  step(
    `installing the tarball into a clean consumer at ${work} (pulls runtime deps)...`,
  );
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "pack-verify-consumer",
      private: true,
      version: "0.0.0",
    }),
  );
  const install = runInherit(
    "npm",
    ["install", tarball, "--no-audit", "--no-fund", "--loglevel", "error"],
    work,
  );
  if (install !== 0) {
    fail("`npm install <tarball>` into the throwaway consumer failed");
  }

  const installedPkg = join(
    work,
    "node_modules",
    "@modelcontextprotocol",
    "inspector",
  );
  const bin = join(
    work,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "mcp-inspector.cmd" : "mcp-inspector",
  );
  if (!existsSync(bin)) {
    fail(`installed \`mcp-inspector\` bin not found at ${bin}`);
  }
  // Confirm the packaging fixes survived install onto disk. The sandbox proxy
  // is resolved at runtime as `<build>/../static/sandbox_proxy.html`, so its
  // position *relative to* clients/web/build is what matters, not just presence
  // in the tarball (#1859).
  for (const required of [
    join(installedPkg, "clients", "web", "build", "index.js"),
    join(installedPkg, "clients", "web", "dist", "index.html"),
    join(installedPkg, "clients", "web", "static", "sandbox_proxy.html"),
    join(installedPkg, "clients", "launcher", "build", "index.js"),
  ]) {
    if (!existsSync(required)) {
      fail(`expected installed file missing: ${required}`);
    }
  }

  /** Run the installed bin. Returns { status, output }. */
  const runBin = (args, extraEnv = {}) => {
    // `bin` itself is quoted too: it lives under the throwaway consumer's
    // `tmpdir()` path, and with a shell the command is joined with the argv.
    const r = spawnSync(shellArgs([bin])[0], shellArgs(args), {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      shell: WIN_SHELL,
    });
    return {
      status: r.status,
      output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
      stdout: r.stdout ?? "",
    };
  };

  // ---------------------------------------------------------------------------
  // 4. Drive the installed bin.
  // ---------------------------------------------------------------------------
  // 4a. Help dispatch for each mode — proves the launcher resolved every client
  //     build from its installed location.
  step("verifying help dispatch (--help, --cli --help, --tui --help)...");
  const helpChecks = [
    {
      args: ["--help"],
      marker: "Mode flags (--web, --cli, --tui)",
      label: "launcher --help",
    },
    {
      args: ["--cli", "--help"],
      marker: "Usage: inspector-cli",
      label: "--cli dispatch",
    },
    {
      args: ["--tui", "--help"],
      marker: "Usage: mcp-inspector-tui",
      label: "--tui dispatch",
    },
  ];
  for (const { args, marker, label } of helpChecks) {
    const r = runBin(args);
    if (r.status !== 0) {
      fail(
        `\`${args.join(" ")}\` exited ${r.status}\n${r.output.slice(0, 800)}`,
      );
    }
    if (!r.output.includes(marker)) {
      fail(
        `\`${args.join(" ")}\` (${label}) did not print "${marker}"\n${r.output.slice(0, 800)}`,
      );
    }
  }

  // 4b. Real CLI connect over stdio from the installed package: tools/list must
  //     return the bundled test server's tools. Exercises launcher → cli → core
  //     → stdio transport path from node_modules.
  step("verifying `--cli` tools/list over stdio from the installed package...");
  const catalogPath = join(work, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify({
      mcpServers: {
        test: { type: "stdio", command: process.execPath, args: [testServer] },
      },
    }),
  );
  const list = runBin([
    "--cli",
    "--catalog",
    catalogPath,
    "--server",
    "test",
    "--method",
    "tools/list",
  ]);
  if (list.status !== 0) {
    fail(`\`--cli … tools/list\` exited ${list.status}\n${list.output}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(list.stdout);
  } catch {
    fail(
      `\`--cli … tools/list\` did not return JSON on stdout:\n${list.stdout}`,
    );
  }
  if (!(parsed.tools ?? []).some((t) => t.name === "echo")) {
    fail(`\`--cli … tools/list\` missing expected "echo" tool`);
  }

  // 4c. Prod `--web` boot from the installed package — THE critical packaging
  //     path: the runner must locate and serve the shipped `dist` (not rebuild
  //     it) and inject the auth token. Run non-blocking and poll `/`.
  await verifyWeb(bin, work);

  // Success: clean up both the work dir and the tarball. (This is reached only
  // on success — every failure path goes through fail() → process.exit(), which
  // does its own cleanup above and never returns here.)
  //
  // verifyWeb() has already awaited the `--web` child's exit before returning
  // (#1826), so nothing of ours is still running inside `work` here. Removal is
  // still routed through removeSafe(): a leftover temp dir must never fail a run
  // that actually passed.
  removeSafe(work, { label: LABEL });
  removeSafe(tarball, { label: LABEL });

  console.log(
    "\npack:verify OK — published tarball installs clean and the real bin drives " +
      "web (prod / served dist + an MCP App rendered through the shipped sandbox " +
      "proxy), cli (stdio tools/list), and tui (help) end to end.",
  );
} catch (err) {
  // Unexpected throw (not via fail()) — route through fail() for consistent
  // cleanup + exit.
  fail(err instanceof Error ? err.message : String(err));
}

/**
 * Boot the installed `mcp-inspector --web` (prod), wait for it to listen, and
 * assert `GET /` returns 200 with the injected token global served from the
 * shipped `dist`. Kills the server before returning.
 */
async function verifyWeb(bin, cwd) {
  step(
    "verifying prod `--web` serves the shipped dist from the installed package...",
  );
  const host = "127.0.0.1";
  const port = process.env.PACK_VERIFY_WEB_PORT ?? "6399";
  const token = "pack-verify-token";
  // Quoted for the same reason as runBin: `bin` sits under a `tmpdir()` path.
  const child = spawn(shellArgs([bin])[0], ["--web"], {
    cwd,
    env: {
      ...process.env,
      CLIENT_PORT: port,
      HOST: host,
      MCP_INSPECTOR_API_TOKEN: token,
      // Isolate the catalog, for the reason #1977 gave the web smokes: without
      // it the backend falls back to the developer's real
      // ~/.mcp-inspector/mcp.json. That was merely untidy while this step only
      // did `GET /`; the App deep link below *persists a server row*, which
      // would make this both destructive and non-deterministic (a second run
      // finds the row already there and races hydration). Assigned after the
      // spread so an inherited MCP_CATALOG_PATH is overridden, not obeyed. The
      // file lives in the throwaway consumer dir, removed with it.
      MCP_CATALOG_PATH: join(cwd, "web-catalog.json"),
      MCP_AUTO_OPEN_ENABLED: "false",
    },
    stdio: ["ignore", "inherit", "inherit"],
    shell: WIN_SHELL,
  });
  // Expose the child so fail() can kill it if a check below exits the process
  // (process.exit skips the `finally { stop() }`).
  webChild = child;

  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  // Signal the server AND wait for it to be gone before returning: the caller
  // removes `work` (the installed package the child is running out of, and its
  // cwd) as its very next statement, and `child.kill()` only delivers the
  // signal (#1826 — the same kill-then-remove race #1801 hit in smoke:tui).
  // Escalates to SIGKILL and ultimately proceeds with a warning, so a wedged
  // server can never hang the verify.
  const stop = () =>
    stopChild(child, {
      label: LABEL,
      what: "`--web` server",
      graceMs: Number(process.env.PACK_VERIFY_EXIT_GRACE_MS ?? 5000),
    }).finally(() => {
      webChild = null;
    });

  try {
    let res = null;
    for (let attempt = 0; attempt < 120 && !res; attempt++) {
      if (exited) {
        fail(
          `\`--web\` exited (code ${exitCode}) before serving — see output above`,
        );
      }
      try {
        res = await fetch(`http://${host}:${port}/`);
      } catch {
        await delay(500);
      }
    }
    if (!res) {
      fail("`--web` server did not start within 60s");
    }
    if (res.status !== 200) {
      fail(`\`--web\` GET / returned HTTP ${res.status}, expected 200`);
    }
    const body = await res.text();
    if (!body.includes(TOKEN_GLOBAL)) {
      fail(
        `\`--web\` served HTML is missing the ${TOKEN_GLOBAL} global (token not injected)`,
      );
    }
    if (!body.includes(token)) {
      fail("`--web` served HTML is missing the injected auth-token value");
    }

    // Step 5, riding the same boot: drive the MCP Apps path in a real browser
    // against this installed server. Throws rather than calling fail() so the
    // `finally` below still stops the `--web` child — the outer catch routes
    // the throw back through fail() for the usual cleanup and exit.
    //
    // `whenExits` lets a mid-run server death be reported as the real cause
    // instead of two stacked 45s selector timeouts. Promise.race attaches a
    // handler to it either way, so a rejection arriving later (during stop())
    // is never an unhandled one.
    const whenExits = new Promise((_, reject) => {
      child.on("exit", (code) =>
        reject(
          new Error(
            `\`--web\` exited (code ${code}) during the App render — see output above`,
          ),
        ),
      );
    });
    await verifyAppRender(`http://${host}:${port}`, token, whenExits);
  } finally {
    await stop();
  }
}

/**
 * Drive **connect → open app → widget ready** against the installed `--web`
 * server (#2003).
 *
 * This is what makes the sandbox proxy's *reachability* a checked property
 * rather than an inferred one. Steps 2 and 3 assert the file is in the tarball
 * and on disk at the right path; neither loads a widget through it, so a
 * renamed file with a stale reader, or a future `"files"` / `.npmignore` edit
 * that moves it relative to `clients/web/build`, ships present-but-unreachable
 * and passes both — exactly the shape of #1859.
 *
 * The App test server is a repo fixture spawned here; only the *client* comes
 * from the install. Everything downstream of the deep link is shared with
 * `smoke:web:app` through `lib/mcp-app-flow.mjs`, so the two cannot drift.
 */
async function verifyAppRender(baseUrl, token, whenWebServerExits) {
  step(
    "verifying an MCP App renders end to end against the installed `--web` server...",
  );
  ensureTestServer();

  let browser = null;
  let mcpUrl = null;
  try {
    // `startMcpAppServer` publishes the child through `onSpawn` before it waits
    // for readiness, so teardown reaches it on every throw path — the readiness
    // timeout included (#2000).
    mcpUrl = await startMcpAppServer({
      repoRoot,
      onSpawn: (child) => {
        appServerChild = child;
      },
      label: LABEL,
    });
    // Chromium explicitly, not `resolveBrowserName()`: this is a *packaging*
    // check, and the engine question (#2086) belongs to the smokes, where the
    // sandbox surface is what is under test. Pinning it also means `pack:verify`
    // cannot be pointed at an engine its npm script never installed.
    browser = await loadBrowser(repoRoot, "chromium");
    const page = await browser.newPage();
    const diagnostics = attachPageDiagnostics(page);

    try {
      await Promise.race([
        whenWebServerExits,
        driveAppFlow({
          page,
          url: buildAppDeepLink({
            baseUrl,
            mcpUrl,
            token,
            appArgs: { title: LABEL },
          }),
        }),
      ]);
    } catch (err) {
      const notes = [
        ...diagnostics.pageErrors,
        ...diagnostics.fatalConsole().map((m) => `console: ${m}`),
      ];
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}${
          notes.length ? ` — page diagnostics: ${notes.join("; ")}` : ""
        }`,
      );
    }

    // Hard failures: any uncaught sync page error, plus the console errors that
    // are the async half of the same class. Benign console noise stays a note.
    const fatal = diagnostics.fatal();
    if (fatal.length > 0) {
      throw new Error(`app logged uncaught error(s): ${fatal.join("; ")}`);
    }
    const benign = diagnostics.benignConsole();
    if (benign.length > 0) {
      console.log(
        `pack:verify note — ${benign.length} non-fatal console error(s): ${benign.join("; ")}`,
      );
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort
      }
    }
    if (appServerChild) {
      const child = appServerChild;
      appServerChild = null;
      await stopChild(child, { label: LABEL, what: "MCP App test server" });
    }
  }

  console.log(
    `pack:verify — installed \`--web\` opened "${APP_TOOL}" from ${mcpUrl}; ` +
      `widget reached data-app-status="ready" through the shipped sandbox proxy`,
  );
}
