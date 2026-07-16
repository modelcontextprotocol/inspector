import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedToolsState } from "../mcp/state/managedToolsState.js";
import type { ManagedToolsStateEventMap } from "../mcp/state/managedToolsState.js";
import type { Tool } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedToolsResult {
  tools: Tool[];
  /** True when a `tools/list_changed` arrived since the last user refresh. */
  listChanged: boolean;
  refresh: () => Promise<Tool[]>;
}

/**
 * React hook that subscribes to ManagedToolsState and returns tools + refresh.
 */
export function useManagedTools(
  client: InspectorClientProtocol | null,
  managedToolsState: ManagedToolsState | null,
): UseManagedToolsResult {
  const [tools, setTools] = useState<Tool[]>(
    managedToolsState?.getTools() ?? [],
  );
  const [listChanged, setListChanged] = useState<boolean>(
    managedToolsState?.getListChanged() ?? false,
  );

  useEffect(() => {
    if (!managedToolsState) {
      setTools([]);
      setListChanged(false);
      return;
    }
    setTools(managedToolsState.getTools());
    setListChanged(managedToolsState.getListChanged());
    const onToolsChange = (
      event: TypedEventGeneric<ManagedToolsStateEventMap, "toolsChange">,
    ) => {
      setTools(event.detail);
    };
    const onListChangedChange = (
      event: TypedEventGeneric<ManagedToolsStateEventMap, "listChangedChange">,
    ) => {
      setListChanged(event.detail);
    };
    managedToolsState.addEventListener("toolsChange", onToolsChange);
    managedToolsState.addEventListener(
      "listChangedChange",
      onListChangedChange,
    );
    return () => {
      managedToolsState.removeEventListener("toolsChange", onToolsChange);
      managedToolsState.removeEventListener(
        "listChangedChange",
        onListChangedChange,
      );
    };
  }, [managedToolsState]);

  const refresh = useCallback(async (): Promise<Tool[]> => {
    if (!managedToolsState || !client) return [];
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `tools/list_changed` arrives
    // mid-fetch, the state re-sets the flag (and auto-refreshes); clearing
    // afterward would wipe that genuinely-new signal and the user would miss
    // it. Clearing up front acknowledges only the change in hand.
    managedToolsState.clearListChanged();
    const next = await managedToolsState.refresh();
    setTools(next);
    return next;
  }, [client, managedToolsState]);

  return { tools, listChanged, refresh };
}
