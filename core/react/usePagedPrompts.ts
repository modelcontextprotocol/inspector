import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { RequestMetadata } from "../mcp/types.js";
import type {
  PagedPromptsState,
  LoadPageResult,
} from "../mcp/state/pagedPromptsState.js";
import type { PagePaginationState } from "../mcp/state/pagedToolsState.js";
import type { Prompt } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import { NO_PAGINATION } from "./pagination.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_PROMPTS: Prompt[] = [];

const readPrompts = (state: PagedPromptsState): Prompt[] => state.getPrompts();
const readPagination = (state: PagedPromptsState): PagePaginationState =>
  state.getPagination();

export interface UsePagedPromptsResult {
  prompts: Prompt[];
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
 * React hook that subscribes to PagedPromptsState and returns prompts +
 * pagination progress + loadPage. The state store owns loading; this mirrors
 * its observable state.
 */
export function usePagedPrompts(
  client: InspectorClientProtocol | null,
  pagedPromptsState: PagedPromptsState | null,
): UsePagedPromptsResult {
  const prompts = useStoreSnapshot(
    pagedPromptsState,
    "promptsChange",
    readPrompts,
    NO_PROMPTS,
  );
  const { nextCursor, pageCount } = useStoreSnapshot(
    pagedPromptsState,
    "paginationChange",
    readPagination,
    NO_PAGINATION,
  );

  const error = useListError(pagedPromptsState);

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: RequestMetadata,
    ): Promise<LoadPageResult> => {
      if (!pagedPromptsState || !client) {
        return { prompts: NO_PROMPTS, nextCursor: undefined };
      }
      return pagedPromptsState.loadPage(cursor, metadata);
    },
    [client, pagedPromptsState],
  );

  const clear = useCallback(() => {
    pagedPromptsState?.clear();
  }, [pagedPromptsState]);

  return { prompts, nextCursor, pageCount, error, loadPage, clear };
}
