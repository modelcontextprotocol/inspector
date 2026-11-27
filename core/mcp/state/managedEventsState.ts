/**
 * ManagedEventsState: holds the full event-type list (`events/list`, SEP-3415),
 * in sync with the server. Loaded on connect, cleared on disconnect, re-walked
 * on refresh and on `notifications/events/list_changed`. A thin subclass of
 * ManagedListState, like the tool, prompt and resource managers (#3028).
 *
 * Two things differ from those, and both are configuration rather than new
 * behavior:
 *
 * - **The gate is a predicate, not a capability key.** Events is a
 *   server-declared extension valid only on a modern era, so the store asks the
 *   client (`getEventsExtension`) instead of reading `capabilities.events`. A
 *   client without the method — a test double, or an older protocol
 *   implementation — reads as "not supported", so the list is empty and no
 *   `events/list` is ever sent.
 * - **The walk is the client's, not the SDK's.** There is no SDK aggregate verb
 *   for a consumer-owned method, so `listAllEvents` walks the cursor itself and
 *   `cacheMode` has nothing to select.
 *
 * Event types whose `x-mcp-header` annotations are invalid are already gone by
 * the time a list reaches this store; the client keeps them, with reasons, as
 * `getExcludedEventTypes()`.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { EventType } from "../../extension/events/schemas.js";
import { EVENTS_LIST_METHOD } from "../../extension/events/constants.js";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  type ManagedListEventMap,
} from "./managedListState.js";

export interface ManagedEventsStateEventMap extends ManagedListEventMap {
  eventTypesChange: EventType[];
}

/** Whether `client` may be asked for events at all on its current connection. */
export function clientSupportsEvents(client: InspectorClientProtocol): boolean {
  return (
    client.getEventsExtension?.() !== undefined &&
    client.listAllEvents !== undefined
  );
}

export class ManagedEventsState extends ManagedListState<
  EventType,
  ManagedEventsStateEventMap
> {
  constructor(
    client: InspectorClientProtocol,
    debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  ) {
    super(client, {
      listMethod: EVENTS_LIST_METHOD,
      changeEvent: "eventTypesChange",
      listChangedEvent: "eventsListChanged",
      supported: clientSupportsEvents,
      deferWhenPaginated: true,
      supportsIndicator: true,
      debounceMs,
      fetchAll: async (c, _cacheMode, metadata) => {
        // `clientSupportsEvents` has already established the method exists;
        // the optional call keeps that true without a non-null assertion.
        const result = await c.listAllEvents?.({ metadata });
        /* v8 ignore next -- the gate above guarantees listAllEvents exists */
        return result?.events ?? [];
      },
    });
  }

  getEventTypes(): EventType[] {
    return this.getItems();
  }
}
