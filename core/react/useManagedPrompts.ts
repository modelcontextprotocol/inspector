import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedPromptsState } from "../mcp/state/managedPromptsState.js";
import type { Prompt } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_PROMPTS: Prompt[] = [];

const readPrompts = (state: ManagedPromptsState): Prompt[] =>
  state.getPrompts();
const readListChanged = (state: ManagedPromptsState): boolean =>
  state.getListChanged();

export interface UseManagedPromptsResult {
  /**
   * The last fetch's failure (transport error, or a result the SDK codec
   * rejected), or `null` when it succeeded. Includes the connect-time load,
   * whose failure has no caller to surface it (#1953).
   */
  error: Error | null;
  prompts: Prompt[];
  /** True when a `prompts/list_changed` arrived since the last user refresh. */
  listChanged: boolean;
  refresh: () => Promise<Prompt[]>;
  /** Acknowledge the list-changed indicator without fetching (#1721). */
  clearListChanged: () => void;
}

/**
 * React hook that subscribes to ManagedPromptsState and returns prompts + refresh.
 */
export function useManagedPrompts(
  client: InspectorClientProtocol | null,
  managedPromptsState: ManagedPromptsState | null,
): UseManagedPromptsResult {
  const prompts = useStoreSnapshot(
    managedPromptsState,
    "promptsChange",
    readPrompts,
    NO_PROMPTS,
  );
  const listChanged = useStoreSnapshot(
    managedPromptsState,
    "listChangedChange",
    readListChanged,
    false,
  );

  const error = useListError(managedPromptsState);

  const refresh = useCallback(async (): Promise<Prompt[]> => {
    if (!managedPromptsState || !client) return NO_PROMPTS;
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `prompts/list_changed` arrives
    // mid-fetch, the state re-sets the flag (and auto-refreshes); clearing
    // afterward would wipe that genuinely-new signal and the user would miss
    // it. Clearing up front acknowledges only the change in hand.
    managedPromptsState.clearListChanged();
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate. The store dispatches
    // `promptsChange` as it commits, so the snapshot above updates on its own.
    return managedPromptsState.refresh(undefined, "refresh");
  }, [client, managedPromptsState]);

  const clearListChanged = useCallback(() => {
    managedPromptsState?.clearListChanged();
  }, [managedPromptsState]);

  return { prompts, error, listChanged, refresh, clearListChanged };
}
