/**
 * PagedResourcesState: holds an aggregated list of resources loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `resourcesListChanged`: cursors are
 * tied to the server's prior list, so a list change mid-pagination would
 * invalidate them. The caller decides how to react.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedResourcesStateEventMap {
  resourcesChange: Resource[];
}

export interface LoadPageResult {
  resources: Resource[];
  nextCursor?: string;
}

export class PagedResourcesState extends TypedEventTarget<PagedResourcesStateEventMap> {
  private resources: Resource[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.resources = [];
        this.dispatchTypedEvent("resourcesChange", []);
      }
    };
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getResources(): Resource[] {
    return [...this.resources];
  }

  clear(): void {
    this.resources = [];
    this.dispatchTypedEvent("resourcesChange", this.resources);
  }

  async loadPage(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { resources: [], nextCursor: undefined };
    }
    const result = await c.listResources(cursor, metadata);
    this.resources =
      cursor === undefined
        ? [...result.resources]
        : [...this.resources, ...result.resources];
    this.dispatchTypedEvent("resourcesChange", this.resources);
    return { resources: result.resources, nextCursor: result.nextCursor };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
  }
}
