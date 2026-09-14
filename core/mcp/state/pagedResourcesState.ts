/**
 * PagedResourcesState: holds the resources accumulated so far, loaded one page
 * at a time via loadPage(cursor). Backs paginated mode (`paginatedLists`,
 * #1721): auto-loads page 1 on connect when the setting is on, and tracks the
 * server's `nextCursor` + a running page count as observable state. Clears on
 * disconnect.
 *
 * Intentionally does NOT subscribe to `resourcesListChanged`: cursors are tied
 * to the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller pulls page 1 again via Refresh instead.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Resource } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import type { RequestMetadata } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";
import type { PagePaginationState } from "./pagedToolsState.js";

export interface PagedResourcesStateEventMap {
  resourcesChange: Resource[];
  paginationChange: PagePaginationState;
  /** The last page load's failure, or `null` once a load succeeds. */
  errorChange: Error | null;
}

export interface LoadPageResult {
  resources: Resource[];
  nextCursor?: string;
}

export class PagedResourcesState extends TypedEventTarget<PagedResourcesStateEventMap> {
  private resources: Resource[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  // Double-click guard: a load in flight makes the next `loadPage` a no-op so
  // the same page can't be appended twice (#1721).
  private loading = false;
  // The last page load's failure, kept as observable state so a failing page
  // renders an alert with a Retry instead of an empty sidebar. The aggregate
  // stores carry the same state, but they are not the display source in
  // paginated mode, so their error never fires there (#1998).
  private error: Error | null = null;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      if (this.client?.getServerSettings()?.paginatedLists) {
        // No caller to await this one, so its rejection is caught here rather
        // than left to become an unhandled rejection. Not a swallow:
        // `loadPage` has already recorded the failure via `setError`, and the
        // list panel renders it (#1998).
        void this.loadPage(undefined).catch(() => {});
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

  getResources(): Resource[] {
    return [...this.resources];
  }

  getPagination(): PagePaginationState {
    return { nextCursor: this.nextCursor, pageCount: this.pageCount };
  }

  /** The last page load's failure, or `null` when the last load succeeded. */
  getError(): Error | null {
    return this.error;
  }

  // Compared by identity rather than message: two distinct failures with the
  // same text are still two events, and a re-render on a repeat failure is
  // cheap next to silently coalescing them.
  private setError(value: Error | null): void {
    if (this.error === value) return;
    this.error = value;
    this.dispatchTypedEvent("errorChange", value);
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.resources = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchTypedEvent("resourcesChange", this.resources);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
    // A disconnect ends the session the error belonged to — a stale
    // "couldn't load" must not outlive it into the next connect.
    this.setError(null);
  }

  async loadPage(
    cursor?: string,
    metadata?: RequestMetadata,
  ): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { resources: [], nextCursor: undefined };
    }
    if (this.loading) {
      return { resources: [], nextCursor: this.nextCursor };
    }
    this.loading = true;
    try {
      const result = await c.listResources(cursor, metadata);
      this.resources =
        cursor === undefined
          ? [...result.resources]
          : [...this.resources, ...result.resources];
      this.pageCount = cursor === undefined ? 1 : this.pageCount + 1;
      this.nextCursor = result.nextCursor;
      this.setError(null);
      this.dispatchTypedEvent("resourcesChange", this.resources);
      this.dispatchTypedEvent("paginationChange", this.getPagination());
      return { resources: result.resources, nextCursor: result.nextCursor };
    } catch (err) {
      // Recorded as observable state AND re-thrown: the state drives the
      // panel's alert, while the rejection is what a caller's auth-recovery
      // wrapper keys off to detect a 401 and start a re-authorization. The
      // connect-time load, which has no such caller, catches it above.
      this.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      this.loading = false;
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resources = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.error = null;
  }
}
