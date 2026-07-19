import { useCallback } from "react";

/**
 * The list + pagination controls a screen renders, produced by
 * {@link usePaginatedList}. `items` is already the correct source for the
 * active mode (the aggregate list in all-pages mode, the accumulated paged
 * list in paginated mode).
 */
export interface PaginatedListModel<T> {
  items: T[];
  /** True when fetching one page at a time (the `paginatedLists` setting). */
  paginated: boolean;
  /** Paginated mode: the server returned a `nextCursor` still to load. */
  canLoadMore: boolean;
  /** Paginated mode: pages loaded so far. */
  loadedPages: number;
  /**
   * Paginated mode: fetch the next page (no-op otherwise). Returns the load
   * promise so the caller can wrap it in auth recovery.
   */
  onLoadMore: () => Promise<unknown>;
  /**
   * Refresh the list: reload page 1 in paginated mode, or re-fetch the whole
   * aggregate in all-pages mode. This is what the list-changed indicator's
   * Refresh button calls. Returns the underlying promise so the caller can wrap
   * it in auth recovery.
   */
  onRefresh: () => Promise<unknown>;
}

export interface UsePaginatedListParams<T> {
  /** Whether the client is connected (masks the paged progress when not). */
  connected: boolean;
  /** The `paginatedLists` server setting (the active mode). */
  paginated: boolean;
  /** The auto-aggregated list (all-pages mode display source). */
  managedItems: T[];
  /** Re-fetch the whole aggregate (all-pages mode Refresh). */
  managedRefresh: () => Promise<unknown>;
  /** The accumulated paged list (paginated mode display source). */
  pagedItems: T[];
  /** The paged store's current `nextCursor` (undefined = at the end). */
  pagedNextCursor?: string;
  /** The paged store's page count (page 1 = 1). */
  pagedPageCount: number;
  /** Fetch one page; `undefined` cursor = page 1 (replaces the paged list). */
  loadPage: (cursor?: string) => Promise<unknown>;
}

/**
 * Select a list's display source and pagination controls between the managed
 * (auto-aggregate-all-pages) and paged (one-page-at-a-time) state stores,
 * driven by the `paginatedLists` server setting (#1721).
 *
 * Loading is owned by the state stores, not this hook: the paged store
 * auto-loads page 1 on connect in paginated mode (and the managed store skips
 * its all-page walk there), so this hook is pure — it derives the display list,
 * the load-more affordance, and a mode-aware Refresh from store state. Mode
 * *changes* (which trigger a load) are driven from the sidebar toggle handler
 * in App, keeping data-loading out of React effects.
 */
export function usePaginatedList<T>({
  connected,
  paginated,
  managedItems,
  managedRefresh,
  pagedItems,
  pagedNextCursor,
  pagedPageCount,
  loadPage,
}: UsePaginatedListParams<T>): PaginatedListModel<T> {
  const onLoadMore = useCallback((): Promise<unknown> => {
    if (pagedNextCursor === undefined) return Promise.resolve();
    return loadPage(pagedNextCursor);
  }, [pagedNextCursor, loadPage]);

  const onRefresh = useCallback((): Promise<unknown> => {
    return paginated ? loadPage(undefined) : managedRefresh();
  }, [paginated, loadPage, managedRefresh]);

  return {
    items: paginated ? pagedItems : managedItems,
    paginated,
    // Masked by `connected`: while disconnected there is no page to load and no
    // meaningful page count (the store resets on disconnect).
    canLoadMore: connected && paginated && pagedNextCursor !== undefined,
    loadedPages: connected ? pagedPageCount : 0,
    onLoadMore,
    onRefresh,
  };
}
