import type {
  ProtocolEra,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/client";
import { declaresAnyFields } from "@inspector/core/json/rootUnion.js";
import { listRowKey } from "./listRowKey";

/**
 * Returns the display label for an MCP entity that follows the BaseMetadata
 * shape (Tool, Prompt, Resource): the optional `title` if provided, else the
 * machine `name`. Centralized so list items, detail panels, and screens stay
 * consistent.
 */
export function resolveDisplayLabel(name: string, title?: string): string {
  return title ?? name;
}

// The sort itself lives in core so the TUI lists tools in the same order
// (#2827); re-exported here so web call sites keep one import surface.
export {
  compareToolLabels,
  compareToolsByLabel,
} from "@inspector/core/mcp/toolOrder.js";

/**
 * True when the tool's input schema declares at least one property — used by
 * App-flow callers to decide whether to render a form or auto-launch. Kept in
 * one place so the definition of "has fields" stays consistent if it ever
 * grows to consider `additionalProperties` etc.
 *
 * Root composition counts, since a schema declaring its fields on a root
 * `allOf`/`oneOf`/`anyOf` has none of its own (#2123) — an App tool with such a
 * schema would otherwise launch with empty arguments rather than asking for
 * them. Counted from the composition members directly rather than from a
 * resolved union, so a schema whose composition the form declines to flatten
 * still reports the fields it has: it renders fewer controls, not none, and
 * auto-invoking it would be wrong either way.
 */
export function hasInputFields(tool: Tool): boolean {
  return declaresAnyFields(tool.inputSchema);
}

/**
 * A tool's stable per-row identity in the Tools sidebar.
 *
 * A server may return the same tool name more than once, so the name alone
 * identifies neither a React child nor a selection: colliding keys let a
 * filtered-out row survive reconciliation (#1957), and a name-keyed selection
 * highlights both copies at once while the detail panel can only ever resolve
 * the first (#2001). The tool's position in the *unfiltered* list disambiguates
 * duplicates and stays stable while the search narrows, since it is captured
 * before filtering.
 *
 * This is a UI identity only — the wire identity is still `tool.name`, which is
 * what a `tools/call` must send.
 *
 * Shares {@link listRowKey} with the resource lists, which have the same defect
 * with duplicate URIs (#2206), so the two formats cannot drift apart.
 */
export function toolRowKey(name: string, sourceIndex: number): string {
  return listRowKey(name, sourceIndex);
}

/**
 * Resolves the tool a {@link toolRowKey} refers to, or `undefined` when the key
 * names no row in the current list (e.g. the list changed under a stale
 * selection). Compares computed keys rather than parsing the key, so the two
 * stay in lockstep if the format ever changes.
 */
export function findToolByRowKey(
  tools: Tool[],
  key: string | undefined,
): Tool | undefined {
  if (key === undefined) return undefined;
  return tools.find((tool, index) => toolRowKey(tool.name, index) === key);
}

/**
 * Whether the Tools tab offers a per-call "Run as task" choice: only on a
 * legacy (2025-11-25) connection whose server advertises
 * `tasks.requests.tools.call`. On a modern connection task creation is
 * server-directed (SEP-2663) — the server decides per request whether to return
 * a task — so there is no choice for the client to make, and every modern
 * `callTool` already accepts a returned handle (#2674). A server that also
 * carries the legacy capability on a modern connection does not change that.
 */
export function offersRunAsTask(
  protocolEra: ProtocolEra | undefined,
  capabilities: ServerCapabilities | undefined,
): boolean {
  return (
    protocolEra !== "modern" && !!capabilities?.tasks?.requests?.tools?.call
  );
}
