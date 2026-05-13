/**
 * PagedResourceTemplatesState: holds an aggregated list of resource templates
 * loaded via loadPage(cursor). Does not load on connect; caller drives loading.
 * Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `resourceTemplatesListChanged`: cursors
 * are tied to the server's prior list, so a list change mid-pagination would
 * invalidate them. The caller decides how to react.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

export interface LoadPageResult {
  resourceTemplates: ResourceTemplate[];
  nextCursor?: string;
}

export class PagedResourceTemplatesState extends TypedEventTarget<PagedResourceTemplatesStateEventMap> {
  private resourceTemplates: ResourceTemplate[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
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
    this.resourceTemplates =
      cursor === undefined
        ? [...result.resourceTemplates]
        : [...this.resourceTemplates, ...result.resourceTemplates];
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
