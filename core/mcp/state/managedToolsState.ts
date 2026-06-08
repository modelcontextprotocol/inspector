/**
 * ManagedToolsState: holds full tool list, syncs on toolsListChanged.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedToolsStateEventMap {
  toolsChange: Tool[];
  /**
   * Fires when the "list changed since last refresh" flag flips. True when a
   * `tools/list_changed` notification arrives, false once the user refreshes
   * or the connection drops. Drives the sidebar list-changed indicator (#1402).
   */
  listChangedChange: boolean;
}

/**
 * State manager that keeps a full tool list in sync with the server.
 * Subscribes to client's connect (initial load), toolsListChanged, and
 * statusChange; fetches all pages on refresh.
 */
export class ManagedToolsState extends TypedEventTarget<ManagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;
  private listChanged = false;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onToolsListChanged = (): void => {
      // Mark the list as changed for the indicator, then auto-refresh. The
      // refresh deliberately does NOT clear the flag — only a user-initiated
      // refresh (clearListChanged) or a disconnect does (#1402).
      this.setListChanged(true);
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.tools = [];
        this.dispatchTypedEvent("toolsChange", []);
        this.setListChanged(false);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("toolsListChanged", onToolsListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener("toolsListChanged", onToolsListChanged);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  /** Whether a `tools/list_changed` arrived since the last user refresh. */
  getListChanged(): boolean {
    return this.listChanged;
  }

  /**
   * Clear the list-changed flag — called when the user refreshes the list
   * (the auto-refresh on the notification leaves it set so the indicator
   * stays visible until acknowledged).
   */
  clearListChanged(): void {
    this.setListChanged(false);
  }

  private setListChanged(value: boolean): void {
    if (this.listChanged === value) return;
    this.listChanged = value;
    this.dispatchTypedEvent("listChangedChange", value);
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  async refresh(metadata?: Record<string, string>): Promise<Tool[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getTools();
    }
    // Gate on the server's `tools` capability — calling tools/list against a
    // server that doesn't advertise it returns -32601 "Method not found",
    // which then surfaces in the console for every connect against a
    // tools-less server. Empty list is the right semantics for "this server
    // doesn't support tools."
    if (!client.getCapabilities()?.tools) {
      this.tools = [];
      this.dispatchTypedEvent("toolsChange", this.tools);
      return this.getTools();
    }
    const effectiveMetadata = metadata ?? this._metadata;
    this.tools = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listTools(cursor, effectiveMetadata);
      this.tools = cursor ? [...this.tools, ...result.tools] : result.tools;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing tools`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("toolsChange", this.tools);
    return this.getTools();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
  }
}
