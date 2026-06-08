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
      // When the server opts into auto-refresh (per-server setting), pull the
      // new list immediately. Otherwise peek: fetch and compare, lighting the
      // indicator only when the list actually changed — many servers re-send an
      // identical list on `list_changed` (#1402, #1444).
      if (this.client?.getServerSettings()?.autoRefreshOnListChanged) {
        void this.refresh();
      } else {
        void this.peekForChange();
      }
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
    const next = await this.fetchTools(metadata);
    // `null` means not connected — leave the current list untouched.
    if (next === null) return this.getTools();
    this.applyTools(next);
    return this.getTools();
  }

  /**
   * Fetch all pages without mutating state or dispatching — used by both
   * refresh (apply) and peek (compare). Returns `null` when not connected, or
   * `[]` when the server doesn't advertise the `tools` capability (calling
   * tools/list there returns -32601 "Method not found", which would spam the
   * console; empty list is the right semantics).
   */
  private async fetchTools(
    metadata?: Record<string, string>,
  ): Promise<Tool[] | null> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return null;
    if (!client.getCapabilities()?.tools) return [];
    const effectiveMetadata = metadata ?? this._metadata;
    let tools: Tool[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listTools(cursor, effectiveMetadata);
      tools = cursor ? [...tools, ...result.tools] : result.tools;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing tools`,
        );
      }
    } while (cursor);
    return tools;
  }

  /** Commit a fetched list as the current one and notify subscribers. */
  private applyTools(tools: Tool[]): void {
    this.tools = tools;
    this.dispatchTypedEvent("toolsChange", this.tools);
  }

  /**
   * Fetch on `list_changed` and track whether the server's list differs from
   * what's displayed. The displayed list is left untouched — the user still
   * pulls the new one via Refresh (pull-on-demand). Many servers re-send an
   * identical list on `list_changed`; this keeps the indicator dark in that
   * case, and also clears it if a later notification reverts the server back
   * to the displayed list (nothing left to pull). The flag is order-sensitive:
   * a reorder is a visible change the user would see on Refresh, so it counts
   * (#1444).
   */
  private async peekForChange(): Promise<void> {
    const next = await this.fetchTools();
    if (next === null) return;
    this.setListChanged(JSON.stringify(next) !== JSON.stringify(this.tools));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
  }
}
