/**
 * ManagedResourcesState: holds full resource list, syncs on resourcesListChanged.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedResourcesStateEventMap {
  resourcesChange: Resource[];
  /**
   * Fires when the "list changed since last refresh" flag flips. True when a
   * `resources/list_changed` notification arrives, false once the user
   * refreshes or the connection drops. Drives the list-changed indicator
   * (#1402).
   */
  listChangedChange: boolean;
}

/**
 * State manager that keeps a full resource list in sync with the server.
 * Subscribes to connect, resourcesListChanged, and statusChange; fetches all
 * pages on refresh.
 */
export class ManagedResourcesState extends TypedEventTarget<ManagedResourcesStateEventMap> {
  private resources: Resource[] = [];
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
    const onResourcesListChanged = (): void => {
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
        this.resources = [];
        this.dispatchTypedEvent("resourcesChange", []);
        this.setListChanged(false);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener(
      "resourcesListChanged",
      onResourcesListChanged,
    );
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(
          "resourcesListChanged",
          onResourcesListChanged,
        );
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getResources(): Resource[] {
    return [...this.resources];
  }

  /** Whether a `resources/list_changed` arrived since the last user refresh. */
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

  async refresh(metadata?: Record<string, string>): Promise<Resource[]> {
    const next = await this.fetchResources(metadata);
    // `null` means not connected — leave the current list untouched.
    if (next === null) return this.getResources();
    this.applyResources(next);
    return this.getResources();
  }

  /**
   * Fetch all pages without mutating state or dispatching — used by both
   * refresh (apply) and peek (compare). Returns `null` when not connected, or
   * `[]` when the server doesn't advertise the `resources` capability (calling
   * resources/list there returns -32601 "Method not found", which would spam
   * the console; empty list is the right semantics).
   */
  private async fetchResources(
    metadata?: Record<string, string>,
  ): Promise<Resource[] | null> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return null;
    if (!client.getCapabilities()?.resources) return [];
    const effectiveMetadata = metadata ?? this._metadata;
    let resources: Resource[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listResources(cursor, effectiveMetadata);
      resources = cursor ? [...resources, ...result.resources] : result.resources;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resources`,
        );
      }
    } while (cursor);
    return resources;
  }

  /** Commit a fetched list as the current one and notify subscribers. */
  private applyResources(resources: Resource[]): void {
    this.resources = resources;
    this.dispatchTypedEvent("resourcesChange", this.resources);
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
    const next = await this.fetchResources();
    if (next === null) return;
    this.setListChanged(
      JSON.stringify(next) !== JSON.stringify(this.resources),
    );
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
  }
}
