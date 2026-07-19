import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedResourcesState,
  ManagedResourcesStateEventMap,
} from "../mcp/state/managedResourcesState.js";
import type { Resource } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedResourcesResult {
  resources: Resource[];
  /**
   * True when a `resources/list_changed` arrived since the last user refresh.
   */
  listChanged: boolean;
  refresh: () => Promise<Resource[]>;
  /** Acknowledge the list-changed indicator without fetching (#1721). */
  clearListChanged: () => void;
}

/**
 * React hook that subscribes to ManagedResourcesState and returns resources + refresh.
 */
export function useManagedResources(
  client: InspectorClientProtocol | null,
  managedResourcesState: ManagedResourcesState | null,
): UseManagedResourcesResult {
  const [resources, setResources] = useState<Resource[]>(
    managedResourcesState?.getResources() ?? [],
  );
  const [listChanged, setListChanged] = useState<boolean>(
    managedResourcesState?.getListChanged() ?? false,
  );

  useEffect(() => {
    if (!managedResourcesState) {
      setResources([]);
      setListChanged(false);
      return;
    }
    setResources(managedResourcesState.getResources());
    setListChanged(managedResourcesState.getListChanged());
    const onResourcesChange = (
      event: TypedEventGeneric<
        ManagedResourcesStateEventMap,
        "resourcesChange"
      >,
    ) => {
      setResources(event.detail);
    };
    const onListChangedChange = (
      event: TypedEventGeneric<
        ManagedResourcesStateEventMap,
        "listChangedChange"
      >,
    ) => {
      setListChanged(event.detail);
    };
    managedResourcesState.addEventListener(
      "resourcesChange",
      onResourcesChange,
    );
    managedResourcesState.addEventListener(
      "listChangedChange",
      onListChangedChange,
    );
    return () => {
      managedResourcesState.removeEventListener(
        "resourcesChange",
        onResourcesChange,
      );
      managedResourcesState.removeEventListener(
        "listChangedChange",
        onListChangedChange,
      );
    };
  }, [managedResourcesState]);

  const refresh = useCallback(async (): Promise<Resource[]> => {
    if (!managedResourcesState || !client) return [];
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `resources/list_changed`
    // arrives mid-fetch, the state re-sets the flag (and auto-refreshes);
    // clearing afterward would wipe that genuinely-new signal and the user
    // would miss it. Clearing up front acknowledges only the change in hand.
    managedResourcesState.clearListChanged();
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate.
    const next = await managedResourcesState.refresh(undefined, "refresh");
    setResources(next);
    return next;
  }, [client, managedResourcesState]);

  const clearListChanged = useCallback(() => {
    managedResourcesState?.clearListChanged();
  }, [managedResourcesState]);

  return { resources, listChanged, refresh, clearListChanged };
}
