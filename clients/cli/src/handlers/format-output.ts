import { awaitableLog } from "../utils/awaitable-log.js";

export type OutputFormat = "text" | "json";

/**
 * Write a command result to stdout. Text = pretty-printed JSON; json = single
 * `{ "result": … }` envelope (same family as one-shot `--format json`).
 */
export async function writeFormattedResult(
  result: unknown,
  format: OutputFormat = "text",
): Promise<void> {
  if (format === "json") {
    await awaitableLog(JSON.stringify({ result }) + "\n");
    return;
  }
  await awaitableLog(JSON.stringify(result, null, 2) + "\n");
}
