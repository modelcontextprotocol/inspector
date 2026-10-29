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
 * The listeners exist only while `run` is pending, so a signal before or after
 * the run keeps Node's default behaviour, and an in-process caller (the
 * launcher, the test runner) is left with no stray listener.
 */
export async function withLoadInterrupt<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: {
    quiet?: boolean;
    /** Injected by tests; the real one ends the process. */
    exit?: (code: number) => void;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const onSignal = (signal: NodeJS.Signals): void => {
    if (controller.signal.aborted) {
      exit(EXIT_CODES.INTERRUPTED);
      return;
    }
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
