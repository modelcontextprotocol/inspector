import type { CallToolResult } from "@modelcontextprotocol/client";
import { ProtocolErrorCode } from "@modelcontextprotocol/client";

/** How a thrown `tools/call` error should be presented in the error panel. */
export type ToolCallErrorKind = "unknown-tool" | "invalid-params" | "generic";

/**
 * Whether a `-32602` message names the *tool itself* as unrecognized, as
 * opposed to reporting bad arguments for a known tool. Both reject with the same
 * `-32602 Invalid params` code under SDK v2, so the code alone can't tell them
 * apart — matching the message lets us pick the right heading instead of
 * labelling every `-32602` "Unknown Tool" (which would mislabel a known tool
 * called with invalid arguments).
 *
 * The match is deliberately tool-scoped so it doesn't INVERSELY mislabel: an
 * argument-validation message like `"property 'region' does not exist"` must
 * NOT read as "Unknown Tool". So the "not found / does not exist / unknown /
 * unrecognized" family only counts when the word "tool" is in the same clause
 * (the SDK's own message is `Tool <name> not found`); `unknown tool` / `no such
 * tool` are unambiguous on their own. Case-insensitive; best-effort — the fully
 * unambiguous signal would be a tool name in `error.data`, which the SDK does
 * not currently surface here.
 */
const UNKNOWN_TOOL_MESSAGE =
  /\b(unknown tool|no such tool)\b|\btool\b[^.!?]*\b(not found|not recognized|does not exist|is unknown|unrecognized)\b/i;

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
