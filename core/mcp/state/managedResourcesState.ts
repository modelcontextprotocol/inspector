/**
 * ManagedResourcesState: holds the full resource list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  type ManagedListEventMap,
} from "./managedListState.js";

export interface ManagedResourcesStateEventMap extends ManagedListEventMap {
  resourcesChange: Resource[];
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
      listMethod: "resources/list",
      changeEvent: "resourcesChange",
      listChangedEvent: "resourcesListChanged",
      capabilityKey: "resources",
      deferWhenPaginated: true,
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
