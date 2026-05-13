/**
 * PagedToolsState: holds an aggregated list of tools loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `toolsListChanged`: cursors are tied to
 * the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller decides how to react (typically by `clear()` + reload
 * page 1) — see the managed variant for the auto-refresh shape.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedToolsStateEventMap {
  toolsChange: Tool[];
}

export interface LoadPageResult {
  tools: Tool[];
  nextCursor?: string;
}

export class PagedToolsState extends TypedEventTarget<PagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
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

  clear(): void {
    this.tools = [];
    this.dispatchTypedEvent("toolsChange", this.tools);
  }

  async loadPage(cursor?: string): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { tools: [], nextCursor: undefined };
    }
    const result = await c.listTools(cursor, undefined);
    this.tools =
      cursor === undefined
        ? [...result.tools]
        : [...this.tools, ...result.tools];
    this.dispatchTypedEvent("toolsChange", this.tools);
    return { tools: result.tools, nextCursor: result.nextCursor };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
  }
}
