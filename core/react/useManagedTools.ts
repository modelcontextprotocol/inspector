import { useSyncExternalStore } from "react";
import { useCallback } from "react";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ManagedToolsState } from "../mcp/state/managedToolsState.js";

export interface UseManagedToolsResult {
  tools: Tool[];
  refresh: (metadata?: Record<string, string>) => Promise<Tool[]>;
}

/**
 * Subscribes to the manager's store and returns tools + refresh.
 * Requires a ManagedToolsState (only call when you have a manager).
 */
export function useManagedTools(
  managedToolsState: ManagedToolsState,
): UseManagedToolsResult {
  const store = managedToolsState.getStore();
  const tools = useSyncExternalStore(
    store.subscribe,
    () => store.getState().tools,
  );

  const refresh = useCallback(
    async (metadata?: Record<string, string>): Promise<Tool[]> => {
      return managedToolsState.refresh(metadata);
    },
    [managedToolsState],
  );

  return { tools, refresh };
}
