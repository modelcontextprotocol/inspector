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
 *      asserting NO source maps ship and that `clients/web/{build,dist}` are
 *      both present (the two packaging fixes this work landed);
 *   3. installs that tarball into a fresh temp dir (real `npm install <tgz>`,
 *      which runs the package's `postinstall`);
 *   4. runs the installed `mcp-inspector` bin: `--help`, `--cli`/`--tui` help
 *      dispatch, a real `--cli` `tools/list` over stdio, and a prod `--web` boot
 *      that must serve `/` (HTTP 200) with the injected auth-token global from
 *      the shipped `dist` — all from the INSTALLED location, not the repo.
 *
 * Exits non-zero on the first failure. Requires network access (step 3 pulls the
 * package's runtime dependencies from the registry) — it is a local / release
 * verification tool, not part of the fast `validate` loop.
 *
 * Usage: `npm run pack:verify` (from the repo root).
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = resolve(import.meta.dirname, "..");
const testServer = join(repoRoot, "test-servers", "build", "test-server-stdio.js");

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

function fail(message) {
  console.error(`\npack:verify FAILED — ${message}`);
  if (webChild && webChild.exitCode === null) {
    webChild.kill("SIGTERM");
  }
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    // `tarball` is initialized before `workDir` is ever set, so this is safe.
    console.error(`pack:verify — tarball retained for inspection at ${tarball}`);
  }
  process.exit(1);
}

function step(message) {
  console.log(`\npack:verify — ${message}`);
}

/** Run a command to completion, inheriting stdio. Returns the exit status. */
function runInherit(command, args, cwd = repoRoot) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return r.status;
}

/** Build the bundled stdio test server if it isn't present yet. */
function ensureTestServer() {
  if (existsSync(testServer)) return;
  step("building test-servers (missing build output)...");
  const status = runInherit("npx", ["tsc", "-p", "test-servers", "--noCheck"]);
  if (status !== 0 || !existsSync(testServer)) {
    fail("could not build the stdio test server (test-servers/build/test-server-stdio.js)");
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
  ["pack", "--json", "--ignore-scripts", "--pack-destination", tmpdir()],
  { cwd: repoRoot, encoding: "utf8" },
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
//     installed: both web artifacts — the prod server runner (build) AND the SPA
//     (dist). `clients/web/build` was previously dropped by the nested
//     .gitignore. (The version the CLI/TUI report is read from the root
//     package.json — always shipped — via readInspectorVersion(), so no client
//     package.json needs to ship; that read is exercised by driving the bin in
//     step 4.)
for (const required of [
  "clients/web/build/index.js",
  "clients/web/dist/index.html",
]) {
  if (!tarredPaths.includes(required)) {
    fail(
      `expected \`${required}\` in the published tarball but it is missing — ` +
        `check the "files" field in clients/web/package.json`,
    );
  }
}
console.log(
  `pack:verify — tarball OK: ${tarredPaths.length} files, no source maps, ` +
    `clients/web/{build,dist} present (${(packInfo.unpackedSize / 1048576).toFixed(2)} MB unpacked)`,
);

// ---------------------------------------------------------------------------
// 3. Install the tarball into a clean throwaway consumer (real npm install,
//    runs the package's postinstall).
// ---------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "pack-verify-"));
workDir = work; // from now on, fail() cleans this up
try {
  ensureTestServer();
  step(`installing the tarball into a clean consumer at ${work} (pulls runtime deps)...`);
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "pack-verify-consumer", private: true, version: "0.0.0" }),
  );
  const install = runInherit(
    "npm",
    ["install", tarball, "--no-audit", "--no-fund", "--loglevel", "error"],
    work,
  );
  if (install !== 0) {
    fail("`npm install <tarball>` into the throwaway consumer failed");
  }

  const installedPkg = join(work, "node_modules", "@modelcontextprotocol", "inspector");
  const bin = join(work, "node_modules", ".bin", process.platform === "win32" ? "mcp-inspector.cmd" : "mcp-inspector");
  if (!existsSync(bin)) {
    fail(`installed \`mcp-inspector\` bin not found at ${bin}`);
  }
  // Confirm the two packaging fixes survived install onto disk.
  for (const required of [
    join(installedPkg, "clients", "web", "build", "index.js"),
    join(installedPkg, "clients", "web", "dist", "index.html"),
    join(installedPkg, "clients", "launcher", "build", "index.js"),
  ]) {
    if (!existsSync(required)) {
      fail(`expected installed file missing: ${required}`);
    }
  }

  /** Run the installed bin. Returns { status, output }. */
  const runBin = (args, extraEnv = {}) => {
    const r = spawnSync(bin, args, {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      shell: process.platform === "win32",
    });
    return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "" };
  };

  // ---------------------------------------------------------------------------
  // 4. Drive the installed bin.
  // ---------------------------------------------------------------------------
  // 4a. Help dispatch for each mode — proves the launcher resolved every client
  //     build from its installed location.
  step("verifying help dispatch (--help, --cli --help, --tui --help)...");
  const helpChecks = [
    { args: ["--help"], marker: "Mode flags (--web, --cli, --tui)", label: "launcher --help" },
    { args: ["--cli", "--help"], marker: "Usage: inspector-cli", label: "--cli dispatch" },
    { args: ["--tui", "--help"], marker: "Usage: mcp-inspector-tui", label: "--tui dispatch" },
  ];
  for (const { args, marker, label } of helpChecks) {
    const r = runBin(args);
    if (r.status !== 0) {
      fail(`\`${args.join(" ")}\` exited ${r.status}\n${r.output.slice(0, 800)}`);
    }
    if (!r.output.includes(marker)) {
      fail(`\`${args.join(" ")}\` (${label}) did not print "${marker}"\n${r.output.slice(0, 800)}`);
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
  const list = runBin(["--cli", "--catalog", catalogPath, "--server", "test", "--method", "tools/list"]);
  if (list.status !== 0) {
    fail(`\`--cli … tools/list\` exited ${list.status}\n${list.output}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(list.stdout);
  } catch {
    fail(`\`--cli … tools/list\` did not return JSON on stdout:\n${list.stdout}`);
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
  rmSync(work, { recursive: true, force: true });
  rmSync(tarball, { force: true });

  console.log(
    "\npack:verify OK — published tarball installs clean and the real bin drives " +
      "web (prod / served dist), cli (stdio tools/list), and tui (help) end to end.",
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
  step("verifying prod `--web` serves the shipped dist from the installed package...");
  const host = "127.0.0.1";
  const port = process.env.PACK_VERIFY_WEB_PORT ?? "6399";
  const token = "pack-verify-token";
  const child = spawn(bin, ["--web"], {
    cwd,
    env: {
      ...process.env,
      CLIENT_PORT: port,
      HOST: host,
      MCP_INSPECTOR_API_TOKEN: token,
      MCP_AUTO_OPEN_ENABLED: "false",
    },
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
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
  const stop = () => {
    if (!exited) child.kill("SIGTERM");
    webChild = null;
  };

  try {
    let res = null;
    for (let attempt = 0; attempt < 120 && !res; attempt++) {
      if (exited) {
        fail(`\`--web\` exited (code ${exitCode}) before serving — see output above`);
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
      fail(`\`--web\` served HTML is missing the ${TOKEN_GLOBAL} global (token not injected)`);
    }
    if (!body.includes(token)) {
      fail("`--web` served HTML is missing the injected auth-token value");
    }
  } finally {
    stop();
  }
}
