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
   * `list_changed` in non-auto-refresh mode peeks-and-diffs to light the
   * indicator; when false (resource templates, which have no indicator of
   * their own), a `list_changed` in non-auto mode does nothing — the list is
   * pulled via the screen's Refresh instead.
   */
  supportsIndicator: boolean;
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
      // When the server opts into auto-refresh (per-server setting), pull the
      // new list immediately. Otherwise, for lists with an indicator, peek and
      // diff so the indicator lights only on a real change; lists without an
      // indicator simply wait for the user's Refresh (#1402, #1444).
      if (this.client?.getServerSettings()?.autoRefreshOnListChanged) {
        void this.refresh();
      } else if (config.supportsIndicator) {
        void this.peekForChange();
      }
    };
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.items = [];
        this.dispatchChange();
        this.setListChanged(false);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener(config.listChangedEvent, onListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(config.listChangedEvent, onListChanged);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  /** Defensive copy of the current list. */
  protected getItems(): T[] {
    return [...this.items];
  }

  /** Whether a `list_changed` since the last refresh actually changed the list. */
  getListChanged(): boolean {
    return this.listChanged;
  }

  /**
   * Clear the list-changed flag — called when the user refreshes the list. The
   * peek/auto-refresh on the notification leaves the indicator set until the
   * user acknowledges by pulling.
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
   * Fetch all pages without mutating state or dispatching — used by both
   * refresh (apply) and peek (compare). Returns `null` when not connected, or
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

  /**
   * Fetch on `list_changed` and track whether the server's list differs from
   * what's displayed. The displayed list is left untouched — the user still
   * pulls the new one via Refresh (pull-on-demand). Many servers re-send an
   * identical list on `list_changed`; this keeps the indicator dark in that
   * case, and also clears it if a later notification reverts the server back
   * to the displayed list (nothing left to pull). The flag is order-sensitive:
   * a reorder is a visible change the user would see on Refresh, so it counts
   * (#1444).
   */
  private async peekForChange(): Promise<void> {
    const next = await this.fetchAll();
    if (next === null) return;
    this.setListChanged(JSON.stringify(next) !== JSON.stringify(this.items));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.items = [];
  }
}
