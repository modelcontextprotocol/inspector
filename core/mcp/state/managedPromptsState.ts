/**
 * ManagedPromptsState: holds the full prompt list, in sync with the server.
 * A thin subclass of ManagedListState — behavior lives in the base (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Prompt } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  type ManagedListEventMap,
} from "./managedListState.js";

export interface ManagedPromptsStateEventMap extends ManagedListEventMap {
  promptsChange: Prompt[];
}

export class ManagedPromptsState extends ManagedListState<
  Prompt,
  ManagedPromptsStateEventMap
> {
  constructor(
    client: InspectorClientProtocol,
    debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  ) {
    super(client, {
      listMethod: "prompts/list",
      changeEvent: "promptsChange",
      listChangedEvent: "promptsListChanged",
      capabilityKey: "prompts",
      deferWhenPaginated: true,
      supportsIndicator: true,
      debounceMs,
      fetchAll: async (c, cacheMode, metadata) => {
        const result = await c.listAllPrompts({ cacheMode, metadata });
        return result.prompts;
      },
    });
  }

  getPrompts(): Prompt[] {
    return this.getItems();
  }
}
