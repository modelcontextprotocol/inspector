import { Button, Group, Stack, Switch, Text } from "@mantine/core";

export interface ListPaginationControlsProps {
  /**
   * True when the list is fetched one page at a time (backed by the server's
   * `singlePageLists` setting). False = auto-aggregate every page on load.
   */
  singlePage: boolean;
  /** Toggle single-page mode. Wired to write the `singlePageLists` setting. */
  onSinglePageChange: (singlePage: boolean) => void;
  /** Single-page mode only: the server returned a `nextCursor` to load. */
  canLoadMore: boolean;
  /** Single-page mode only: number of pages loaded so far (status label). */
  loadedPages: number;
  /** Single-page mode only: fetch the next page. */
  onLoadMore: () => void;
}

const ModeSwitch = Switch.withProps({
  size: "sm",
  "aria-label": "Fetch lists one page at a time",
});

const LoadMoreRow = Group.withProps({
  justify: "space-between",
  gap: "xs",
  wrap: "nowrap",
});

const LoadMoreButton = Button.withProps({
  size: "compact-sm",
  variant: "light",
});

const StatusText = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

/**
 * Sidebar control for a paginated list (Tools/Resources/Prompts). A "Single
 * page" switch toggles between auto-aggregating every page and fetching one
 * page at a time; in single-page mode a "Load next page" button surfaces the
 * server's `nextCursor` and a status line shows how many pages are loaded.
 */
export function ListPaginationControls({
  singlePage,
  onSinglePageChange,
  canLoadMore,
  loadedPages,
  onLoadMore,
}: ListPaginationControlsProps) {
  return (
    <Stack gap="xs">
      <ModeSwitch
        label="Single page"
        checked={singlePage}
        onChange={(e) => onSinglePageChange(e.currentTarget.checked)}
      />
      {singlePage ? (
        <LoadMoreRow>
          <LoadMoreButton disabled={!canLoadMore} onClick={onLoadMore}>
            Load next page
          </LoadMoreButton>
          <StatusText>
            {loadedPages} {loadedPages === 1 ? "page" : "pages"} loaded
            {canLoadMore ? "" : " · end"}
          </StatusText>
        </LoadMoreRow>
      ) : null}
    </Stack>
  );
}
