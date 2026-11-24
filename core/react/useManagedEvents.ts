import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedEventsState } from "../mcp/state/managedEventsState.js";
import type { EventType } from "../extension/events/schemas.js";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot does not change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_EVENT_TYPES: EventType[] = [];

const readEventTypes = (state: ManagedEventsState): EventType[] =>
  state.getEventTypes();
const readListChanged = (state: ManagedEventsState): boolean =>
  state.getListChanged();
// Keyed on `eventTypesChange`: the store flips `loaded` just before it
// dispatches that event, so the snapshot re-reads it on the same change.
const readLoaded = (state: ManagedEventsState): boolean => state.isLoaded();

export interface UseManagedEventsResult {
  /** The full event-type list (`events/list`, every page). */
  eventTypes: EventType[];
  /** The last walk's failure, or `null` when it succeeded. */
  error: Error | null;
  /** True when `notifications/events/list_changed` arrived since a refresh. */
  listChanged: boolean;
  /** True once a walk has committed the list this connection. */
  loaded: boolean;
  /** Re-walk the list, acknowledging the list-changed indicator first. */
  refresh: () => Promise<EventType[]>;
  /**
   * Acknowledge the indicator without walking the aggregate — the paginated
   * Refresh reloads page 1 of the paged store instead (#1721).
   */
  clearListChanged: () => void;
}

/**
 * React hook over `ManagedEventsState` (SEP-3415, #3030): the event types,
 * the list-changed indicator, the load state and a refresh. The tools hook's
 * shape, read during render through `useStoreSnapshot`.
 */
export function useManagedEvents(
  client: InspectorClientProtocol | null,
  managedEventsState: ManagedEventsState | null,
): UseManagedEventsResult {
  const eventTypes = useStoreSnapshot(
    managedEventsState,
    "eventTypesChange",
    readEventTypes,
    NO_EVENT_TYPES,
  );
  const listChanged = useStoreSnapshot(
    managedEventsState,
    "listChangedChange",
    readListChanged,
    false,
  );
  const loaded = useStoreSnapshot(
    managedEventsState,
    "eventTypesChange",
    readLoaded,
    false,
  );
  const error = useListError(managedEventsState);

  const refresh = useCallback(async (): Promise<EventType[]> => {
    if (!managedEventsState || !client) return NO_EVENT_TYPES;
    // Cleared before the walk, not after, so a `list_changed` landing mid-walk
    // re-lights the indicator rather than being wiped (see useManagedTools).
    managedEventsState.clearListChanged();
    return managedEventsState.refresh();
  }, [client, managedEventsState]);

  const clearListChanged = useCallback(() => {
    managedEventsState?.clearListChanged();
  }, [managedEventsState]);

  return { eventTypes, error, listChanged, loaded, refresh, clearListChanged };
}
