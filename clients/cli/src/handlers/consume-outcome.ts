import { awaitableLog } from "../utils/awaitable-log.js";
import { emitResult } from "./emit-result.js";
import type { MethodArgs, MethodOutcome } from "./method-types.js";

/**
 * Write a {@link MethodOutcome} to stdout (result / NDJSON / long-lived stream).
 * Stream methods stay attached until SIGINT/SIGTERM.
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
