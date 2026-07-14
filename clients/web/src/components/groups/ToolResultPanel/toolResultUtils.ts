import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
