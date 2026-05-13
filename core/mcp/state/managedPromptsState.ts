/**
 * ManagedPromptsState: holds full prompt list, syncs on promptsListChanged.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

export interface ManagedPromptsStateEventMap {
  promptsChange: Prompt[];
}

/**
 * State manager that keeps a full prompt list in sync with the server.
 * Subscribes to connect, promptsListChanged, and statusChange; fetches all
 * pages on refresh.
 */
export class ManagedPromptsState extends TypedEventTarget<ManagedPromptsStateEventMap> {
  private prompts: Prompt[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onPromptsListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.prompts = [];
        this.dispatchTypedEvent("promptsChange", []);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("promptsListChanged", onPromptsListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(
          "promptsListChanged",
          onPromptsListChanged,
        );
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getPrompts(): Prompt[] {
    return [...this.prompts];
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  async refresh(metadata?: Record<string, string>): Promise<Prompt[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getPrompts();
    }
    const effectiveMetadata = metadata ?? this._metadata;
    this.prompts = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listPrompts(cursor, effectiveMetadata);
      this.prompts = cursor ? [...this.prompts, ...result.prompts] : result.prompts;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing prompts`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("promptsChange", this.prompts);
    return this.getPrompts();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.prompts = [];
  }
}
