/**
 * PagedResourcesState: holds an aggregated list of resources loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedResourcesStateEventMap {
  resourcesChange: Resource[];
}

export interface LoadPageResult {
  resources: Resource[];
  nextCursor?: string;
}

/**
 * State manager that holds the union of resources loaded via loadPage().
 * Subscribes only to statusChange to clear on disconnect.
 */
export class PagedResourcesState extends TypedEventTarget<PagedResourcesStateEventMap> {
  private resources: Resource[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClient) {
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
    if (cursor === undefined) {
      this.resources = [...result.resources];
    } else {
      this.resources = [...this.resources, ...result.resources];
    }
    this.dispatchTypedEvent("resourcesChange", this.resources);
    return {
      resources: result.resources,
      nextCursor: result.nextCursor,
    };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
  }
}
