/**
 * ManagedResourceTemplatesState: holds the full resource template list, in sync
 * with the server. A thin subclass of ManagedListState (#1444).
 *
 * Templates have no list-changed indicator of their own — the Resources
 * screen's indicator (driven by `resourcesListChanged`) covers them, and its
 * Refresh re-fetches templates too. So `supportsIndicator` is false: a
 * `resourceTemplatesListChanged` auto-refreshes only when the server opts in
 * via `autoRefreshOnListChanged`; otherwise it does nothing and the user pulls
 * via the Resources Refresh (#1402).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import {
  ManagedListState,
  DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  type ManagedListEventMap,
} from "./managedListState.js";

export interface ManagedResourceTemplatesStateEventMap extends ManagedListEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

export class ManagedResourceTemplatesState extends ManagedListState<
  ResourceTemplate,
  ManagedResourceTemplatesStateEventMap
> {
  constructor(
    client: InspectorClientProtocol,
    debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS,
  ) {
    super(client, {
      listMethod: "resources/templates/list",
      changeEvent: "resourceTemplatesChange",
      listChangedEvent: "resourceTemplatesListChanged",
      // Templates are gated on the broader `resources` capability.
      capabilityKey: "resources",
      // No paged counterpart (templates aren't paginated in the UI), so they
      // must still aggregate on connect even in paginated mode (#1721).
      deferWhenPaginated: false,
      supportsIndicator: false,
      debounceMs,
      fetchAll: async (c, cacheMode, metadata) => {
        const result = await c.listAllResourceTemplates({
          cacheMode,
          metadata,
        });
        return result.resourceTemplates;
      },
    });
  }

  getResourceTemplates(): ResourceTemplate[] {
    return this.getItems();
  }
}
