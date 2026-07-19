/**
 * PagedPromptsState: holds an aggregated list of prompts loaded one page at a
 * time via loadPage(cursor). Backs single-page mode (`singlePageLists`, #1721):
 * auto-loads page 1 on connect when the setting is on, and tracks the server's
 * `nextCursor` + a running page count as observable state. Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `promptsListChanged`: cursors are tied
 * to the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller pulls page 1 again via Refresh instead.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Prompt } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";
import type { PagePaginationState } from "./pagedToolsState.js";

export interface PagedPromptsStateEventMap {
  promptsChange: Prompt[];
  paginationChange: PagePaginationState;
}

export interface LoadPageResult {
  prompts: Prompt[];
  nextCursor?: string;
}

export class PagedPromptsState extends TypedEventTarget<PagedPromptsStateEventMap> {
  private prompts: Prompt[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      if (this.client?.getServerSettings()?.singlePageLists) {
        void this.loadPage(undefined);
      }
    };
    const onStatusChange = (): void => {
      if (isTerminalStatus(this.client?.getStatus())) {
        this.reset();
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  getPrompts(): Prompt[] {
    return [...this.prompts];
  }

  getPagination(): PagePaginationState {
    return { nextCursor: this.nextCursor, pageCount: this.pageCount };
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.prompts = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchTypedEvent("promptsChange", this.prompts);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
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
    this.prompts =
      cursor === undefined
        ? [...result.prompts]
        : [...this.prompts, ...result.prompts];
    this.pageCount = cursor === undefined ? 1 : this.pageCount + 1;
    this.nextCursor = result.nextCursor;
    this.dispatchTypedEvent("promptsChange", this.prompts);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
    return { prompts: result.prompts, nextCursor: result.nextCursor };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.prompts = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
  }
}
