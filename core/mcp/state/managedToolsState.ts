/**
 * ManagedToolsState: holds the full tool list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  type ManagedListEventMap,
} from "./managedListState.js";

export interface ManagedToolsStateEventMap extends ManagedListEventMap {
  toolsChange: Tool[];
}

export class ManagedToolsState extends ManagedListState<
  Tool,
  ManagedToolsStateEventMap
> {
  constructor(
    client: InspectorClientProtocol,
    debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  ) {
    super(client, {
      listMethod: "tools/list",
      changeEvent: "toolsChange",
      listChangedEvent: "toolsListChanged",
      capabilityKey: "tools",
      deferWhenPaginated: true,
      supportsIndicator: true,
      debounceMs,
      fetchAll: async (c, cacheMode, metadata) => {
        const result = await c.listAllTools({ cacheMode, metadata });
        return result.tools;
      },
    });
  }

  getTools(): Tool[] {
    return this.getItems();
  }
}
