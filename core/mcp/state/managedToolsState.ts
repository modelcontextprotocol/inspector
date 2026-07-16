/**
 * ManagedToolsState: holds the full tool list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
} from "./managedListState.js";

export interface ManagedToolsStateEventMap {
  toolsChange: Tool[];
  /**
   * Fires when the "list changed since last refresh" flag flips. True when a
   * `tools/list_changed` arrives (auto-refresh off), false once the user
   * refreshes or the connection drops. Drives the sidebar list-changed
   * indicator (#1402).
   */
  listChangedChange: boolean;
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
      changeEvent: "toolsChange",
      listChangedEvent: "toolsListChanged",
      capabilityKey: "tools",
      itemLabel: "tools",
      supportsIndicator: true,
      debounceMs,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listTools(cursor, metadata);
        return { items: result.tools, nextCursor: result.nextCursor };
      },
    });
  }

  getTools(): Tool[] {
    return this.getItems();
  }
}
