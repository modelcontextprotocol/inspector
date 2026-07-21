import type { CallToolResult } from "@modelcontextprotocol/client";
import { ProtocolErrorCode } from "@modelcontextprotocol/client";

/**
 * Whether a thrown tool-call error is the SDK-v2 unknown-tool rejection
 * (`-32602`). The tool the user tried to call is not one the server recognizes
 * — most often because it was excluded client-side (an invalid `x-mcp-header`
 * annotation) or removed since the list was last fetched. Under SDK v2 an
 * unknown-tool `tools/call` REJECTS with `-32602` instead of resolving an
 * `isError` result, so it reaches the error panel as a thrown error (#1632).
 */
export function isUnknownToolError(errorCode?: number): boolean {
  return errorCode === ProtocolErrorCode.InvalidParams;
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
