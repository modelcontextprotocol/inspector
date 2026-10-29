import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import type {
  LoadStop,
  LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";

/**
 * Ctrl+C / SIGTERM for a one-shot `--load` run (#2834).
 *
 * Without this the CLI had no SIGINT listener during a run, so Node's default
 * handler killed the process and every number from the run was lost — the
 * moment they are most wanted (the server was struggling, or a CI job hit its
 * timeout and sent SIGTERM). Here the FIRST signal aborts the engine's
 * `signal`: no further call starts, in-flight calls settle, and the caller
 * prints the partial summary (marked `stoppedEarly.reason: "interrupted"`)
 * before exiting 130 via {@link assertNotInterrupted}. A SECOND signal exits
 * 130 at once, for a run whose in-flight calls will not settle.
 *
 * ⚠️ **A repeat of the first signal inside {@link REPEAT_GRACE_MS} is not a
 * second press.** Dependencies of the CLI hook signals too, and `when-exit`
 * (via `atomically`) runs its cleanups on SIGINT/SIGTERM and then
 * unconditionally re-raises the signal with `process.kill(process.pid, …)`.
 * That copy reaches this listener a moment after the first, and counting it
 * as Ctrl+C #2 exited 130 before the partial summary was written — which only
 * a real signal to the built binary showed. Telling the copy apart by origin
 * is not possible from a listener, so the window is the discriminator: the
 * re-raise lands within milliseconds, and a person who means "exit now"
 * presses again after reading the line this prints. A press inside the window
 * is dropped, and the next one exits.
 *
 * The listeners exist only while `run` is pending, so a signal before or after
 * the run keeps Node's default behaviour, and an in-process caller (the
 * launcher, the test runner) is left with no stray listener.
 */
/** How long after the first signal a repeat of it is treated as a re-raise. */
export const REPEAT_GRACE_MS = 500;

export async function withLoadInterrupt<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: {
    quiet?: boolean;
    /** Injected by tests; the real one ends the process. */
    exit?: (code: number) => void;
    /** Injected by tests; milliseconds on a monotonic clock. */
    now?: () => number;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const now = options.now ?? (() => performance.now());
  let first: { signal: NodeJS.Signals; at: number } | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (first !== undefined) {
      // A dependency's re-raise of the first signal, not a second press.
      if (signal === first.signal && now() - first.at < REPEAT_GRACE_MS) {
        return;
      }
      exit(EXIT_CODES.INTERRUPTED);
      return;
    }
    first = { signal, at: now() };
    const stop: LoadStop = {
      reason: "interrupted",
      detail: `received ${signal}`,
    };
    controller.abort(stop);
    if (!options.quiet) {
      process.stderr.write(
        `Interrupted (${signal}): no further calls will start; waiting for in-flight calls to finish. Press Ctrl+C again to exit now.\n`,
      );
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await run(controller.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/**
 * After the summary is printed: exit 130 (`interrupted`) when the run was
 * cut short by Ctrl+C / SIGTERM, the conventional status for a process ended
 * by SIGINT. Checked before any `--load-max-*` threshold, since a partial run
 * is not a verdict on the server.
 */
export function assertNotInterrupted(summary: LoadSummary): void {
  if (summary.stoppedEarly?.reason !== "interrupted") return;
  throw new CliExitCodeError(
    EXIT_CODES.INTERRUPTED,
    `Load run interrupted (${summary.stoppedEarly.detail}); the summary covers the ${summary.requests} calls that completed.`,
    { code: "interrupted" },
  );
}
