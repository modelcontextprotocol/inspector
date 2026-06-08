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
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { ManagedListState } from "./managedListState.js";

export interface ManagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
  /**
   * Carried only to satisfy the ManagedListState base; templates have no
   * indicator, so this never fires.
   */
  listChangedChange: boolean;
}

export class ManagedResourceTemplatesState extends ManagedListState<
  ResourceTemplate,
  ManagedResourceTemplatesStateEventMap
> {
  constructor(client: InspectorClientProtocol) {
    super(client, {
      changeEvent: "resourceTemplatesChange",
      listChangedEvent: "resourceTemplatesListChanged",
      // Templates are gated on the broader `resources` capability.
      capabilityKey: "resources",
      itemLabel: "resource templates",
      supportsIndicator: false,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listResourceTemplates(cursor, metadata);
        return {
          items: result.resourceTemplates,
          nextCursor: result.nextCursor,
        };
      },
    });
  }

  getResourceTemplates(): ResourceTemplate[] {
    return this.getItems();
  }
}
