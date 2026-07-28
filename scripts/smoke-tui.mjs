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
    // Pin MCP_OAUTH_CALLBACK_URL="" (empty reads as unset) so an ambient
    // non-loopback value can't crash the TUI before render via the loopback
    // callback guard — same class smoke-cli.mjs's SMOKE_BASE_ENV neutralizes.
    env: {
      ...process.env,
      MCP_OAUTH_CALLBACK_URL: "",
      HOME: work,
      USERPROFILE: work,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
let settled = false;
let childExited = false;
let childClosed = false;

// How long to let the TUI wind down after SIGTERM before escalating to SIGKILL,
// and then before giving up on the close event entirely.
const EXIT_GRACE_MS = Number(process.env.SMOKE_TUI_EXIT_GRACE_MS ?? 5000);
// Once the child itself is gone, only the pipe drain remains, so the wait drops
// to this. `close` is bounded by whoever holds the stdio pipes, which can
// outlive the direct child: any descendant that inherited them keeps it pending.
// The TUI spawns nothing at boot today (it does not auto-connect), so this
// never fires — but that reason lives outside this file, so cap it here rather
// than inherit an unrelated process's lifetime if that ever changes.
//
// The cost of capping: on that path we remove the work dir while a descendant
// holding HOME=work may still be writing to it — the #1801 race, re-entered
// deliberately. That is only acceptable because cleanup() warns instead of
// throwing, so the worst case is a warning plus a leaked temp dir in tmpdir,
// never a red smoke. The two are load-bearing for each other.
const DRAIN_MS = 500;

function cleanup() {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch (err) {
    // Never turn a passing smoke into a failure over a leftover temp dir; the
    // OS reclaims tmpdir anyway. On the normal path this should not fire, since
    // removal waits for the child's `close` (see done()) — but the two give-up
    // branches there call finish() without it, and a process may still hold the
    // dir, so this is expected rather than anomalous on those.
    console.warn(
      `smoke:tui — could not remove temp dir ${work}: ${err.message}`,
    );
  }
}

// Tail of the child's output, for quoting in a diagnostic. Slicing an Ink
// stream can land mid-CSI-sequence, so drop through the first newline rather
// than lead with an escape-code fragment that mangles the line after it.
function outputTail(limit = 800) {
  const tail = output.slice(-limit);
  const nl = tail.indexOf("\n");
  return output.length > limit && nl !== -1 ? tail.slice(nl + 1) : tail;
}

// `message` may be a string or a thunk. Callers that quote the child's output
// pass a thunk so it is rendered here — after the wait below, by which point
// `close` guarantees stdout/stderr have been fully drained. Building the string
// at call time instead can truncate the crash reason that matters most.
let finished = false;
function finish(code, message) {
  if (finished) return;
  finished = true;
  cleanup();
  const text = typeof message === "function" ? message() : message;
  if (code === 0) {
    console.log(`smoke:tui OK — ${text}`);
  } else {
    console.error(`smoke:tui FAILED — ${text}`);
  }
  process.exit(code);
}

function done(code, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (childClosed) {
    finish(code, message);
    return;
  }
  // Wait for the child to actually exit before removing the work dir (#1801).
  // The dir doubles as the TUI's HOME, so the Ink process is still writing into
  // it when we signal; an rmSync racing those writes fails with ENOTEMPTY when
  // a file lands after a directory has been read but before it is removed.
  //
  // Wait on `close`, not `exit`: a *spawn failure* emits `error` + `close` and
  // never `exit`, so an `exit` wait would hang here until the give-up timer and
  // then blame a SIGTERM the child never received. `close` also guarantees the
  // stdio pipes are drained, which is what makes the thunked messages complete.
  const forceKill = setTimeout(() => child.kill("SIGKILL"), EXIT_GRACE_MS);

  // Deadline for the wait. Re-armed shorter once the child is gone, since from
  // that point we are only draining pipes. Each message describes what was
  // actually being waited on — the timer can fire for a child that already
  // exited and was never signalled, so it must not claim otherwise.
  let deadline;
  const armDeadline = (ms, warning) => {
    clearTimeout(deadline);
    deadline = setTimeout(() => {
      console.warn(`smoke:tui — ${warning}`);
      finish(code, message);
    }, ms);
  };
  armDeadline(
    EXIT_GRACE_MS * 2,
    `TUI did not close its output streams within ${EXIT_GRACE_MS * 2}ms; cleaning up anyway`,
  );

  const drainOnly = () => {
    clearTimeout(forceKill);
    armDeadline(
      DRAIN_MS,
      `TUI exited but held its output streams open for ${DRAIN_MS}ms (a descendant may have inherited them); cleaning up anyway`,
    );
  };
  if (childExited) drainOnly();
  else child.once("exit", drainOnly);

  child.once("close", () => {
    clearTimeout(forceKill);
    clearTimeout(deadline);
    finish(code, message);
  });
  // Only signal a child that is still running: on the crash-before-render and
  // spawn-failure paths there is nothing left to signal, and we are here purely
  // to wait out the remaining `close`.
  if (child.exitCode === null && child.signalCode === null && !child.killed) {
    child.kill("SIGTERM");
  }
}

function onData(chunk) {
  output += chunk.toString();
  if (output.includes(RENDER_MARKER)) {
    done(0, `rendered "${RENDER_MARKER}" panel from --catalog within timeout`);
  }
}

child.stdout.on("data", onData);
child.stderr.on("data", onData);

// Registered before done()'s own one-shot listener, so this always runs first —
// done() can trust `childClosed` even when called from inside a close handler.
child.on("close", () => {
  childClosed = true;
});

child.on("exit", (code) => {
  childExited = true;
  if (settled) return;
  // Exiting before the render marker appeared is a failure (crash on boot).
  done(
    1,
    () =>
      `TUI exited (code ${code}) before rendering "${RENDER_MARKER}"\n${outputTail()}`,
  );
});

child.on("error", (err) => {
  done(1, `failed to spawn TUI: ${err.message}`);
});

const timer = setTimeout(() => {
  done(
    1,
    () =>
      `TUI did not render "${RENDER_MARKER}" within ${TIMEOUT_MS}ms\n${outputTail()}`,
  );
}, TIMEOUT_MS);
