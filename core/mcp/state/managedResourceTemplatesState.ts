/**
 * ManagedResourceTemplatesState: holds full resource template list, syncs on resourceTemplatesListChanged.
 * Takes InspectorClient (will become InspectorClientProtocol in Stage 5).
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

/**
 * State manager that keeps a full resource template list in sync with the server.
 * Subscribes to connect, resourceTemplatesListChanged, and statusChange; fetches all pages on refresh.
 * Clears content cache for removed URI templates when the list shrinks after refresh.
 */
export class ManagedResourceTemplatesState extends TypedEventTarget<ManagedResourceTemplatesStateEventMap> {
  private resourceTemplates: ResourceTemplate[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClient) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onResourceTemplatesListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.resourceTemplates = [];
        this.dispatchTypedEvent("resourceTemplatesChange", []);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener(
      "resourceTemplatesListChanged",
      onResourceTemplatesListChanged,
    );
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(
          "resourceTemplatesListChanged",
          onResourceTemplatesListChanged,
        );
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getResourceTemplates(): ResourceTemplate[] {
    return [...this.resourceTemplates];
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  /**
   * Fetch all pages of resource templates and update state; dispatches resourceTemplatesChange when done.
   */
  async refresh(
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplate[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getResourceTemplates();
    }
    const effectiveMetadata = metadata ?? this._metadata;
    this.resourceTemplates = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listResourceTemplates(
        cursor,
        effectiveMetadata,
      );
      this.resourceTemplates =
        cursor === undefined
          ? result.resourceTemplates
          : [...this.resourceTemplates, ...result.resourceTemplates];
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resource templates`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
    return this.getResourceTemplates();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resourceTemplates = [];
  }
}
