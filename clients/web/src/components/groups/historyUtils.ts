import type { MessageEntry } from "../../../../../core/mcp/types.js";

export function extractMethod(entry: MessageEntry): string {
  if ("method" in entry.message) {
    return entry.message.method;
  }
  return "response";
}
