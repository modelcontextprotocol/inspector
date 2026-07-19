/**
 * PagedResourcesState: holds the resources accumulated so far, loaded one page
 * at a time via loadPage(cursor). Backs single-page mode (`singlePageLists`,
 * #1721): auto-loads page 1 on connect when the setting is on, and tracks the
 * server's `nextCursor` + a running page count as observable state. Clears on
 * disconnect.
 *
 * Intentionally does NOT subscribe to `resourcesListChanged`: cursors are tied
 * to the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller pulls page 1 again via Refresh instead.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";
import type { PagePaginationState } from "./pagedToolsState.js";

export interface PagedResourcesStateEventMap {
  resourcesChange: Resource[];
  paginationChange: PagePaginationState;
}

export interface LoadPageResult {
  resources: Resource[];
  nextCursor?: string;
}

export class PagedResourcesState extends TypedEventTarget<PagedResourcesStateEventMap> {
  private resources: Resource[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  // Double-click guard: a load in flight makes the next `loadPage` a no-op so
  // the same page can't be appended twice (#1721).
  private loading = false;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      if (this.client?.getServerSettings()?.singlePageLists) {
        void this.loadPage(undefined);
      }
    };
    const onStatusChange = (): void => {
      if (isTerminalStatus(this.client?.getStatus())) {
        this.reset();
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

  getResources(): Resource[] {
    return [...this.resources];
  }

  getPagination(): PagePaginationState {
    return { nextCursor: this.nextCursor, pageCount: this.pageCount };
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.resources = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchTypedEvent("resourcesChange", this.resources);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
  }

  async loadPage(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { resources: [], nextCursor: undefined };
    }
    if (this.loading) {
      return { resources: [], nextCursor: this.nextCursor };
    }
    this.loading = true;
    try {
      const result = await c.listResources(cursor, metadata);
      this.resources =
        cursor === undefined
          ? [...result.resources]
          : [...this.resources, ...result.resources];
      this.pageCount = cursor === undefined ? 1 : this.pageCount + 1;
      this.nextCursor = result.nextCursor;
      this.dispatchTypedEvent("resourcesChange", this.resources);
      this.dispatchTypedEvent("paginationChange", this.getPagination());
      return { resources: result.resources, nextCursor: result.nextCursor };
    } finally {
      this.loading = false;
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
  }
}
