import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedResourcesState,
  PagedResourcesStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedResourcesState.js";
import type { Resource } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UsePagedResourcesResult {
  resources: Resource[];
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
  loadPage: (
    cursor?: string,
    metadata?: Record<string, string>,
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
  const [resources, setResources] = useState<Resource[]>(
    pagedResourcesState?.getResources() ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(
    pagedResourcesState?.getPagination().nextCursor,
  );
  const [pageCount, setPageCount] = useState<number>(
    pagedResourcesState?.getPagination().pageCount ?? 0,
  );

  useEffect(() => {
    if (!pagedResourcesState) {
      setResources([]);
      setNextCursor(undefined);
      setPageCount(0);
      return;
    }
    setResources(pagedResourcesState.getResources());
    setNextCursor(pagedResourcesState.getPagination().nextCursor);
    setPageCount(pagedResourcesState.getPagination().pageCount);
    const onResourcesChange = (
      event: TypedEventGeneric<PagedResourcesStateEventMap, "resourcesChange">,
    ) => {
      setResources(event.detail);
    };
    const onPaginationChange = (
      event: TypedEventGeneric<PagedResourcesStateEventMap, "paginationChange">,
    ) => {
      setNextCursor(event.detail.nextCursor);
      setPageCount(event.detail.pageCount);
    };
    pagedResourcesState.addEventListener("resourcesChange", onResourcesChange);
    pagedResourcesState.addEventListener(
      "paginationChange",
      onPaginationChange,
    );
    return () => {
      pagedResourcesState.removeEventListener(
        "resourcesChange",
        onResourcesChange,
      );
      pagedResourcesState.removeEventListener(
        "paginationChange",
        onPaginationChange,
      );
    };
  }, [pagedResourcesState]);

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: Record<string, string>,
    ): Promise<LoadPageResult> => {
      if (!pagedResourcesState || !client) {
        return { resources: [], nextCursor: undefined };
      }
      return pagedResourcesState.loadPage(cursor, metadata);
    },
    [client, pagedResourcesState],
  );

  const clear = useCallback(() => {
    pagedResourcesState?.clear();
  }, [pagedResourcesState]);

  return { resources, nextCursor, pageCount, loadPage, clear };
}
