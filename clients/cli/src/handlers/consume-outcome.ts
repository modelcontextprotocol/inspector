import { awaitableError, awaitableLog } from "../utils/awaitable-log.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { emitResult } from "./emit-result.js";
import type { MethodArgs, MethodOutcome } from "./method-types.js";

/**
 * True for the error a write to a closed pipe raises — the reader went away
 * (`| head`, `| grep -m1`, quitting `less`), which ends the stream normally.
 */
function isBrokenPipe(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === "EPIPE"
  );
}

/**
 * Write a {@link MethodOutcome} to stdout (result / NDJSON / long-lived stream).
 * Stream methods stay attached until SIGINT/SIGTERM, or until stdout fails:
 * EPIPE (the reader exited) ends the stream cleanly, and any other stdout error
 * is rejected into the CLI's error path (#2412). Without a listener either one
 * would be an uncaught `'error'` event and crash the process.
 */
export async function consumeMethodOutcome(
  outcome: MethodOutcome,
  args: MethodArgs,
): Promise<void> {
  if (outcome.kind === "result") {
    await emitResult(outcome.result, outcome.appInfo, args);
    return;
  }
  if (outcome.kind === "ndjson") {
    for (const line of outcome.lines) {
      await awaitableLog(JSON.stringify(line) + "\n");
    }
    // Summary on **stderr**, after the report, so it cannot contaminate the
    // NDJSON a consumer is parsing on stdout.
    if (outcome.summary) await awaitableError(`${outcome.summary}\n`);
    // Thrown rather than returned so it routes through the CLI's single exit
    // path — the report has already been written, which is why this is the
    // last thing that happens.
    if (outcome.exitCode) {
      throw new CliExitCodeError(outcome.exitCode, outcome.summary ?? "", {
        // The envelope's `code` follows the exit code, so a caller reading one
        // never has to reconcile it against the other.
        code:
          outcome.exitCode === EXIT_CODES.SKILL_INCOMPLETE
            ? "skills_incomplete"
            : "skills_nonconformant",
      });
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined;
    const detach = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.stdout.off("error", onStdoutError);
    };
    const finish = (err?: unknown) => {
      detach();
      stop?.();
      if (err === undefined) resolve();
      else reject(err);
    };
    const onSignal = () => finish();
    const onStdoutError = (err: unknown) =>
      finish(isBrokenPipe(err) ? undefined : err);
    // Attached before `start`, so a write it makes can never fail unobserved.
    process.stdout.on("error", onStdoutError);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      stop = outcome.start((obj) => {
        // A failed write surfaces as the stdout `'error'` event handled above.
        void awaitableLog(JSON.stringify(obj) + "\n");
      });
    } catch (err) {
      detach();
      reject(err);
    }
  });
}
