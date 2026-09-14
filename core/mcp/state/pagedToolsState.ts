/**
 * PagedToolsState: holds the tools accumulated so far, loaded one page at a time
 * via loadPage(cursor). Backs paginated mode (the `paginatedLists` setting,
 * #1721): auto-loads page 1 on connect when the setting is on, and tracks the
 * server's `nextCursor` + a running page count as observable state so the
 * sidebar can surface a "Load next page" control. Clears on disconnect.
 *
 * Intentionally does NOT subscribe to `toolsListChanged`: cursors are tied to
 * the server's prior list, so a list change mid-pagination would invalidate
 * them. The caller pulls page 1 again via Refresh instead (the managed variant
 * owns the auto-refresh shape).
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Tool } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

/** Observable pagination progress for a paged list. */
export interface PagePaginationState {
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Number of pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
}

export interface PagedToolsStateEventMap {
  toolsChange: Tool[];
  paginationChange: PagePaginationState;
  /** The last page load's failure, or `null` once a load succeeds. */
  errorChange: Error | null;
}

export interface LoadPageResult {
  tools: Tool[];
  nextCursor?: string;
}

export class PagedToolsState extends TypedEventTarget<PagedToolsStateEventMap> {
  private tools: Tool[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  // Guards against a concurrent load (e.g. a fast double-click on "Load next
  // page"): both calls would otherwise read the same cursor and append the
  // same page twice. A load in flight makes the next `loadPage` a no-op (#1721).
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
      // Auto-load page 1 only in paginated mode — otherwise the managed
      // (aggregate) state is the display source and this stays idle (#1721).
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

  getTools(): Tool[] {
    return [...this.tools];
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

  /** Clear the accumulated list and pagination progress. */
  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.tools = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchTypedEvent("toolsChange", this.tools);
    this.dispatchTypedEvent("paginationChange", this.getPagination());
    // A disconnect ends the session the error belonged to — a stale
    // "couldn't load" must not outlive it into the next connect.
    this.setError(null);
  }

  async loadPage(cursor?: string): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { tools: [], nextCursor: undefined };
    }
    // Drop a concurrent load (double-click guard) — the in-flight one owns the
    // current cursor; return it so callers don't misread this as "the end".
    if (this.loading) {
      return { tools: [], nextCursor: this.nextCursor };
    }
    this.loading = true;
    try {
      const result = await c.listTools(cursor, undefined);
      // An undefined cursor is page 1 — replace the list and reset the count;
      // a cursor appends the next page.
      this.tools =
        cursor === undefined
          ? [...result.tools]
          : [...this.tools, ...result.tools];
      this.pageCount = cursor === undefined ? 1 : this.pageCount + 1;
      this.nextCursor = result.nextCursor;
      this.setError(null);
      this.dispatchTypedEvent("toolsChange", this.tools);
      this.dispatchTypedEvent("paginationChange", this.getPagination());
      return { tools: result.tools, nextCursor: result.nextCursor };
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
    this.tools = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.error = null;
  }
}
