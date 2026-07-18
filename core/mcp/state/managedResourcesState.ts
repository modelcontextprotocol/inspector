/**
 * ManagedResourcesState: holds the full resource list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
} from "./managedListState.js";

export interface ManagedResourcesStateEventMap {
  resourcesChange: Resource[];
  /**
   * Fires when the "list changed since last refresh" flag flips. True when a
   * `resources/list_changed` arrives (auto-refresh off), false once the user
   * refreshes or the connection drops. Drives the list-changed indicator
   * (#1402).
   */
  listChangedChange: boolean;
}

export class ManagedResourcesState extends ManagedListState<
  Resource,
  ManagedResourcesStateEventMap
> {
  constructor(
    client: InspectorClientProtocol,
    debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  ) {
    super(client, {
      changeEvent: "resourcesChange",
      listChangedEvent: "resourcesListChanged",
      capabilityKey: "resources",
      supportsIndicator: true,
      debounceMs,
      fetchAll: async (c, cacheMode, metadata) => {
        const result = await c.listAllResources({ cacheMode, metadata });
        return result.resources;
      },
    });
  }

  getResources(): Resource[] {
    return this.getItems();
  }
}
