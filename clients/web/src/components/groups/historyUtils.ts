import type { MessageEntry, MessageMethod } from "@inspector/core/mcp/types.js";

export function extractMethod(entry: MessageEntry): MessageMethod {
  if ("method" in entry.message) {
    // Cast: SDK types message.method as `string`, but every entry in this
    // app's MessageEntry log originates from MCP SDK schemas.
    return entry.message.method as MessageMethod;
  }
  return "response";
}

/**
 * Request methods the History Replay action can re-issue (client→server reads
 * and calls). Server→client requests (roots/list, sampling, elicitation) and
 * side-effectful methods (logging/setLevel, subscribe) are intentionally
 * excluded. Single source of truth: `HistoryEntry` hides the Replay button for
 * anything not listed here, and App's `replayHistoryRequest` gates dispatch on
 * the same set.
 */
export const REPLAYABLE_HISTORY_METHODS: ReadonlySet<string> = new Set([
  "tools/call",
  "prompts/get",
  "resources/read",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "tasks/list",
  "ping",
]);

export function isReplayableHistoryMethod(method: string): boolean {
  return REPLAYABLE_HISTORY_METHODS.has(method);
}
