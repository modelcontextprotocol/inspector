import { Button, Group, Stack, Switch, Text } from "@mantine/core";

export interface ListPaginationControlsProps {
  /**
   * True when the list is fetched one page at a time (backed by the server's
   * `paginatedLists` setting). False = auto-aggregate every page on load.
   */
  paginated: boolean;
  /** Toggle paginated mode. Wired to write the `paginatedLists` setting. */
  onPaginatedChange: (paginated: boolean) => void;
  /** Paginated mode only: the server returned a `nextCursor` to load. */
  canLoadMore: boolean;
  /** Paginated mode only: number of pages loaded so far (status label). */
  loadedPages: number;
  /** Paginated mode only: fetch the next page. */
  onLoadMore: () => void;
  /**
   * Whether the list has finished its first load this connection. Not read by
   * this control — it rides along so the list header beside it can withhold
   * its count until there is one to show (#2607). Absent means loaded.
   */
  loaded?: boolean;
}

// Switch fully left, "Load next page" fully right; the page-count sits on its
// own line under the row.
const ControlsRow = Group.withProps({
  gap: "sm",
  align: "center",
  justify: "space-between",
  wrap: "nowrap",
});

const ModeSwitch = Switch.withProps({
  size: "sm",
  "aria-label": "Fetch lists one page at a time",
});

const LoadMoreButton = Button.withProps({
  size: "compact-sm",
  variant: "light",
});

const StatusText = Text.withProps({
  size: "xs",
  ta: "center",
  c: "var(--inspector-text-secondary)",
});

/**
 * Sidebar control for a paginated list (Tools/Resources/Prompts). A "Paginated"
 * switch toggles between auto-aggregating every page and fetching one page at a
 * time; in paginated mode a "Load next page" button (to the right of the
 * switch) surfaces the server's `nextCursor` and a status shows how many pages
 * are loaded. Hidden entirely once the list is known to be a single page, since
 * there's nothing to paginate.
 */
export function ListPaginationControls({
  paginated,
  onPaginatedChange,
  canLoadMore,
  loadedPages,
  onLoadMore,
}: ListPaginationControlsProps) {
  // The list turned out to be a single page (loaded page 1, no `nextCursor`):
  // pagination is moot, so hide the whole control rather than show a useless
  // toggle + disabled button (#1721).
  if (paginated && !canLoadMore && loadedPages === 1) return null;

  return (
    <Stack gap={4}>
      <ControlsRow>
        <ModeSwitch
          label="Paginated"
          checked={paginated}
          onChange={(e) => onPaginatedChange(e.currentTarget.checked)}
        />
        {paginated ? (
          <LoadMoreButton disabled={!canLoadMore} onClick={onLoadMore}>
            Load next page
          </LoadMoreButton>
        ) : null}
      </ControlsRow>
      {paginated ? (
        <StatusText>
          {loadedPages} {loadedPages === 1 ? "page" : "pages"} loaded
          {canLoadMore ? "" : " · end"}
        </StatusText>
      ) : null}
    </Stack>
  );
}
