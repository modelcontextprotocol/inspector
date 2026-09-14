import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedResourcesState } from "../mcp/state/managedResourcesState.js";
import type { Resource } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_RESOURCES: Resource[] = [];

const readResources = (state: ManagedResourcesState): Resource[] =>
  state.getResources();
const readListChanged = (state: ManagedResourcesState): boolean =>
  state.getListChanged();

export interface UseManagedResourcesResult {
  /**
   * The last fetch's failure (transport error, or a result the SDK codec
   * rejected), or `null` when it succeeded. Includes the connect-time load,
   * whose failure has no caller to surface it (#1953).
   */
  error: Error | null;
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
  const resources = useStoreSnapshot(
    managedResourcesState,
    "resourcesChange",
    readResources,
    NO_RESOURCES,
  );
  const listChanged = useStoreSnapshot(
    managedResourcesState,
    "listChangedChange",
    readListChanged,
    false,
  );

  const error = useListError(managedResourcesState);

  const refresh = useCallback(async (): Promise<Resource[]> => {
    if (!managedResourcesState || !client) return NO_RESOURCES;
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `resources/list_changed`
    // arrives mid-fetch, the state re-sets the flag (and auto-refreshes);
    // clearing afterward would wipe that genuinely-new signal and the user
    // would miss it. Clearing up front acknowledges only the change in hand.
    managedResourcesState.clearListChanged();
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate. The store dispatches
    // `resourcesChange` as it commits, so the snapshot updates on its own.
    return managedResourcesState.refresh(undefined, "refresh");
  }, [client, managedResourcesState]);

  const clearListChanged = useCallback(() => {
    managedResourcesState?.clearListChanged();
  }, [managedResourcesState]);

  return { resources, error, listChanged, refresh, clearListChanged };
}
