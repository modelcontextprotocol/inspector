/**
 * ManagedResourceTemplatesState: holds the full resource template list, loaded
 * on connect and on demand via refresh().
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

/**
 * State manager that keeps a full resource template list. Subscribes to connect
 * (initial load) and statusChange (clear on disconnect); fetches all pages on
 * refresh. It deliberately does NOT subscribe to `resourceTemplatesListChanged`
 * — templates are pulled on demand via the Resources screen's Refresh, not
 * auto-refreshed out from under the user (#1402).
 */
export class ManagedResourceTemplatesState extends TypedEventTarget<ManagedResourceTemplatesStateEventMap> {
  private resourceTemplates: ResourceTemplate[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    // No `resourceTemplatesListChanged` subscription: templates are part of the
    // Resources screen, whose list-changed indicator (driven by
    // `resourcesListChanged`, fired by the same `notifications/resources/
    // list_changed`) prompts the user to refresh. That refresh re-fetches
    // templates too, so they're never auto-pulled out from under the user
    // (#1402).
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.resourceTemplates = [];
        this.dispatchTypedEvent("resourceTemplatesChange", []);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getResourceTemplates(): ResourceTemplate[] {
    return [...this.resourceTemplates];
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  async refresh(
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplate[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getResourceTemplates();
    }
    // Gate on the server's `resources` capability — the MCP spec doesn't define
    // a separate `resourceTemplates` capability; resources/templates/list is
    // part of the resources surface. Calling it against a server that doesn't
    // advertise resources returns -32601 "Method not found", which then
    // surfaces in the console for every connect against a resources-less
    // server. Empty list is the right semantics for "this server doesn't
    // support resources."
    if (!client.getCapabilities()?.resources) {
      this.resourceTemplates = [];
      this.dispatchTypedEvent(
        "resourceTemplatesChange",
        this.resourceTemplates,
      );
      return this.getResourceTemplates();
    }
    const effectiveMetadata = metadata ?? this._metadata;
    this.resourceTemplates = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listResourceTemplates(
        cursor,
        effectiveMetadata,
      );
      this.resourceTemplates = cursor
        ? [...this.resourceTemplates, ...result.resourceTemplates]
        : result.resourceTemplates;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resource templates`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
    return this.getResourceTemplates();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resourceTemplates = [];
  }
}
