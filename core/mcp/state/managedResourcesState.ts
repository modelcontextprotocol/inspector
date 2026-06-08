/**
 * ManagedResourcesState: holds the full resource list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { ManagedListState } from "./managedListState.js";

export interface ManagedResourcesStateEventMap {
  resourcesChange: Resource[];
  /**
   * Fires when the "list changed since last refresh" flag flips. True when a
   * `resources/list_changed` brings a list that differs from what's displayed,
   * false once the user refreshes, the change reverts, or the connection
   * drops. Drives the list-changed indicator (#1402).
   */
  listChangedChange: boolean;
}

export class ManagedResourcesState extends ManagedListState<
  Resource,
  ManagedResourcesStateEventMap
> {
  constructor(client: InspectorClientProtocol) {
    super(client, {
      changeEvent: "resourcesChange",
      listChangedEvent: "resourcesListChanged",
      capabilityKey: "resources",
      itemLabel: "resources",
      supportsIndicator: true,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listResources(cursor, metadata);
        return { items: result.resources, nextCursor: result.nextCursor };
      },
    });
  }

  getResources(): Resource[] {
    return this.getItems();
  }
}
