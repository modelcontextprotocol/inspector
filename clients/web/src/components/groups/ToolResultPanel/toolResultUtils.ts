import type { CallToolResult } from "@modelcontextprotocol/client";
import { ProtocolErrorCode } from "@modelcontextprotocol/client";

/** How a thrown `tools/call` error should be presented in the error panel. */
export type ToolCallErrorKind = "unknown-tool" | "invalid-params" | "generic";

/**
 * Message fragments a server uses when the *tool itself* is unrecognized, as
 * opposed to bad arguments for a known tool. Both reject with the same
 * `-32602 Invalid params` code under SDK v2, so the code alone can't tell them
 * apart — matching the message lets us pick the right heading instead of
 * labelling every `-32602` "Unknown Tool" (which would mislabel a known tool
 * called with invalid arguments). Case-insensitive; best-effort.
 */
const UNKNOWN_TOOL_MESSAGE =
  /\b(not found|unknown tool|no such tool|not recognized|does not exist|unrecognized)\b/i;

/**
 * Classify a thrown tool-call error for display (#1632). Under SDK v2 an
 * unknown-tool `tools/call` REJECTS with `-32602 Invalid params` instead of
 * resolving an `isError` result — but so does a *known* tool called with
 * invalid arguments (server-side schema validation). We narrow the ambiguous
 * `-32602` to `"unknown-tool"` only when the message says so; any other
 * `-32602` is `"invalid-params"`, and every other code is `"generic"`.
 */
export function classifyToolCallError(
  errorCode?: number,
  message?: string,
): ToolCallErrorKind {
  if (errorCode !== ProtocolErrorCode.InvalidParams) return "generic";
  if (message && UNKNOWN_TOOL_MESSAGE.test(message)) return "unknown-tool";
  return "invalid-params";
}

/**
 * Whether a result renders a "Resource Links" box — i.e. a non-error result
 * with at least one `resource_link` block. Hosts use this to decide whether the
 * result surface should fill the available height (so the box can grow and
 * scroll internally); plain text/image results keep their content-sized card.
 */
export function resultHasResourceLinks(result: CallToolResult): boolean {
  return (
    !result.isError &&
    result.content.some((block) => block.type === "resource_link")
  );
}
