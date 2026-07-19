/**
 * PagedToolsState: holds an aggregated list of tools loaded one page at a time
 * via loadPage(cursor). Backs single-page mode (the `singlePageLists` setting,
 * #1721): auto-loads page 1 on connect when the setting is on, and tracks the
 * server's `nextCursor` + a running page count as observable state so the
 * sidebar can surface a "Load next page" control. Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `toolsListChanged`: cursors are tied to
 * the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller pulls page 1 again via Refresh instead (the managed variant
 * owns the auto-refresh shape).
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

/** Observable pagination progress for a paged list. */
export interface PagePaginationState {
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Number of pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
}

export interface PagedToolsStateEventMap {
  toolsChange: Tool[];
  paginationChange: PagePaginationState;
}

export interface LoadPageResult {
  tools: Tool[];
  nextCursor?: string;
}

export class PagedToolsState extends TypedEventTarget<PagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      // Auto-load page 1 only in single-page mode — otherwise the managed
      // (aggregate) state is the display source and this stays idle (#1721).
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

  getTools(): Tool[] {
    return [...this.tools];
  }

  getPagination(): PagePaginationState {
    return { nextCursor: this.nextCursor, pageCount: this.pageCount };
  }

  /** Clear the accumulated list and pagination progress. */
  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.tools = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchTypedEvent("toolsChange", this.tools);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
  }

  async loadPage(cursor?: string): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { tools: [], nextCursor: undefined };
    }
    const result = await c.listTools(cursor, undefined);
    // An undefined cursor is page 1 — replace the list and reset the count;
    // a cursor appends the next page.
    this.tools =
      cursor === undefined
        ? [...result.tools]
        : [...this.tools, ...result.tools];
    this.pageCount = cursor === undefined ? 1 : this.pageCount + 1;
    this.nextCursor = result.nextCursor;
    this.dispatchTypedEvent("toolsChange", this.tools);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
    return { tools: result.tools, nextCursor: result.nextCursor };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
  }
}
