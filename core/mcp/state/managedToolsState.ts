/**
 * ManagedToolsState: holds full tool list, syncs on toolsListChanged.
 * Takes InspectorClient (will become InspectorClientProtocol in Stage 5).
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedToolsStateEventMap {
  toolsChange: Tool[];
}

/**
 * State manager that keeps a full tool list in sync with the server.
 * Subscribes to client's connect (initial load), toolsListChanged, and statusChange; fetches all pages on refresh.
 * If the caller wants metadata on list_tools (e.g. CLI --metadata), set it via setMetadata() so internal refresh() calls use it.
 */
export class ManagedToolsState extends TypedEventTarget<ManagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClient) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onToolsListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.tools = [];
        this.dispatchTypedEvent("toolsChange", []);
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

  /**
   * Set metadata to include in list_tools when refresh() is called (including internal calls on connect / toolsListChanged).
   * Call this when the caller has metadata (e.g. CLI --metadata) so every refresh uses it.
   */
  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  /**
   * Fetch all pages of tools and update state; dispatches toolsChange when done.
   * Uses listTools() so the client's own list state is not modified.
   * Uses passed-in metadata for this call, or the metadata set via setMetadata() if none passed.
   */
  async refresh(metadata?: Record<string, string>): Promise<Tool[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
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

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tools = [];
  }
}
