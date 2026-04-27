import type {
  MessageEntry,
  RequestMethod,
} from "../../../../../core/mcp/types.js";

export function extractMethod(entry: MessageEntry): RequestMethod {
  if ("method" in entry.message) {
    return entry.message.method as RequestMethod;
  }
  return "response";
}
