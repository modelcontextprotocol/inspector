/**
 * ManagedListState: shared base for the per-primitive list state managers
 * (tools, prompts, resources, resource templates). Each keeps a full list in
 * sync with the server — loaded on connect, cleared on disconnect, paginated on
 * refresh — and (for the three with a sidebar indicator) tracks a "list changed
 * since last refresh" flag.
 *
 * Subclasses are thin: they supply a config (which list method to page, which
 * capability gates it, which `*Change` / `*ListChanged` events to use) and a
 * typed getter alias (`getTools()` etc.). All behavior lives here so the four
 * managers can't drift (#1444).
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

const MAX_PAGES = 100;

/**
 * Default delay (ms) for debouncing `list_changed` notifications. Servers
 * (e.g. the everything server) can emit a rapid burst; debouncing collapses the
 * burst into a single action once it settles (one indicator light when
 * auto-refresh is off, or one fetch when on) instead of one per notification
 * (#1444).
 */
export const DEFAULT_LIST_CHANGED_DEBOUNCE_MS = 250;

/** Every managed-list event map carries the list-changed indicator event. */
export interface ManagedListEventMap {
  listChangedChange: boolean;
}

/** A single page of a list result, normalized across the SDK list methods. */
export interface ListPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface ManagedListConfig<T, M extends ManagedListEventMap> {
  /** The `*Change` event this manager dispatches (e.g. "toolsChange"). */
  changeEvent: keyof M;
  /** The client notification that signals the list changed. */
  listChangedEvent: keyof InspectorClientEventMap;
  /** Server capability gating the list call (empty list when absent). */
  capabilityKey: keyof ServerCapabilities;
  /** Human label used in the pagination-cap error message. */
  itemLabel: string;
  /** Fetch a single page from the client. */
  fetchPage: (
    client: InspectorClientProtocol,
    cursor: string | undefined,
    metadata: Record<string, string> | undefined,
  ) => Promise<ListPage<T>>;
  /**
   * Whether this list drives a list-changed indicator. When true, a
   * `list_changed` in non-auto-refresh mode lights the indicator blindly (no
   * list call); when false (resource templates, which have no indicator of
   * their own), a `list_changed` in non-auto mode does nothing — the list is
   * pulled via the screen's Refresh instead.
   */
  supportsIndicator: boolean;
  /** Debounce delay (ms) for `list_changed` bursts. */
  debounceMs: number;
}

export abstract class ManagedListState<
  T,
  M extends ManagedListEventMap,
> extends TypedEventTarget<M> {
  protected items: T[] = [];
  protected client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private _metadata: Record<string, string> | undefined = undefined;
  private listChanged = false;
  private readonly config: ManagedListConfig<T, M>;
  // Debounce a burst of `list_changed` notifications into a single
  // refresh (or one indicator light) once it settles.
  private listChangedTimer: ReturnType<typeof setTimeout> | null = null;
  // Second line of defense beyond the debounce, for the auto-refresh path:
  // while a refresh is fetching, a new (post-debounce) notification queues a
  // single re-run instead
  // of firing another concurrent paginated fetch.
  private running = false;
  private runQueued = false;

  constructor(
    client: InspectorClientProtocol,
    config: ManagedListConfig<T, M>,
  ) {
    super();
    this.client = client;
    this.config = config;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onListChanged = (): void => {
      // Debounce: collapse a burst of notifications into one settled action
      // (indicator light when off, fetch when on) instead of one per
      // notification (#1444).
      if (this.listChangedTimer !== null) clearTimeout(this.listChangedTimer);
      this.listChangedTimer = setTimeout(() => {
        this.listChangedTimer = null;
        this.runListChanged();
      }, config.debounceMs);
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        if (this.listChangedTimer !== null) {
          clearTimeout(this.listChangedTimer);
          this.listChangedTimer = null;
        }
        this.items = [];
        this.dispatchChange();
        this.setListChanged(false);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener(config.listChangedEvent, onListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.listChangedTimer !== null) {
        clearTimeout(this.listChangedTimer);
        this.listChangedTimer = null;
      }
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(config.listChangedEvent, onListChanged);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  /**
   * The debounced list-changed action. With auto-refresh on, pull the new list
   * (guarded against overlap so a slow older fetch can't clobber a newer list
   * via last-write-wins `applyItems`). With auto-refresh off, lights the
   * indicator without any network — the user pulls the new list via Refresh
   * (#1402, #1444). Lists without an indicator (resource templates) do nothing
   * in the off case.
   */
  private runListChanged(): void {
    if (this.running) {
      this.runQueued = true;
      return;
    }
    void this.runListChangedOnce();
  }

  private async runListChangedOnce(): Promise<void> {
    this.running = true;
    try {
      do {
        this.runQueued = false;
        // Read the setting at fire time so a `setServerSettings` toggle that
        // lands mid-burst is honored on the settled action.
        if (this.client?.getServerSettings()?.autoRefreshOnListChanged) {
          await this.refresh();
        } else if (this.config.supportsIndicator) {
          this.setListChanged(true);
        }
      } while (this.runQueued);
    } finally {
      this.running = false;
    }
  }

  /** Defensive copy of the current list. */
  protected getItems(): T[] {
    return [...this.items];
  }

  /** Whether a `list_changed` arrived since the last refresh (indicator on). */
  getListChanged(): boolean {
    return this.listChanged;
  }

  /**
   * Clear the list-changed flag — called when the user refreshes the list. The
   * blind light on the notification leaves the indicator set until the user
   * acknowledges by pulling.
   */
  clearListChanged(): void {
    this.setListChanged(false);
  }

  /**
   * Dispatch a configured event by name. `dispatchTypedEvent`'s
   * `EventMap[K] extends void ? [] : [detail]` overload can't resolve when the
   * key is a generic `keyof M`, so we narrow the method signature here. The
   * concrete subclass event maps keep the call sites type-safe.
   */
  private emit(type: keyof M, detail: unknown): void {
    (
      this.dispatchTypedEvent as unknown as (t: keyof M, d: unknown) => void
    )(type, detail);
  }

  private setListChanged(value: boolean): void {
    if (this.listChanged === value) return;
    this.listChanged = value;
    this.emit("listChangedChange", value);
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  async refresh(metadata?: Record<string, string>): Promise<T[]> {
    const next = await this.fetchAll(metadata);
    // `null` means not connected — leave the current list untouched.
    if (next === null) return this.getItems();
    this.applyItems(next);
    return this.getItems();
  }

  /**
   * Fetch all pages, then `applyItems` commits them (see `refresh`). Returns
   * `null` when not connected, or
   * `[]` when the server doesn't advertise the gating capability (calling the
   * list method there returns -32601 "Method not found", which would spam the
   * console; empty list is the right semantics).
   */
  private async fetchAll(
    metadata?: Record<string, string>,
  ): Promise<T[] | null> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return null;
    if (!client.getCapabilities()?.[this.config.capabilityKey]) return [];
    const effectiveMetadata = metadata ?? this._metadata;
    let items: T[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await this.config.fetchPage(
        client,
        cursor,
        effectiveMetadata,
      );
      items = cursor ? [...items, ...page.items] : page.items;
      cursor = page.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing ${this.config.itemLabel}`,
        );
      }
    } while (cursor);
    return items;
  }

  /** Commit a fetched list as the current one and notify subscribers. */
  private applyItems(items: T[]): void {
    this.items = items;
    this.dispatchChange();
  }

  private dispatchChange(): void {
    this.emit(this.config.changeEvent, this.getItems());
  }

  /** Unsubscribe from the client and drop the list; idempotent. */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.items = [];
  }
}
