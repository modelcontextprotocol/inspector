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
 *
 * Exits non-zero (failing CI / `npm run validate`) on any mismatch.
 *
 * Expects `clients/launcher/build` and `clients/cli/build` to be built first
 * (the validate / CI ordering guarantees this). The bundled stdio test server
 * (`test-servers/build`) is built on demand here if missing.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const launcher = join(repoRoot, "clients", "launcher", "build", "index.js");
const testServer = join(
  repoRoot,
  "test-servers",
  "build",
  "test-server-stdio.js",
);

function fail(message) {
  console.error(`smoke:cli FAILED — ${message}`);
  process.exit(1);
}

/** Build the bundled stdio test server if it isn't present yet. */
function ensureTestServer() {
  if (existsSync(testServer)) return;
  console.log("smoke:cli — building test-servers (missing build output)...");
  const r = spawnSync("npx", ["tsc", "-p", "test-servers", "--noCheck"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.status !== 0 || !existsSync(testServer)) {
    fail(
      "could not build the stdio test server (test-servers/build/test-server-stdio.js). " +
        "Run `npm run test-servers:build` from clients/cli.",
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

  console.log(
    "smoke:cli OK — tools/list over stdio via --catalog; default-catalog seed; " +
      "read-only --config error (no seed); --catalog/--config conflict",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
