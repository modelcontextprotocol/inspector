/**
 * ManagedToolsState: keeps full tool list in sync with the server.
 * State is held in a Zustand store; manager updates it and exposes getStore() for read-only subscription.
 */

import { createStore } from "zustand/vanilla";
import type { InspectorClient } from "../inspectorClient.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const MAX_PAGES = 100;

/** Read-only store view: getState + subscribe, no setState. Use for hooks and other consumers. */
export interface ManagedToolsReadOnlyStore {
  getState: () => { tools: Tool[] };
  subscribe: (listener: () => void) => () => void;
}

/**
 * State manager that keeps a full tool list in sync with the server.
 * Subscribes to client's connect, toolsListChanged, and statusChange; fetches all pages on refresh.
 * Use getStore() for subscription (e.g. in React via useStore); use getTools() for one-off read.
 */
export class ManagedToolsState {
  private readonly store = createStore<{ tools: Tool[] }>()((_set) => ({
    tools: [],
  }));
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClient) {
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onToolsListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.store.setState({ tools: [] });
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

  /** Read-only store for subscription (e.g. useStore(manager.getStore(), s => s.tools)). */
  getStore(): ManagedToolsReadOnlyStore {
    return {
      getState: () => this.store.getState(),
      subscribe: (listener) => this.store.subscribe(listener),
    };
  }

  getTools(): Tool[] {
    return [...this.store.getState().tools];
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
    const tools: Tool[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listTools(cursor, effectiveMetadata);
      tools.push(...result.tools);
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing tools`,
        );
      }
    } while (cursor);
    this.store.setState({ tools });
    return this.getTools();
  }

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.store.setState({ tools: [] });
  }
}
