import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { RequestMetadata } from "../mcp/types.js";
import type {
  PagedResourcesState,
  LoadPageResult,
} from "../mcp/state/pagedResourcesState.js";
import type { PagePaginationState } from "../mcp/state/pagedToolsState.js";
import type { Resource } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import { NO_PAGINATION } from "./pagination.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_RESOURCES: Resource[] = [];

const readResources = (state: PagedResourcesState): Resource[] =>
  state.getResources();
const readPagination = (state: PagedResourcesState): PagePaginationState =>
  state.getPagination();

export interface UsePagedResourcesResult {
  resources: Resource[];
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
  /**
   * The last page load's failure, or `null` when it succeeded. In paginated
   * mode this store is the display source, so this — not the managed
   * store's error — is what the panel renders (#1998).
   */
  error: Error | null;
  loadPage: (
    cursor?: string,
    metadata?: RequestMetadata,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedResourcesState and returns resources +
 * pagination progress + loadPage. The state store owns loading; this mirrors
 * its observable state.
 */
export function usePagedResources(
  client: InspectorClientProtocol | null,
  pagedResourcesState: PagedResourcesState | null,
): UsePagedResourcesResult {
  const resources = useStoreSnapshot(
    pagedResourcesState,
    "resourcesChange",
    readResources,
    NO_RESOURCES,
  );
  const { nextCursor, pageCount } = useStoreSnapshot(
    pagedResourcesState,
    "paginationChange",
    readPagination,
    NO_PAGINATION,
  );

  const error = useListError(pagedResourcesState);

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: RequestMetadata,
    ): Promise<LoadPageResult> => {
      if (!pagedResourcesState || !client) {
        return { resources: NO_RESOURCES, nextCursor: undefined };
      }
      return pagedResourcesState.loadPage(cursor, metadata);
    },
    [client, pagedResourcesState],
  );

  const clear = useCallback(() => {
    pagedResourcesState?.clear();
  }, [pagedResourcesState]);

  return { resources, nextCursor, pageCount, error, loadPage, clear };
}
