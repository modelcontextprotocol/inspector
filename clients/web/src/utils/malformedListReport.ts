import type { MalformedListItem } from "@inspector/core/mcp";

/**
 * Which malformed-entry reports the UI may show, given the pagination mode
 * (#1909 + #1721).
 *
 * The report is produced by the salvage fallback inside the client's `listAll*`
 * aggregate walk. In **paginated** mode the tools, prompts, and resources
 * panels do not render that aggregate at all — they render the paged store,
 * which fetches one page at a time through a different path that neither writes
 * nor clears this report. So a report written while the list was aggregated
 * would simply persist, sitting above a freshly fetched page it does not
 * describe: the same warning over a page that may be perfectly conforming, with
 * indices that refer to positions in an aggregate the user is no longer
 * looking at.
 *
 * Suppressing is the honest option of the two available. The alternative —
 * giving the paged path its own per-page salvage and report — is a real feature
 * rather than a display fix, and showing a stale warning is worse than showing
 * none: this panel's whole purpose is to say which entry the server got wrong,
 * so pointing at the wrong entry costs more than staying quiet.
 *
 * Resource templates are deliberately NOT suppressed. That list has no paged
 * store — it is fetched through the aggregate in both modes — so its report is
 * always about the list actually on screen.
 */
const PAGED_LIST_METHODS: readonly string[] = [
  "tools/list",
  "prompts/list",
  "resources/list",
];

/**
 * The reports to render for the current pagination mode.
 *
 * Returns the input untouched in aggregate mode — the common case — so the
 * memoized identity is preserved and nothing re-renders for a filter that
 * removes nothing.
 */
export function visibleMalformedListItems(
  items: MalformedListItem[],
  paginated: boolean,
): MalformedListItem[] {
  if (!paginated) return items;
  return items.filter((item) => !PAGED_LIST_METHODS.includes(item.method));
}
