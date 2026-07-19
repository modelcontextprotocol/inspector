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
import type {
  CacheMode,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

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

export interface ManagedListConfig<T, M extends ManagedListEventMap> {
  /** The `*Change` event this manager dispatches (e.g. "toolsChange"). */
  changeEvent: keyof M;
  /** The client notification that signals the list changed. */
  listChangedEvent: keyof InspectorClientEventMap;
  /** Server capability gating the list call (empty list when absent). */
  capabilityKey: keyof ServerCapabilities;
  /**
   * Fetch the complete (all-page) list from the client. Delegates page walking
   * to the SDK's cache-aware high-level verb (via the client's `listAll*`
   * methods), which also lets `cacheMode` select the cache disposition.
   */
  fetchAll: (
    client: InspectorClientProtocol,
    cacheMode: CacheMode | undefined,
    metadata: Record<string, string> | undefined,
  ) => Promise<T[]>;
  /**
   * Whether this list drives a list-changed indicator. When true, a
   * `list_changed` in non-auto-refresh mode lights the indicator blindly (no
   * list call); when false (resource templates, which have no indicator of
   * their own), a `list_changed` in non-auto mode does nothing — the list is
   * pulled via the screen's Refresh instead.
   */
  supportsIndicator: boolean;
  /**
   * Whether this list has a paged (paginated) counterpart that drives the
   * display when `paginatedLists` is on. Only such lists defer their
   * connect-time / `list_changed` aggregate walk in paginated mode (tools,
   * prompts, resources). Lists with no paged counterpart (resource templates)
   * set this `false` so they still aggregate on connect regardless of the
   * setting — otherwise they'd never load in paginated mode (#1721).
   */
  deferWhenPaginated: boolean;
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
      // In paginated mode the aggregate list is not the display source (the
      // paged state drives the sidebar), so skip the connect-time all-page
      // walk — the whole point of the setting is to avoid pulling every page
      // for servers with very large lists (#1721). Switching back to
      // all-pages mode triggers a refresh from the UI. Only lists with a paged
      // counterpart defer here; resource templates (none) still aggregate.
      if (
        this.config.deferWhenPaginated &&
        this.client?.getServerSettings()?.paginatedLists
      ) {
        return;
      }
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
      if (isTerminalStatus(this.client?.getStatus())) {
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
        // Read the settings at fire time so a `setServerSettings` toggle that
        // lands mid-burst is honored on the settled action.
        const settings = this.client?.getServerSettings();
        // In paginated mode the aggregate list is not the display source for
        // lists with a paged counterpart, so never auto-aggregate on
        // `list_changed` there — only light the indicator so the user can pull
        // page 1 fresh via Refresh (#1721). This wins over
        // `autoRefreshOnListChanged`, which would otherwise pull every page.
        // Lists with no paged counterpart (resource templates) still aggregate.
        const skipAggregate =
          this.config.deferWhenPaginated && settings?.paginatedLists;
        if (!skipAggregate && settings?.autoRefreshOnListChanged) {
          // A `list_changed` means the prior list is stale, so bypass any
          // cached entry (`cacheMode: "refresh"`) and re-store the fresh
          // aggregate.
          await this.refresh(undefined, "refresh");
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
    (this.dispatchTypedEvent as unknown as (t: keyof M, d: unknown) => void)(
      type,
      detail,
    );
  }

  private setListChanged(value: boolean): void {
    if (this.listChanged === value) return;
    this.listChanged = value;
    this.emit("listChangedChange", value);
  }

  setMetadata(metadata?: Record<string, string>): void {
    this._metadata = metadata;
  }

  /**
   * Refresh the full list. `cacheMode` selects the SDK cache disposition for
   * this fetch: `undefined` (the connect-time load) uses the default `'use'`;
   * a user-initiated or auto refresh passes `'refresh'` to force a
   * cache-bypassing round trip and re-store the fresh aggregate.
   */
  async refresh(
    metadata?: Record<string, string>,
    cacheMode?: CacheMode,
  ): Promise<T[]> {
    const next = await this.fetchItems(metadata, cacheMode);
    // `null` means not connected — leave the current list untouched.
    if (next === null) return this.getItems();
    this.applyItems(next);
    return this.getItems();
  }

  /**
   * Fetch the complete list (all pages, via the SDK's cache-aware verb), then
   * `applyItems` commits it (see `refresh`). Returns `null` when not connected,
   * or `[]` when the server doesn't advertise the gating capability (calling
   * the list method there returns -32601 "Method not found", which would spam
   * the console; empty list is the right semantics).
   */
  private async fetchItems(
    metadata: Record<string, string> | undefined,
    cacheMode: CacheMode | undefined,
  ): Promise<T[] | null> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return null;
    if (!client.getCapabilities()?.[this.config.capabilityKey]) return [];
    const effectiveMetadata = metadata ?? this._metadata;
    return this.config.fetchAll(client, cacheMode, effectiveMetadata);
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
