import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedToolsState } from "../mcp/state/managedToolsState.js";
import type { Tool } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_TOOLS: Tool[] = [];

const readTools = (state: ManagedToolsState): Tool[] => state.getTools();
const readListChanged = (state: ManagedToolsState): boolean =>
  state.getListChanged();

export interface UseManagedToolsResult {
  /**
   * The last fetch's failure (transport error, or a result the SDK codec
   * rejected), or `null` when it succeeded. Includes the connect-time load,
   * whose failure has no caller to surface it (#1953).
   */
  error: Error | null;
  tools: Tool[];
  /** True when a `tools/list_changed` arrived since the last user refresh. */
  listChanged: boolean;
  refresh: () => Promise<Tool[]>;
  /**
   * Acknowledge the list-changed indicator without fetching the aggregate.
   * Used by the paginated Refresh path, which reloads page 1 of the paged
   * store (bypassing this hook's `refresh`) but must still clear the indicator
   * the managed state lit on `list_changed` (#1721).
   */
  clearListChanged: () => void;
}

/**
 * React hook that subscribes to ManagedToolsState and returns tools + refresh.
 */
export function useManagedTools(
  client: InspectorClientProtocol | null,
  managedToolsState: ManagedToolsState | null,
): UseManagedToolsResult {
  const tools = useStoreSnapshot(
    managedToolsState,
    "toolsChange",
    readTools,
    NO_TOOLS,
  );
  const listChanged = useStoreSnapshot(
    managedToolsState,
    "listChangedChange",
    readListChanged,
    false,
  );

  const error = useListError(managedToolsState);

  const refresh = useCallback(async (): Promise<Tool[]> => {
    if (!managedToolsState || !client) return NO_TOOLS;
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `tools/list_changed` arrives
    // mid-fetch, the state re-sets the flag (and auto-refreshes); clearing
    // afterward would wipe that genuinely-new signal and the user would miss
    // it. Clearing up front acknowledges only the change in hand.
    managedToolsState.clearListChanged();
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate. The store dispatches
    // `toolsChange` as it commits, so the snapshot above updates on its own;
    // there is no local state left to push the result into.
    return managedToolsState.refresh(undefined, "refresh");
  }, [client, managedToolsState]);

  const clearListChanged = useCallback(() => {
    managedToolsState?.clearListChanged();
  }, [managedToolsState]);

  return { tools, error, listChanged, refresh, clearListChanged };
}
