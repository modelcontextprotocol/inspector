/**
 * PagedPromptsState: holds an aggregated list of prompts loaded via loadPage(cursor).
 * Does not load on connect; caller drives loading. Clears on disconnect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface PagedPromptsStateEventMap {
  promptsChange: Prompt[];
}

export interface LoadPageResult {
  prompts: Prompt[];
  nextCursor?: string;
}

/**
 * State manager that holds the union of prompts loaded via loadPage().
 * Subscribes only to statusChange to clear on disconnect.
 */
export class PagedPromptsState extends TypedEventTarget<PagedPromptsStateEventMap> {
  private prompts: Prompt[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClient) {
    super();
    this.client = client;
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.prompts = [];
        this.dispatchTypedEvent("promptsChange", []);
      }
    };
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getPrompts(): Prompt[] {
    return [...this.prompts];
  }

  clear(): void {
    this.prompts = [];
    this.dispatchTypedEvent("promptsChange", this.prompts);
  }

  async loadPage(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { prompts: [], nextCursor: undefined };
    }
    const result = await c.listPrompts(cursor, metadata);
    if (cursor === undefined) {
      this.prompts = [...result.prompts];
    } else {
      this.prompts = [...this.prompts, ...result.prompts];
    }
    this.dispatchTypedEvent("promptsChange", this.prompts);
    return {
      prompts: result.prompts,
      nextCursor: result.nextCursor,
    };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.prompts = [];
  }
}
