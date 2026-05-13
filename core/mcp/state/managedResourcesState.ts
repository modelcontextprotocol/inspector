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

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onResourcesListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.resources = [];
        this.dispatchTypedEvent("resourcesChange", []);
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

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  async refresh(metadata?: Record<string, string>): Promise<Resource[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
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
