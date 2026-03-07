/**
 * PagedToolsState: holds an aggregated list of tools loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedToolsStateEventMap {
  toolsChange: Tool[];
}

/**
 * Result of loading one page of tools.
 */
export interface LoadPageResult {
  /** Tools in this page. */
  tools: Tool[];
  /** Cursor for the next page, if any. */
  nextCursor?: string;
}

/**
 * State manager that holds the union of tools loaded via loadPage().
 * Does not load on connect; does not subscribe to toolsListChanged.
 * Subscribes only to statusChange to clear tools on disconnect.
 */
export class PagedToolsState extends TypedEventTarget<PagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClient) {
    super();
    this.client = client;
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.tools = [];
        this.dispatchTypedEvent("toolsChange", []);
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

  getTools(): Tool[] {
    return [...this.tools];
  }

  /**
   * Clear the aggregated list and dispatch toolsChange with [].
   * Caller can call loadPage() again to reload from the first page.
   */
  clear(): void {
    this.tools = [];
    this.dispatchTypedEvent("toolsChange", this.tools);
  }

  /**
   * Load one page of tools. Pass no cursor for the first page, then pass
   * the returned nextCursor for subsequent pages. Appends (or sets for first
   * page) the page into the aggregated list and dispatches toolsChange.
   */
  async loadPage(cursor?: string): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { tools: [], nextCursor: undefined };
    }
    const result = await c.listTools(cursor, undefined);
    if (cursor === undefined) {
      this.tools = [...result.tools];
    } else {
      this.tools = [...this.tools, ...result.tools];
    }
    this.dispatchTypedEvent("toolsChange", this.tools);
    return { tools: result.tools, nextCursor: result.nextCursor };
  }

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
  }
}
