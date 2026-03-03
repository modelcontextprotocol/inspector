import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { ManagedToolsState } from "../mcp/state/managedToolsState.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { ManagedToolsStateEventMap } from "../mcp/state/managedToolsState.js";

export interface UseManagedToolsResult {
  tools: Tool[];
  refresh: () => Promise<Tool[]>;
}

/**
 * React hook that subscribes to ManagedToolsState and returns tools + refresh.
 * Pass the same InspectorClient and ManagedToolsState (or create manager inside hook via ref).
 */
export function useManagedTools(
  client: InspectorClient | null,
  managedToolsState: ManagedToolsState | null,
): UseManagedToolsResult {
  const [tools, setTools] = useState<Tool[]>(
    managedToolsState?.getTools() ?? [],
  );

  useEffect(() => {
    if (!managedToolsState) {
      setTools([]);
      return;
    }
    setTools(managedToolsState.getTools());
    const onToolsChange = (
      event: TypedEventGeneric<ManagedToolsStateEventMap, "toolsChange">,
    ) => {
      setTools(event.detail);
    };
    managedToolsState.addEventListener("toolsChange", onToolsChange);
    return () => {
      managedToolsState.removeEventListener("toolsChange", onToolsChange);
    };
  }, [managedToolsState]);

  const refresh = useCallback(async (): Promise<Tool[]> => {
    if (!managedToolsState || !client) return [];
    const next = await managedToolsState.refresh();
    setTools(next);
    return next;
  }, [client, managedToolsState]);

  return { tools, refresh };
}
