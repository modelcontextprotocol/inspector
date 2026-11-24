/**
 * PagedEventsState: the event types accumulated so far, loaded one page of
 * `events/list` at a time via `loadPage(cursor)`. Backs paginated mode (the
 * `paginatedLists` setting) for events the way PagedToolsState does for tools:
 * auto-loads page 1 on connect when the setting is on, tracks `nextCursor` and a
 * page count, and clears on disconnect (#3028).
 *
 * Like the tool counterpart it does NOT follow `eventsListChanged`: cursors are
 * tied to the server's prior list, so a change mid-pagination invalidates them,
 * and the caller pulls page 1 again instead.
 *
 * Also collects the event types each page excluded for invalid `x-mcp-header`
 * annotations, since in paginated mode no full walk runs to report them.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { EventType } from "../../extension/events/schemas.js";
import type { ExcludedEventType } from "../../extension/events/headers.js";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";
import type { PagePaginationState } from "./pagedToolsState.js";
import { clientSupportsEvents } from "./managedEventsState.js";

export interface PagedEventsStateEventMap {
  eventTypesChange: EventType[];
  excludedEventTypesChange: ExcludedEventType[];
  paginationChange: PagePaginationState;
  /** The last page load's failure, or `null` once a load succeeds. */
  errorChange: Error | null;
}

export interface LoadEventsPageResult {
  events: EventType[];
  nextCursor?: string;
}

export class PagedEventsState extends TypedEventTarget<PagedEventsStateEventMap> {
  private eventTypes: EventType[] = [];
  private excluded: ExcludedEventType[] = [];
  private nextCursor: string | undefined = undefined;
  private pageCount = 0;
  // Double-click guard: a second load while one is in flight would read the
  // same cursor and append the same page twice.
  private loading = false;
  private error: Error | null = null;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      if (this.client?.getServerSettings()?.paginatedLists) {
        // No caller to await the connect-time load; `loadPage` has already
        // recorded a failure via `setError`, which the panel renders.
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

  getEventTypes(): EventType[] {
    return [...this.eventTypes];
  }

  getExcludedEventTypes(): ExcludedEventType[] {
    return [...this.excluded];
  }

  getPagination(): PagePaginationState {
    return { nextCursor: this.nextCursor, pageCount: this.pageCount };
  }

  getError(): Error | null {
    return this.error;
  }

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
    this.eventTypes = [];
    this.excluded = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.dispatchChanges();
    this.setError(null);
  }

  private dispatchChanges(): void {
    this.dispatchTypedEvent("eventTypesChange", this.getEventTypes());
    this.dispatchTypedEvent(
      "excludedEventTypesChange",
      this.getExcludedEventTypes(),
    );
    this.dispatchTypedEvent("paginationChange", this.getPagination());
  }

  async loadPage(cursor?: string): Promise<LoadEventsPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected" || !clientSupportsEvents(c)) {
      return { events: [], nextCursor: undefined };
    }
    if (this.loading) {
      return { events: [], nextCursor: this.nextCursor };
    }
    this.loading = true;
    try {
      // `clientSupportsEvents` checked `listAllEvents`; a client implements the
      // pair together, and a missing page method reads as an empty page.
      const result = (await c.listEvents?.(cursor, undefined)) ?? {
        events: [],
        excluded: [],
      };
      const first = cursor === undefined;
      this.eventTypes = first
        ? [...result.events]
        : [...this.eventTypes, ...result.events];
      this.excluded = first
        ? [...result.excluded]
        : [...this.excluded, ...result.excluded];
      this.pageCount = first ? 1 : this.pageCount + 1;
      this.nextCursor = result.nextCursor;
      this.setError(null);
      this.dispatchChanges();
      return { events: result.events, nextCursor: result.nextCursor };
    } catch (err) {
      // Recorded AND re-thrown: the state drives the panel's alert, the
      // rejection drives a caller's auth recovery.
      this.setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      this.loading = false;
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.eventTypes = [];
    this.excluded = [];
    this.nextCursor = undefined;
    this.pageCount = 0;
    this.error = null;
  }
}
