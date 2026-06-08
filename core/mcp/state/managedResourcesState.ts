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
      // new list immediately. Otherwise just flag the change for the indicator
      // and let the user pull via Refresh, which is what makes the indicator
      // meaningful (#1402).
      if (this.client?.getServerSettings()?.autoRefreshOnListChanged) {
        void this.refresh();
      } else {
        this.setListChanged(true);
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
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getResources();
    }
    // Gate on the server's `resources` capability — calling resources/list
    // against a server that doesn't advertise it returns -32601 "Method not
    // found", which then surfaces in the console for every connect against a
    // resources-less server. Empty list is the right semantics for "this
    // server doesn't support resources."
    if (!client.getCapabilities()?.resources) {
      this.resources = [];
      this.dispatchTypedEvent("resourcesChange", this.resources);
      return this.getResources();
    }
    const effectiveMetadata = metadata ?? this._metadata;
    this.resources = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listResources(cursor, effectiveMetadata);
      this.resources = cursor
        ? [...this.resources, ...result.resources]
        : result.resources;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resources`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("resourcesChange", this.resources);
    return this.getResources();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
  }
}
