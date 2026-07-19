import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedToolsState,
  PagedToolsStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedToolsState.js";
import type { Tool } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UsePagedToolsResult {
  tools: Tool[];
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
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
  const [tools, setTools] = useState<Tool[]>(pagedToolsState?.getTools() ?? []);
  const [nextCursor, setNextCursor] = useState<string | undefined>(
    pagedToolsState?.getPagination().nextCursor,
  );
  const [pageCount, setPageCount] = useState<number>(
    pagedToolsState?.getPagination().pageCount ?? 0,
  );

  useEffect(() => {
    if (!pagedToolsState) {
      setTools([]);
      setNextCursor(undefined);
      setPageCount(0);
      return;
    }
    setTools(pagedToolsState.getTools());
    setNextCursor(pagedToolsState.getPagination().nextCursor);
    setPageCount(pagedToolsState.getPagination().pageCount);
    const onToolsChange = (
      event: TypedEventGeneric<PagedToolsStateEventMap, "toolsChange">,
    ) => {
      setTools(event.detail);
    };
    const onPaginationChange = (
      event: TypedEventGeneric<PagedToolsStateEventMap, "paginationChange">,
    ) => {
      setNextCursor(event.detail.nextCursor);
      setPageCount(event.detail.pageCount);
    };
    pagedToolsState.addEventListener("toolsChange", onToolsChange);
    pagedToolsState.addEventListener("paginationChange", onPaginationChange);
    return () => {
      pagedToolsState.removeEventListener("toolsChange", onToolsChange);
      pagedToolsState.removeEventListener(
        "paginationChange",
        onPaginationChange,
      );
    };
  }, [pagedToolsState]);

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadPageResult> => {
      if (!pagedToolsState || !client) {
        return { tools: [], nextCursor: undefined };
      }
      return pagedToolsState.loadPage(cursor);
    },
    [client, pagedToolsState],
  );

  const clear = useCallback(() => {
    pagedToolsState?.clear();
  }, [pagedToolsState]);

  return { tools, nextCursor, pageCount, loadPage, clear };
}
