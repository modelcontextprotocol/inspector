import type { ListPaginationControlsProps } from "../../components/elements/ListPaginationControls/ListPaginationControls";

/**
 * A no-op, all-pages-mode pagination model for tests and stories that don't
 * exercise single-page pagination but must satisfy the required `pagination`
 * prop threaded through the list screens/controls (#1721).
 */
export const noopPagination: ListPaginationControlsProps = {
  singlePage: false,
  onSinglePageChange: () => {},
  canLoadMore: false,
  loadedPages: 0,
  onLoadMore: () => {},
};
