import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedToolsState,
  PagedToolsStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedToolsState.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UsePagedToolsResult {
  tools: Tool[];
  loadPage: (cursor?: string) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedToolsState and returns tools + loadPage.
 */
export function usePagedTools(
  client: InspectorClientProtocol | null,
  pagedToolsState: PagedToolsState | null,
): UsePagedToolsResult {
  const [tools, setTools] = useState<Tool[]>(
    pagedToolsState?.getTools() ?? [],
  );

  useEffect(() => {
    if (!pagedToolsState) {
      setTools([]);
      return;
    }
    setTools(pagedToolsState.getTools());
    const onToolsChange = (
      event: TypedEventGeneric<PagedToolsStateEventMap, "toolsChange">,
    ) => {
      setTools(event.detail);
    };
    pagedToolsState.addEventListener("toolsChange", onToolsChange);
    return () => {
      pagedToolsState.removeEventListener("toolsChange", onToolsChange);
    };
  }, [pagedToolsState]);

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadPageResult> => {
      if (!pagedToolsState || !client) {
        return { tools: [], nextCursor: undefined };
      }
      const result = await pagedToolsState.loadPage(cursor);
      setTools(pagedToolsState.getTools());
      return result;
    },
    [client, pagedToolsState],
  );

  const clear = useCallback(() => {
    pagedToolsState?.clear();
  }, [pagedToolsState]);

  return { tools, loadPage, clear };
}
