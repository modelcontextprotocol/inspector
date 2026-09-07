import { awaitableError, awaitableLog } from "../utils/awaitable-log.js";
import { CliExitCodeError } from "../error-handler.js";
import { emitResult } from "./emit-result.js";
import type { MethodArgs, MethodOutcome } from "./method-types.js";

/**
 * Write a {@link MethodOutcome} to stdout (result / NDJSON / long-lived stream).
 * Stream methods stay attached until SIGINT/SIGTERM.
 *
 * TODO(#1432): long-lived stream path does not yet handle EPIPE / stdout error
 * (session CLI / `mcpi` follow-up).
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
        code: "skills_nonconformant",
      });
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const stop = outcome.start((obj) => {
      void awaitableLog(JSON.stringify(obj) + "\n");
    });
    const onSignal = () => {
      stop();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
