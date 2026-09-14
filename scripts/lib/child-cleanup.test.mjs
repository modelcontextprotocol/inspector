// Tests for the shared child-teardown helpers (#1826). Each case pins one rule
// the kill-then-remove race (#1801) turned out to need. Run via
// `npm run test:scripts` (node:test; the root has no vitest harness).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_EXIT_GRACE_MS,
  hasExited,
  normalizeGraceMs,
  removeSafe,
  stopChild,
} from "./child-cleanup.mjs";

/**
 * Minimal stand-in for a ChildProcess: records the signals it was sent and lets
 * a test decide when (or whether) it emits exit/close.
 */
function fakeChild({ exitCode = null, signalCode = null } = {}) {
  const child = new EventEmitter();
  child.exitCode = exitCode;
  child.signalCode = signalCode;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    return true;
  };
  return child;
}

function collectWarnings() {
  const warnings = [];
  return { warnings, warn: (msg) => warnings.push(msg) };
}

test("hasExited: only exitCode/signalCode count, not `killed`", () => {
  assert.equal(hasExited(fakeChild()), false);
  assert.equal(hasExited(fakeChild({ exitCode: 0 })), true);
  assert.equal(hasExited(fakeChild({ exitCode: 1 })), true);
  assert.equal(hasExited(fakeChild({ signalCode: "SIGTERM" })), true);
  // `killed` means "a signal was delivered", NOT "the process is dead" — a
  // helper that treated it as exited would reintroduce the very race.
  const killed = fakeChild();
  killed.killed = true;
  assert.equal(hasExited(killed), false);
});

test("normalizeGraceMs: a bad env-derived value can't collapse the escalation", () => {
  // `Number(process.env.X ?? 5000)` is how call sites build this, so a typo
  // yields NaN — which setTimeout treats as 0, firing SIGTERM and SIGKILL in
  // the same tick and printing "within NaNms".
  for (const bad of [NaN, 0, -1, Infinity, undefined, null, "3000"])
    assert.equal(normalizeGraceMs(bad), DEFAULT_EXIT_GRACE_MS, String(bad));
  assert.equal(normalizeGraceMs(25), 25);
});

test("stopChild: a NaN graceMs falls back rather than double-killing at once", async () => {
  const child = fakeChild();
  const { warnings, warn } = collectWarnings();
  const stopped = stopChild(child, { graceMs: NaN, warn });
  // With NaN passed through, both timers would already have been scheduled at
  // 0ms; a macrotask turn is enough to observe that.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.deepEqual(warnings, []);
  child.emit("exit", 0);
  assert.equal(await stopped, "exited");
});

test("stopChild: an already-exited child is not signalled again", async () => {
  const child = fakeChild({ exitCode: 0 });
  const { warnings, warn } = collectWarnings();
  assert.equal(await stopChild(child, { warn }), "already-exited");
  assert.deepEqual(child.signals, []);
  assert.deepEqual(warnings, []);
});

test("stopChild: SIGTERMs a live child and resolves on `exit`", async () => {
  const child = fakeChild();
  const { warnings, warn } = collectWarnings();
  const stopped = stopChild(child, { graceMs: 50, warn });
  // The signal goes out synchronously, so the caller's wait is genuinely a wait
  // for the child rather than a wait to signal it.
  assert.deepEqual(child.signals, ["SIGTERM"]);
  child.exitCode = 0;
  child.emit("exit", 0);
  assert.equal(await stopped, "exited");
  assert.deepEqual(warnings, []);
});

test("stopChild: resolves on `close` alone (spawn failure emits no `exit`)", async () => {
  const child = fakeChild();
  const { warnings, warn } = collectWarnings();
  const stopped = stopChild(child, { graceMs: 50, warn });
  child.emit("close", null, "SIGTERM");
  assert.equal(await stopped, "exited");
  assert.deepEqual(warnings, []);
});

test("stopChild: escalates to SIGKILL after the grace period", async () => {
  const child = fakeChild();
  const { warnings, warn } = collectWarnings();
  const stopped = stopChild(child, {
    graceMs: 20,
    label: "pack:verify",
    what: "`--web` server",
    warn,
  });
  // Ignores SIGTERM; dies only once SIGKILLed.
  child.once("kill:SIGKILL", () => child.emit("exit", null));
  const originalKill = child.kill;
  child.kill = (signal) => {
    originalKill(signal);
    if (signal === "SIGKILL") child.emit("kill:SIGKILL");
    return true;
  };
  assert.equal(await stopped, "exited");
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /pack:verify — `--web` server did not exit/);
  assert.match(warnings[0], /sending SIGKILL/);
});

test("stopChild: gives up (never hangs) when even SIGKILL is not observed", async () => {
  const child = fakeChild();
  const { warnings, warn } = collectWarnings();
  // Emits nothing ever: the helper must still resolve, since a teardown path
  // that can hang is worse than one that proceeds with a warning.
  assert.equal(await stopChild(child, { graceMs: 10, warn }), "gave-up");
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /continuing anyway/);
});

test("stopChild: a late exit after giving up does not re-resolve or throw", async () => {
  const child = fakeChild();
  const { warn } = collectWarnings();
  assert.equal(await stopChild(child, { graceMs: 10, warn }), "gave-up");
  child.emit("exit", null);
  child.emit("close", null);
});

test("removeSafe: removes a populated directory and reports true", () => {
  const dir = mkdtempSync(join(tmpdir(), "child-cleanup-test-"));
  writeFileSync(join(dir, "file.txt"), "x");
  const { warnings, warn } = collectWarnings();
  assert.equal(removeSafe(dir, { warn }), true);
  assert.equal(existsSync(dir), false);
  assert.deepEqual(warnings, []);
});

test("removeSafe: a missing path is a no-op success (force)", () => {
  const { warnings, warn } = collectWarnings();
  assert.equal(
    removeSafe(join(tmpdir(), "child-cleanup-does-not-exist-1826"), { warn }),
    true,
  );
  assert.deepEqual(warnings, []);
});

test("removeSafe: warns instead of throwing when removal fails", () => {
  const { warnings, warn } = collectWarnings();
  // A non-string path makes rmSync throw synchronously, standing in for the
  // ENOTEMPTY this helper exists to swallow. The contract under test is that
  // NOTHING escapes — a leftover temp dir must never change a script's verdict.
  assert.equal(removeSafe(42, { label: "pack:verify", warn }), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^pack:verify — could not remove 42: /);
});
