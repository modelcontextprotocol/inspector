#!/usr/bin/env node
/**
 * End-to-end smoke test for the prod CLI launcher path (#1347).
 *
 * `npm run smoke:launcher` only checks `--cli --help`; it never connects to a
 * server, so the launcher → CLI → core → stdio-transport path and the
 * `--catalog` / `--config` resolution introduced in #1347 went unverified by
 * the launcher smokes. This script drives the built `clients/launcher/build`
 * artifact in `--cli` mode and asserts, end to end:
 *
 *   1. `--catalog <populated>` + `--server` runs `tools/list` and returns the
 *      bundled test server's tools (real connect over stdio).
 *   2. The default writable catalog is seeded empty on first run (and reports
 *      "no servers"), rather than erroring "Config file not found".
 *   3. A read-only `--config` that is missing errors and is NOT seeded.
 *   4. `--catalog` + `--config` is rejected as mutually exclusive.
 *   5. An unknown `--server` errors with the source-agnostic "not found.
 *      Available servers: …" message (#1482).
 *   6. A multi-server catalog selects via `--server` and errors (asking for a
 *      selection) when it is omitted.
 *   7. `--header` merges into the resolved server's settings without breaking
 *      the connect path (the file→settings lift from #1482).
 *   8. Over an HTTP transport (in-process test server), a config-file `headers`
 *      object is lifted onto the wire, and a CLI `--header` overrides it — the
 *      headline lift→transport path of #1482, verified end to end.
 *
 * Exits non-zero (failing CI / `npm run validate`) on any mismatch.
 *
 * Expects `clients/launcher/build` and `clients/cli/build` to be built first
 * (the validate / CI ordering guarantees this). The bundled stdio test server
 * (`test-servers/build`) is built on demand here if missing.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");
const launcher = join(repoRoot, "clients", "launcher", "build", "index.js");
const testServer = join(
  repoRoot,
  "test-servers",
  "build",
  "test-server-stdio.js",
);
const httpTestServerModule = join(
  repoRoot,
  "test-servers",
  "build",
  "test-server-http.js",
);

function fail(message) {
  console.error(`smoke:cli FAILED — ${message}`);
  process.exit(1);
}

/** Build the bundled test servers (stdio + http) if they aren't present yet. */
function ensureTestServer() {
  if (existsSync(testServer) && existsSync(httpTestServerModule)) return;
  console.log("smoke:cli — building test-servers (missing build output)...");
  const r = spawnSync("npx", ["tsc", "-p", "test-servers", "--noCheck"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (
    r.status !== 0 ||
    !existsSync(testServer) ||
    !existsSync(httpTestServerModule)
  ) {
    fail(
      "could not build the test servers (test-servers/build/test-server-stdio.js, " +
        "test-server-http.js). Run `npm run test-servers:build` from clients/cli.",
    );
  }
}

/** Run the launcher in --cli mode. Returns { status, stdout, stderr }. */
function runCli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [launcher, "--cli", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf-8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Async variant of `runCli` using non-blocking `spawn`. Required for the HTTP
 * case: the test server runs in THIS process's event loop, so a blocking
 * `spawnSync` would deadlock (the CLI child's request could never be serviced).
 * Returns { status, stdout, stderr }.
 */
function runCliAsync(args, extraEnv = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [launcher, "--cli", ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

if (!existsSync(launcher)) {
  fail(`launcher build not found at ${launcher} — run \`npm run build\` first`);
}
ensureTestServer();

const work = mkdtempSync(join(tmpdir(), "smoke-cli-"));
try {
  // 1) Populated --catalog → tools/list returns the test server's tools.
  const catalogPath = join(work, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify({
      mcpServers: {
        test: { type: "stdio", command: process.execPath, args: [testServer] },
      },
    }),
  );
  const list = runCli([
    "--catalog",
    catalogPath,
    "--server",
    "test",
    "--method",
    "tools/list",
  ]);
  if (list.status !== 0) {
    fail(
      `tools/list via --catalog exited ${list.status}\n${list.stderr || list.stdout}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(list.stdout);
  } catch {
    fail(`tools/list did not return JSON on stdout:\n${list.stdout}`);
  }
  const toolNames = (parsed.tools ?? []).map((t) => t.name);
  if (!toolNames.includes("echo")) {
    fail(
      `tools/list missing expected "echo" tool; got: ${toolNames.join(", ")}`,
    );
  }

  // 2) Default writable catalog is seeded empty on first run (HOME redirected).
  const fakeHome = join(work, "home");
  const seed = runCli(["--method", "tools/list"], {
    HOME: fakeHome,
    USERPROFILE: fakeHome,
  });
  if (seed.status === 0) {
    fail("default catalog with no servers should have exited non-zero");
  }
  if (!/No servers found/.test(seed.stderr)) {
    fail(
      `expected "No servers found" from seeded default catalog; got:\n${seed.stderr}`,
    );
  }
  if (!existsSync(join(fakeHome, ".mcp-inspector", "mcp.json"))) {
    fail("default catalog was not seeded at ~/.mcp-inspector/mcp.json");
  }

  // 3) Read-only --config that is missing errors and is NOT seeded.
  const missingConfig = join(work, "missing.json");
  const ro = runCli(["--config", missingConfig, "--method", "tools/list"]);
  if (ro.status === 0) {
    fail("missing --config should have exited non-zero");
  }
  if (!/Config file not found/.test(ro.stderr)) {
    fail(
      `expected "Config file not found" for missing --config; got:\n${ro.stderr}`,
    );
  }
  if (existsSync(missingConfig)) {
    fail("read-only --config must never be seeded, but the file was created");
  }

  // 4) --catalog + --config is rejected.
  const conflict = runCli([
    "--catalog",
    catalogPath,
    "--config",
    catalogPath,
    "--method",
    "tools/list",
  ]);
  if (conflict.status === 0) {
    fail("--catalog with --config should have exited non-zero");
  }
  if (!/mutually exclusive/.test(conflict.stderr)) {
    fail(
      `expected "mutually exclusive" for --catalog + --config; got:\n${conflict.stderr}`,
    );
  }

  // 5) Unknown --server errors with the source-agnostic message (#1482): the
  //    entry may come from a file or a single ad-hoc target, so it is "not
  //    found" rather than "not found in config file".
  const unknownServer = runCli([
    "--catalog",
    catalogPath,
    "--server",
    "nope",
    "--method",
    "tools/list",
  ]);
  if (unknownServer.status === 0) {
    fail("--server with an unknown name should have exited non-zero");
  }
  if (
    !/Server 'nope' not found\. Available servers: test/.test(
      unknownServer.stderr,
    )
  ) {
    fail(
      `expected "Server 'nope' not found. Available servers: test"; got:\n${unknownServer.stderr}`,
    );
  }

  // 6) Multi-server catalog: --server selects one; omitting it errors asking for
  //    a selection (selectServerEntry over a multi-entry source).
  const multiCatalogPath = join(work, "multi-catalog.json");
  writeFileSync(
    multiCatalogPath,
    JSON.stringify({
      mcpServers: {
        one: { type: "stdio", command: process.execPath, args: [testServer] },
        two: { type: "stdio", command: process.execPath, args: [testServer] },
      },
    }),
  );
  const ambiguous = runCli([
    "--catalog",
    multiCatalogPath,
    "--method",
    "tools/list",
  ]);
  if (ambiguous.status === 0) {
    fail("multi-server catalog without --server should have exited non-zero");
  }
  if (!/Multiple servers found/.test(ambiguous.stderr)) {
    fail(
      `expected "Multiple servers found" without --server; got:\n${ambiguous.stderr}`,
    );
  }
  const selected = runCli([
    "--catalog",
    multiCatalogPath,
    "--server",
    "two",
    "--method",
    "tools/list",
  ]);
  if (selected.status !== 0) {
    fail(
      `--server two against a multi-server catalog exited ${selected.status}\n${selected.stderr || selected.stdout}`,
    );
  }
  let selectedParsed;
  try {
    selectedParsed = JSON.parse(selected.stdout);
  } catch {
    fail(`--server two did not return JSON on stdout:\n${selected.stdout}`);
  }
  if (!(selectedParsed.tools ?? []).some((t) => t.name === "echo")) {
    fail(`--server two tools/list missing expected "echo" tool`);
  }

  // 7) --header is merged into the resolved server's settings and broadcast to
  //    every entry (#1482). Over stdio the header is inert, so the real check is
  //    that the merge path does not break the connect: tools/list still works.
  const withHeader = runCli([
    "--catalog",
    catalogPath,
    "--server",
    "test",
    "--header",
    "X-Smoke: 1",
    "--method",
    "tools/list",
  ]);
  if (withHeader.status !== 0) {
    fail(
      `tools/list with --header exited ${withHeader.status}\n${withHeader.stderr || withHeader.stdout}`,
    );
  }
  let withHeaderParsed;
  try {
    withHeaderParsed = JSON.parse(withHeader.stdout);
  } catch {
    fail(
      `tools/list with --header did not return JSON on stdout:\n${withHeader.stdout}`,
    );
  }
  if (!(withHeaderParsed.tools ?? []).some((t) => t.name === "echo")) {
    fail(`tools/list with --header missing expected "echo" tool`);
  }

  // 8) HTTP transport — the headline of #1482: a config-file `headers` object is
  //    lifted into InspectorServerSettings and actually sent ON THE WIRE, and a
  //    CLI `--header` overrides it. Unlike stdio (where headers are inert), this
  //    proves the full lift→transport path. The HTTP test server runs IN-PROCESS
  //    so we can read back the headers it recorded; the CLI connects to it as a
  //    child via `runCliAsync` (a blocking spawnSync would deadlock the server's
  //    event loop). `getRecordedRequests()` lowercases header names (Node http).
  const { createTestServerHttp } = await import(
    pathToFileURL(httpTestServerModule).href
  );
  const { createEchoTool, createTestServerInfo } = await import(
    pathToFileURL(
      join(repoRoot, "test-servers", "build", "test-server-fixtures.js"),
    ).href
  );
  const httpServer = createTestServerHttp({
    serverInfo: createTestServerInfo(),
    tools: [createEchoTool()],
    serverType: "streamable-http",
  });
  const httpPort = await httpServer.start();
  try {
    const httpConfigPath = join(work, "http-config.json");
    const writeHttpConfig = (headers) =>
      writeFileSync(
        httpConfigPath,
        JSON.stringify({
          mcpServers: {
            http: {
              type: "http",
              url: `http://localhost:${httpPort}/mcp`,
              headers,
            },
          },
        }),
      );

    // 8a) File-level header is lifted onto the wire.
    writeHttpConfig({ "X-Smoke-Header": "from-config" });
    const httpList = await runCliAsync([
      "--config",
      httpConfigPath,
      "--server",
      "http",
      "--method",
      "tools/list",
    ]);
    if (httpList.status !== 0) {
      fail(
        `HTTP tools/list exited ${httpList.status}\n${httpList.stderr || httpList.stdout}`,
      );
    }
    const headerValues = () =>
      httpServer
        .getRecordedRequests()
        .map((r) => r.headers?.["x-smoke-header"])
        .filter(Boolean);
    if (!headerValues().includes("from-config")) {
      fail(
        `expected config-file header "X-Smoke-Header: from-config" on the wire; ` +
          `recorded values: ${JSON.stringify(headerValues())}`,
      );
    }

    // 8b) CLI --header overrides the file header on the wire (mergeSettings).
    httpServer.clearRecordings();
    const httpOverride = await runCliAsync([
      "--config",
      httpConfigPath,
      "--server",
      "http",
      "--header",
      "X-Smoke-Header: from-cli",
      "--method",
      "tools/list",
    ]);
    if (httpOverride.status !== 0) {
      fail(
        `HTTP tools/list with --header override exited ${httpOverride.status}\n${httpOverride.stderr || httpOverride.stdout}`,
      );
    }
    const overrideValues = headerValues();
    if (!overrideValues.includes("from-cli")) {
      fail(
        `expected --header override "X-Smoke-Header: from-cli" on the wire; ` +
          `recorded values: ${JSON.stringify(overrideValues)}`,
      );
    }
    if (overrideValues.includes("from-config")) {
      fail(
        `--header should override the file header, but "from-config" still reached the wire; ` +
          `recorded values: ${JSON.stringify(overrideValues)}`,
      );
    }
  } finally {
    await httpServer.stop();
  }

  console.log(
    "smoke:cli OK — tools/list over stdio via --catalog; default-catalog seed; " +
      "read-only --config error (no seed); --catalog/--config conflict; " +
      "unknown --server error; multi-server --server selection; --header merge; " +
      "HTTP config-header lift + --header override on the wire",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
