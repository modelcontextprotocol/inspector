import type { PagePaginationState } from "../mcp/state/pagedToolsState.js";

/**
 * The pagination snapshot reported while no paged store is attached (no
 * active server): nothing loaded, nowhere to go next.
 *
 * Module scope and frozen because it is a `useStoreSnapshot` fallback — a
 * fresh object literal per render would make the snapshot look different on
 * every read. Shared by the three `usePaged*` list hooks, which is safe
 * precisely because it is immutable.
 */
export const NO_PAGINATION: PagePaginationState = Object.freeze({
  nextCursor: undefined,
  pageCount: 0,
});
