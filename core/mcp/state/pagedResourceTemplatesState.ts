/**
 * PagedResourceTemplatesState: holds an aggregated list of resource templates loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

export interface LoadPageResult {
  resourceTemplates: ResourceTemplate[];
  nextCursor?: string;
}

/**
 * State manager that holds the union of resource templates loaded via loadPage().
 * Subscribes only to statusChange to clear on disconnect.
 */
export class PagedResourceTemplatesState extends TypedEventTarget<PagedResourceTemplatesStateEventMap> {
  private resourceTemplates: ResourceTemplate[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClient) {
    super();
    this.client = client;
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.resourceTemplates = [];
        this.dispatchTypedEvent("resourceTemplatesChange", []);
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

  getResourceTemplates(): ResourceTemplate[] {
    return [...this.resourceTemplates];
  }

  clear(): void {
    this.resourceTemplates = [];
    this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
  }

  async loadPage(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { resourceTemplates: [], nextCursor: undefined };
    }
    const result = await c.listResourceTemplates(cursor, metadata);
    if (cursor === undefined) {
      this.resourceTemplates = [...result.resourceTemplates];
    } else {
      this.resourceTemplates = [
        ...this.resourceTemplates,
        ...result.resourceTemplates,
      ];
    }
    this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
    return {
      resourceTemplates: result.resourceTemplates,
      nextCursor: result.nextCursor,
    };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resourceTemplates = [];
  }
}
