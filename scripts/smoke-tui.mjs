#!/usr/bin/env node
/**
 * Boot smoke test for the prod TUI launcher path (#1347).
 *
 * `npm run smoke:launcher` only checks `--tui --help`; it never actually starts
 * the Ink app, so the launcher → TUI → core path and `--catalog` loading went
 * unverified by the launcher smokes. This script launches the built launcher in
 * `--tui` mode against a temp `--catalog`, waits for the app to render its first
 * frame (the "MCP Servers" panel) within a timeout, then sends SIGTERM and
 * exits.
 *
 * It asserts the TUI *boots and renders* without crashing — not full
 * interaction (driving an Ink UI deterministically in CI is flaky, so this is
 * intentionally a shallow render check). Exits non-zero on a crash-before-render
 * or a render timeout.
 *
 * Expects `clients/launcher/build` and `clients/tui/build` to be built first
 * (the validate / CI ordering guarantees this). The bundled stdio test server
 * (`test-servers/build`) is built on demand here if missing.
 */

import { spawn, spawnSync } from "node:child_process";
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
const RENDER_MARKER = "MCP Servers";
const TIMEOUT_MS = Number(process.env.SMOKE_TUI_TIMEOUT_MS ?? 15000);

function fail(message) {
  console.error(`smoke:tui FAILED — ${message}`);
  process.exit(1);
}

function ensureTestServer() {
  if (existsSync(testServer)) return;
  console.log("smoke:tui — building test-servers (missing build output)...");
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

// The Ink TUI requires a real TTY for raw-mode keyboard input. Headless CI has
// none, so the app throws "Raw mode is not supported" on mount and exits before
// it can render its first frame — making this boot/render check inherently a
// LOCAL-only smoke (its own design notes call driving Ink in CI flaky). Skip it
// under CI rather than fail spuriously: the TUI is still built and unit-tested
// there; only this terminal-dependent render check is local-only.
if (process.env.CI) {
  console.log(
    "smoke:tui SKIPPED — Ink needs a real TTY (raw mode), unavailable in CI; run it locally",
  );
  process.exit(0);
}

if (!existsSync(launcher)) {
  fail(`launcher build not found at ${launcher} — run \`npm run build\` first`);
}
ensureTestServer();

const work = mkdtempSync(join(tmpdir(), "smoke-tui-"));
const catalogPath = join(work, "catalog.json");
writeFileSync(
  catalogPath,
  JSON.stringify({
    mcpServers: {
      test: { type: "stdio", command: process.execPath, args: [testServer] },
    },
  }),
);

const child = spawn(
  process.execPath,
  [launcher, "--tui", "--catalog", catalogPath],
  {
    cwd: repoRoot,
    // Redirect HOME so the TUI's storage never touches the real ~/.mcp-inspector.
    env: { ...process.env, HOME: work, USERPROFILE: work },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
let settled = false;

function cleanup() {
  rmSync(work, { recursive: true, force: true });
}

function done(code, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (!child.killed) child.kill("SIGTERM");
  cleanup();
  if (code === 0) {
    console.log(`smoke:tui OK — ${message}`);
  } else {
    console.error(`smoke:tui FAILED — ${message}`);
  }
  process.exit(code);
}

function onData(chunk) {
  output += chunk.toString();
  if (output.includes(RENDER_MARKER)) {
    done(0, `rendered "${RENDER_MARKER}" panel from --catalog within timeout`);
  }
}

child.stdout.on("data", onData);
child.stderr.on("data", onData);

child.on("exit", (code) => {
  if (settled) return;
  // Exiting before the render marker appeared is a failure (crash on boot).
  done(
    1,
    `TUI exited (code ${code}) before rendering "${RENDER_MARKER}"\n${output.slice(0, 800)}`,
  );
});

child.on("error", (err) => {
  done(1, `failed to spawn TUI: ${err.message}`);
});

const timer = setTimeout(() => {
  done(
    1,
    `TUI did not render "${RENDER_MARKER}" within ${TIMEOUT_MS}ms\n${output.slice(0, 800)}`,
  );
}, TIMEOUT_MS);
