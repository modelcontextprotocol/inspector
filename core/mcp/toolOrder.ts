/**
 * The one order every client lists tools in (#2827): alphabetical by the label
 * the row shows, case-insensitive, with digit runs compared numerically.
 *
 * The web Tools sidebar adopted it first (#2782), on a user's request — an
 * unordered list of 20–30 tools is hard to scan — while the TUI kept the
 * server's `tools/list` order, so the same server read differently on the two
 * surfaces. Alphabetical is the less surprising of the two: a person looking
 * for a tool scans by name, and `tools/list` order is an accident of the
 * server's registration code rather than something it promises. Pure, so it
 * lives here for both the browser and the TUI to import.
 *
 * "The label the row shows" differs by surface on purpose: a web row shows
 * the `title` when present, a TUI row (and a web excluded-tool row) the bare
 * `name`. Each sorts by its own visible text, so the list always reads in
 * order; for the common tool with no `title` the two orders are identical.
 */

import type { Tool } from "@modelcontextprotocol/client";

// Case-insensitive, with digit runs compared numerically, so `tool_2` sorts
// before `tool_10` and `Git` beside `git` — the order a person scanning the
// list expects, rather than raw code-unit order.
const toolLabelCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/** Orders two row labels the way every tool list sorts. */
export function compareToolLabels(a: string, b: string): number {
  return toolLabelCollator.compare(a, b);
}

/**
 * Orders tools by their display label — the `title` when present, else the
 * `name`. Ties return 0, and `Array.prototype.sort` is stable, so duplicates
 * keep their source order.
 */
export function compareToolsByLabel(a: Tool, b: Tool): number {
  return compareToolLabels(a.title ?? a.name, b.title ?? b.name);
}

/** Orders tools by their bare `name`, for a row that shows only the name. */
export function compareToolsByName(a: Tool, b: Tool): number {
  return compareToolLabels(a.name, b.name);
}
