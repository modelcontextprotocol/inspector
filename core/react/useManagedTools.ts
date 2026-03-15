import { useCallback, useSyncExternalStore } from "react";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ManagedToolsState } from "../mcp/state/managedToolsState.js";

export interface UseManagedToolsResult {
  tools: Tool[];
  refresh: (metadata?: Record<string, string>) => Promise<Tool[]>;
}

const EMPTY_TOOLS: Tool[] = []; // Stable empty array reference to avoid re-renders
const NOOP_SUBSCRIBE = () => () => {};

/**
 * Subscribes to the manager's store and returns tools + refresh.
 * When manager is null/undefined, returns empty tools and a no-op refresh.
 */
export function useManagedTools(
  managedToolsState: ManagedToolsState | null | undefined,
): UseManagedToolsResult {
  const store = managedToolsState?.getStore() ?? null;
  const tools = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store ? () => store.getState().tools : () => EMPTY_TOOLS,
  );

  const refresh = useCallback(
    async (metadata?: Record<string, string>): Promise<Tool[]> => {
      if (!managedToolsState) return EMPTY_TOOLS;
      return managedToolsState.refresh(metadata);
    },
    [managedToolsState],
  );

  return { tools, refresh };
}
