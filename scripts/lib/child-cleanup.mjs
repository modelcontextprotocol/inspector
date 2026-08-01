/**
 * Shared teardown helpers for scripts that spawn a child process into a temp
 * work dir and then delete that dir (#1801 / #1814, generalized in #1826).
 *
 * The bug class both helpers exist for: a script signals its child and then
 * *synchronously* removes the work dir. `child.kill()` only delivers the
 * signal — it does not wait — so the removal can race the child's shutdown and
 * fail with ENOTEMPTY when a file lands after a directory has been read but
 * before it is removed. That turned a passing smoke red in #1801.
 *
 * The two halves are deliberately complementary, and both are needed:
 *
 *   - `stopChild()` removes the race on the normal path by awaiting the child's
 *     exit (SIGTERM → grace → SIGKILL → proceed anyway with a warning);
 *   - `removeSafe()` makes the residual case harmless — a path that still can't
 *     be removed warns and leaks into tmpdir (which the OS reclaims) instead of
 *     throwing an rmSync stack over the script's own result message.
 *
 * Both take an injectable `warn` so they can be unit-tested without capturing
 * console output (`npm run test:scripts`).
 */

import { rmSync } from "node:fs";

/** Default wait after SIGTERM before escalating to SIGKILL. */
export const DEFAULT_EXIT_GRACE_MS = 5000;

/**
 * Coerce a caller-supplied grace period to a usable one.
 *
 * Call sites read this from the environment (`Number(process.env.X ?? 5000)`),
 * so a typo yields `NaN` — which `setTimeout` treats as `0`, silently turning
 * the whole SIGTERM→SIGKILL escalation into an immediate double-kill and
 * printing "did not exit within NaNms". Fall back to the default instead.
 *
 * @param {unknown} graceMs
 */
export function normalizeGraceMs(graceMs) {
  return typeof graceMs === "number" && Number.isFinite(graceMs) && graceMs > 0
    ? graceMs
    : DEFAULT_EXIT_GRACE_MS;
}

/**
 * True once the child process is known to be gone (normal exit or signalled).
 * Both fields stay `null` while it is alive, and `killed` is NOT a substitute —
 * it only means a signal was delivered, not that the process is dead yet.
 *
 * @param {{ exitCode: number | null, signalCode: string | null }} child
 */
export function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Terminate `child` and wait for it to actually be gone, so a caller can then
 * delete the child's work dir without racing its shutdown.
 *
 * Escalation: SIGTERM → (after `graceMs`) SIGKILL → (after `graceMs` again)
 * give up and resolve anyway. Giving up is deliberate: a teardown helper must
 * never hang a script, and `removeSafe()` below downgrades the consequence of
 * proceeding early to a warning.
 *
 * Waits on `exit` OR `close`, whichever comes first. `exit` alone is wrong for a
 * *spawn failure* (which emits `error` + `close` and never `exit`, so the wait
 * would burn both timeouts before proceeding); `close` alone can outlive the
 * child when a descendant inherited its stdio pipes.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {object} [opts]
 * @param {string} [opts.label]    prefix for warnings, e.g. "pack:verify"
 * @param {string} [opts.what]     what the child is, for warnings
 * @param {number} [opts.graceMs] non-finite/non-positive falls back to the default
 * @param {(msg: string) => void} [opts.warn]
 * @returns {Promise<"already-exited" | "exited" | "gave-up">}
 */
export function stopChild(
  child,
  {
    label = "cleanup",
    what = "child process",
    graceMs: requestedGraceMs = DEFAULT_EXIT_GRACE_MS,
    warn = console.warn,
  } = {},
) {
  if (hasExited(child)) return Promise.resolve("already-exited");
  const graceMs = normalizeGraceMs(requestedGraceMs);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKill);
      clearTimeout(deadline);
      resolve(outcome);
    };

    const forceKill = setTimeout(() => {
      warn(
        `${label} — ${what} did not exit within ${graceMs}ms of SIGTERM; sending SIGKILL`,
      );
      child.kill("SIGKILL");
    }, graceMs);

    const deadline = setTimeout(() => {
      warn(
        `${label} — ${what} did not exit within ${graceMs * 2}ms even after SIGKILL; continuing anyway`,
      );
      finish("gave-up");
    }, graceMs * 2);

    child.once("exit", () => finish("exited"));
    child.once("close", () => finish("exited"));

    child.kill("SIGTERM");
  });
}

/**
 * `rmSync(path, { recursive, force })` that warns instead of throwing.
 *
 * Never let a leftover temp path change a script's verdict: on the success path
 * a throw here would fail a run that actually passed, and on a failure path it
 * would bury the real diagnostic under an rmSync stack. The OS reclaims tmpdir.
 *
 * @param {string} path
 * @param {object} [opts]
 * @param {string} [opts.label]
 * @param {(msg: string) => void} [opts.warn]
 * @returns {boolean} true if the path is gone — which includes a path that was
 *   never there, since `force: true` makes a missing path a no-op success.
 *   False means removal threw and a warning was emitted.
 */
export function removeSafe(
  path,
  { label = "cleanup", warn = console.warn } = {},
) {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch (err) {
    warn(`${label} — could not remove ${path}: ${err.message}`);
    return false;
  }
}
