/**
 * ManagedResourceTemplatesState: holds full resource template list, syncs on
 * resourceTemplatesListChanged.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedResourceTemplatesStateEventMap {
  resourceTemplatesChange: ResourceTemplate[];
}

/**
 * State manager that keeps a full resource template list in sync with the server.
 * Subscribes to connect, resourceTemplatesListChanged, and statusChange;
 * fetches all pages on refresh.
 */
export class ManagedResourceTemplatesState extends TypedEventTarget<ManagedResourceTemplatesStateEventMap> {
  private resourceTemplates: ResourceTemplate[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClientProtocol) {
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
      this.resourceTemplates = cursor
        ? [...this.resourceTemplates, ...result.resourceTemplates]
        : result.resourceTemplates;
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
