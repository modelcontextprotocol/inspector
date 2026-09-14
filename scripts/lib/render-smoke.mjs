/**
 * Spawn a terminal app, wait for it to paint a marker, and then wait again to
 * see whether it is still running (#2147).
 *
 * Extracted from `scripts/smoke-tui.mjs` for the same reason
 * `announced-child.mjs` was extracted from `smoke-web-app.mjs` (#2000): a smoke
 * script only ever exercises its own happy path, so the branch that matters
 * most here — a child that paints the marker and *then* dies — is unreachable
 * from the real TUI once it is fixed. Driving this from a test against a stub
 * that paints and immediately exits 1 is what keeps the assertion honest.
 *
 * The defect it encodes against: `smoke:tui` used to resolve OK the instant the
 * marker appeared and never looked at the child again. The TUI was exiting 1
 * about 40ms later, every run, on every machine, and the smoke won that race
 * and printed OK. So it asserted "painted once", while its own header claimed
 * "boots and renders without crashing". Worse, the race cut both ways: had the
 * `exit` event been processed first, the same run would have failed, which
 * reads as flake rather than as the standing defect it was.
 *
 * Hence `surviveMs`. First paint is not survival, and nothing shorter than an
 * explicit "still alive N ms later" check can tell the two apart.
 */

import { spawn } from "node:child_process";

/**
 * Fallback durations, in ms. These are defaults, NOT minimums: `normalizeMs`
 * accepts any finite positive value, and the tests deliberately pass shorter
 * ones. What it rejects is the shape a bad env var produces, not smallness.
 */
export const DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  surviveMs: 2_000,
  exitGraceMs: 5_000,
  drainMs: 500,
});

/**
 * Coerce a caller-supplied duration to a usable one, mirroring
 * `child-cleanup.mjs`'s `normalizeGraceMs`.
 *
 * Call sites read these from the environment, and `Number()` there has two
 * holes that `??` does not cover: `Number("")` is `0` and `Number("typo")` is
 * `NaN`. `setTimeout` treats both as "fire immediately" — which for `surviveMs`
 * means the survival check resolves before the child could possibly have died,
 * silently restoring the exact first-paint false green this module exists to
 * prevent, on a run that still prints OK. Falling back is therefore not
 * defensive tidiness; it is the difference between a gate and a decoration.
 *
 * A consequence worth stating: `surviveMs: 0` is NOT honored as "skip the
 * survival wait". There is no legitimate caller for that here, and reading it
 * literally is indistinguishable from the typo.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeMs(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Tail of a child's output, for quoting in a diagnostic. Slicing a terminal
 * stream can land mid-CSI-sequence, so drop through the first newline rather
 * than lead with an escape-code fragment that mangles the line after it.
 *
 * @param {string} output
 * @param {number} [limit]
 * @returns {string}
 */
export function outputTail(output, limit = 800) {
  const tail = output.slice(-limit);
  const nl = tail.indexOf("\n");
  return output.length > limit && nl !== -1 ? tail.slice(nl + 1) : tail;
}

/**
 * @param {object} opts
 * @param {string} opts.command             Executable to spawn.
 * @param {string[]} [opts.args]            Arguments for it.
 * @param {object} [opts.spawnOptions]      Merged into the `spawn` options
 *                                          (`stdio` is fixed — see below).
 * @param {string} opts.marker              Substring whose appearance in the
 *                                          child's output counts as first paint.
 * @param {number} [opts.timeoutMs]         Budget for first paint (default 15s;
 *                                          non-finite/non-positive falls back).
 * @param {number} [opts.surviveMs]         How long after first paint the child
 *                                          must stay alive (default 2s;
 *                                          non-finite/non-positive falls back —
 *                                          0 is a typo, never "skip the check").
 * @param {number} [opts.exitGraceMs]       SIGTERM → SIGKILL grace (default 5s;
 *                                          non-finite/non-positive falls back).
 * @param {number} [opts.drainMs]           Post-exit pipe-drain cap (default 500ms;
 *                                          non-finite/non-positive falls back).
 * @param {(child: import("node:child_process").ChildProcess) => void} [opts.onSpawn]
 *   Called synchronously with the child, before any waiting — the caller's
 *   teardown handle on every failure path.
 * @param {{ pattern: RegExp, reason: string }} [opts.forbidOutput]
 *   Text that must NOT appear in an otherwise-passing run. `smoke:tui` uses it
 *   for Ink's raw-mode error: survival already implies its absence *today*,
 *   because that throw is fatal — but if Ink ever degraded it to a warning, a
 *   TUI with no keyboard input would survive happily and pass. Checked here
 *   rather than at the call site so it runs against the fully drained output
 *   and is reachable from a test. Use a non-global RegExp: `test()` on a `/g`
 *   pattern advances `lastIndex` and alternates.
 * @param {(message: string) => void} [opts.warn]
 * @returns {Promise<{ code: 0 | 1, message: string, output: string }>}
 *   On the normal path, resolves only after the child's streams have `close`d —
 *   so `output` is complete and the caller may remove a directory the child was
 *   using without re-entering the #1801 ENOTEMPTY race.
 *
 *   That is **bounded, not guaranteed**. Both drain deadlines below resolve
 *   *without* having observed `close`, after warning: the child may still hold
 *   the dir, and `output` may be truncated mid-line. Cleanup at the call site
 *   must therefore be best-effort (`removeSafe`, not `rmSync`) — the worst case
 *   is a warning and a leaked temp dir, never a red smoke. Do not write a
 *   caller that depends on the close having happened.
 */
export function runRenderSmoke({
  command,
  args = [],
  spawnOptions = {},
  marker,
  timeoutMs: requestedTimeoutMs,
  surviveMs: requestedSurviveMs,
  exitGraceMs: requestedExitGraceMs,
  drainMs: requestedDrainMs,
  forbidOutput,
  onSpawn = () => {},
  warn = (m) => console.warn(m),
}) {
  // Normalized rather than defaulted, so an env-derived 0/NaN cannot reach a
  // `setTimeout` — see `normalizeMs`. Done once, before anything reads them,
  // so the interpolated durations in the messages below can't read `NaNms`.
  const timeoutMs = normalizeMs(requestedTimeoutMs, DEFAULTS.timeoutMs);
  const surviveMs = normalizeMs(requestedSurviveMs, DEFAULTS.surviveMs);
  const exitGraceMs = normalizeMs(requestedExitGraceMs, DEFAULTS.exitGraceMs);
  const drainMs = normalizeMs(requestedDrainMs, DEFAULTS.drainMs);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      // stdin is `ignore` (i.e. /dev/null) deliberately, even under a PTY: BSD
      // `script` refuses to start when its own stdin is a pipe
      // ("tcgetattr/ioctl: Operation not supported on socket"). It reads the
      // immediate EOF and forwards one ^D into the pty before the app mounts,
      // which is harmless — verified against the real TUI, which survives it.
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Publish before waiting, so every path below leaves the caller holding a
    // stoppable handle rather than an orphan (the #2000 rule).
    onSpawn(child);

    let output = "";
    let settled = false;
    let finished = false;
    let childExited = false;
    let childClosed = false;
    let markerAt = null;
    /**
     * Both deadlines. Declared up front because `onData` and `done` each clear
     * them from closures defined above the `setTimeout` calls that assign them.
     *
     * @type {ReturnType<typeof setTimeout> | undefined}
     */
    let surviveTimer;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let renderTimer;

    const t0 = Date.now();
    const since = () => Date.now() - t0;

    const finish = (code, message) => {
      if (finished) return;
      finished = true;
      let verdict = code;
      let text = typeof message === "function" ? message() : message;
      // Only ever turns a pass into a failure. A run that already failed keeps
      // its own diagnostic: the crash reason is the more useful of the two, and
      // forbidden output is usually a *symptom* of it rather than a separate
      // finding.
      if (verdict === 0 && forbidOutput?.pattern.test(output)) {
        verdict = 1;
        text = `${forbidOutput.reason}\n${outputTail(output)}`;
      }
      resolve({ code: verdict, message: text, output });
    };

    // Settle the verdict, then wait for the child to actually close before
    // resolving (#1801). The caller's work dir doubles as the app's HOME, so it
    // is still being written to when we signal; removing it while those writes
    // land fails with ENOTEMPTY. Waiting on `close` rather than `exit` also
    // covers a *spawn failure*, which emits `error` + `close` and never `exit`
    // — and guarantees the pipes are drained, which is what makes the thunked
    // messages below complete rather than truncated at the interesting line.
    //
    // Deliberately not `lib/child-cleanup.mjs`'s `stopChild()`: that resolves
    // on the FIRST of exit/close, whereas this wait must keep going for `close`
    // after `exit`, on a shorter re-armed deadline, for the drain.
    const done = (code, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(renderTimer);
      clearTimeout(surviveTimer);
      if (childClosed) {
        finish(code, message);
        return;
      }
      const forceKill = setTimeout(() => child.kill("SIGKILL"), exitGraceMs);

      let deadline;
      const armDeadline = (ms, warning) => {
        clearTimeout(deadline);
        deadline = setTimeout(() => {
          warn(`render-smoke — ${warning}`);
          finish(code, message);
        }, ms);
      };
      armDeadline(
        exitGraceMs * 2,
        `child did not close its output streams within ${exitGraceMs * 2}ms; giving up on the drain`,
      );

      // Once the child itself is gone only the pipe drain remains, so the wait
      // drops to `drainMs`. `close` is bounded by whoever holds the stdio
      // pipes, which can outlive the direct child: any descendant that
      // inherited them keeps it pending.
      const drainOnly = () => {
        clearTimeout(forceKill);
        armDeadline(
          drainMs,
          `child exited but held its output streams open for ${drainMs}ms (a descendant may have inherited them); giving up on the drain`,
        );
      };
      if (childExited) drainOnly();
      else child.once("exit", drainOnly);

      child.once("close", () => {
        clearTimeout(forceKill);
        clearTimeout(deadline);
        finish(code, message);
      });

      // Only signal a child that is still running: on the crash and
      // spawn-failure paths there is nothing left to signal, and we are here
      // purely to wait out the remaining `close`.
      if (
        child.exitCode === null &&
        child.signalCode === null &&
        !child.killed
      ) {
        child.kill("SIGTERM");
      }
    };

    const onData = (chunk) => {
      output += chunk.toString();
      if (markerAt !== null || !output.includes(marker)) return;
      markerAt = since();
      // Disarm the first-paint deadline. It is first-caller-wins with `done`,
      // so leaving it armed means a paint landing near `timeoutMs` lets it fire
      // *during* the survival window and settle the run as "did not render
      // <marker>" — quoting an output tail that visibly contains the marker.
      // First paint has happened; its deadline no longer has a question to ask.
      clearTimeout(renderTimer);
      // `exit` can beat the last of the child's buffered output, and `done`
      // then keeps reading until `close` — so this can run *after* the verdict
      // is settled. Recording `markerAt` is still right (the deferred message
      // below reads it, and a marker that only surfaced in the drain was still
      // painted). Arming a timer is not: `done` is a no-op once settled, so it
      // could not change the result, but it holds the event loop open for the
      // whole survival window — which under `node --test` is a suite that
      // hangs on for two seconds per case for no reason.
      if (settled) return;
      // First paint is not the verdict — it only starts the clock on the
      // question this smoke actually asks.
      surviveTimer = setTimeout(() => {
        done(
          0,
          `rendered "${marker}" at ${markerAt}ms and was still running ${surviveMs}ms later`,
        );
      }, surviveMs);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    // Registered before done()'s own one-shot listener, so this always runs
    // first — done() can trust `childClosed` even when called from a handler.
    child.on("close", () => {
      childClosed = true;
    });

    child.on("exit", (code, signal) => {
      childExited = true;
      const exitAt = since();
      if (settled) return;
      const how = signal ? `signal ${signal}` : `code ${code}`;
      // Thunked: rendered at `finish()`, i.e. after `close`, so `markerAt` is
      // whatever the FULL output showed — a marker still sitting in the pipe
      // when `exit` fired is accounted for by the time this is read.
      //
      // Deliberately makes no claim about the order in which this process
      // *observed* the two. `exit` and the last `data` event race, so a
      // "N ms later" phrased off observation times would flip wording (and
      // sign) run to run on the same child. The times are reported as the
      // observations they are and the verdict does not rest on them.
      done(1, () =>
        markerAt === null
          ? `child exited (${how}) before rendering "${marker}"\n${outputTail(output)}`
          : `child rendered "${marker}" and then exited (${how}) inside the ` +
            `${surviveMs}ms survival window — it painted one frame, it did not run ` +
            `(first paint seen at ${markerAt}ms, exit at ${exitAt}ms)` +
            `\n${outputTail(output)}`,
      );
    });

    child.on("error", (err) => {
      done(1, `failed to spawn ${command}: ${err.message}`);
    });

    renderTimer = setTimeout(() => {
      done(
        1,
        () =>
          `child did not render "${marker}" within ${timeoutMs}ms\n${outputTail(output)}`,
      );
    }, timeoutMs);
  });
}
