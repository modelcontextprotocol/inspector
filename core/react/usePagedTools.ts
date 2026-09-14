import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedToolsState,
  PagePaginationState,
  LoadPageResult,
} from "../mcp/state/pagedToolsState.js";
import type { Tool } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import { NO_PAGINATION } from "./pagination.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_TOOLS: Tool[] = [];

const readTools = (state: PagedToolsState): Tool[] => state.getTools();
const readPagination = (state: PagedToolsState): PagePaginationState =>
  state.getPagination();

export interface UsePagedToolsResult {
  tools: Tool[];
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
  loadPage: (cursor?: string) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedToolsState and returns tools + pagination
 * progress + loadPage. The state store owns loading (incl. the connect-time
 * page-1 load in paginated mode); this hook just mirrors its observable
 * state.
 */
export function usePagedTools(
  client: InspectorClientProtocol | null,
  pagedToolsState: PagedToolsState | null,
): UsePagedToolsResult {
  const tools = useStoreSnapshot(
    pagedToolsState,
    "toolsChange",
    readTools,
    NO_TOOLS,
  );
  const { nextCursor, pageCount } = useStoreSnapshot(
    pagedToolsState,
    "paginationChange",
    readPagination,
    NO_PAGINATION,
  );

  const error = useListError(pagedToolsState);

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadPageResult> => {
      if (!pagedToolsState || !client) {
        return { tools: NO_TOOLS, nextCursor: undefined };
      }
      return pagedToolsState.loadPage(cursor);
    },
    [client, pagedToolsState],
  );

  const clear = useCallback(() => {
    pagedToolsState?.clear();
  }, [pagedToolsState]);

  return { tools, nextCursor, pageCount, error, loadPage, clear };
}
