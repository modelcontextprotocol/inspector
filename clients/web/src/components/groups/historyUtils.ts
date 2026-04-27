import type { MessageEntry, MessageMethod } from "@inspector/core/mcp/types.js";

export function extractMethod(entry: MessageEntry): MessageMethod {
  if ("method" in entry.message) {
    // Cast: SDK types message.method as `string`, but every entry in this
    // app's MessageEntry log originates from MCP SDK schemas.
    return entry.message.method as MessageMethod;
  }
  return "response";
}
