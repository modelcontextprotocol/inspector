import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { PagedResourcesState } from "../mcp/state/pagedResourcesState.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type {
  PagedResourcesStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedResourcesState.js";

export interface UsePagedResourcesResult {
  resources: Resource[];
  loadPage: (
    cursor?: string,
    metadata?: Record<string, string>,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedResourcesState and returns resources + loadPage.
 */
export function usePagedResources(
  client: InspectorClient | null,
  pagedResourcesState: PagedResourcesState | null,
): UsePagedResourcesResult {
  const [resources, setResources] = useState<Resource[]>(
    pagedResourcesState?.getResources() ?? [],
  );

  useEffect(() => {
    if (!pagedResourcesState) {
      setResources([]);
      return;
    }
    setResources(pagedResourcesState.getResources());
    const onResourcesChange = (
      event: TypedEventGeneric<PagedResourcesStateEventMap, "resourcesChange">,
    ) => {
      setResources(event.detail);
    };
    pagedResourcesState.addEventListener("resourcesChange", onResourcesChange);
    return () => {
      pagedResourcesState.removeEventListener(
        "resourcesChange",
        onResourcesChange,
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
      const result = await pagedResourcesState.loadPage(cursor, metadata);
      setResources(pagedResourcesState.getResources());
      return result;
    },
    [client, pagedResourcesState],
  );

  const clear = useCallback(() => {
    pagedResourcesState?.clear();
  }, [pagedResourcesState]);

  return { resources, loadPage, clear };
}
