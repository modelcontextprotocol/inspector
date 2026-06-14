/**
 * FetchRequestLogState: holds the fetch request log, subscribes to the protocol
 * "fetchRequest" event. Protocol emits per-entry; this manager owns the list and
 * emits both `fetchRequest` (single entry) and `fetchRequestsChange` (full list)
 * on append, and `fetchRequestsChange` on clear. Does not clear on connect or
 * disconnect.
 *
 * When `sessionStorage` and `sessionId` are provided, restores fetch requests
 * from storage on creation and listens for the client's `saveSession` event to
 * persist before OAuth redirect.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type pino from "pino";
import { silentLogger } from "../../logging/logger.js";
import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { FetchRequestEntry } from "../types.js";
import type {
  InspectorClientStorage,
  InspectorClientSessionState,
} from "../sessionStorage.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";

/**
 * Detail for `fetchRequestBodyDropped`: a deferred response body arrived after
 * its log entry had already rotated out (>= `maxFetchRequests` newer requests
 * appended in between), so the body was unrecoverable. Carries the dropped
 * request id and the cap that was in force, so the UI can explain the drop and
 * offer to raise the limit.
 */
export interface FetchRequestBodyDropped {
  id: string;
  maxFetchRequests: number;
}

export interface FetchRequestLogStateEventMap {
  fetchRequest: FetchRequestEntry;
  fetchRequestsChange: FetchRequestEntry[];
  fetchRequestBodyDropped: FetchRequestBodyDropped;
}

export interface FetchRequestLogStateOptions {
  /**
   * Maximum number of fetch requests to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000.
   */
  maxFetchRequests?: number;
  /**
   * When provided with sessionId, fetch requests are restored from storage on
   * creation and saved when the client dispatches `saveSession` (e.g. before
   * OAuth redirect).
   */
  sessionStorage?: InspectorClientStorage;
  /** Session ID for load/save; required for sessionStorage to have effect. */
  sessionId?: string;
  /**
   * Logger for diagnostic traces (e.g. a deferred body update arriving after
   * its entry rotated out of the log). Defaults to the silent logger.
   */
  logger?: pino.Logger;
}

export class FetchRequestLogState extends TypedEventTarget<FetchRequestLogStateEventMap> {
  private fetchRequests: FetchRequestEntry[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private maxFetchRequests: number;
  private readonly logger: pino.Logger;

  constructor(
    client: InspectorClientProtocol,
    options: FetchRequestLogStateOptions = {},
  ) {
    super();
    this.maxFetchRequests = options.maxFetchRequests ?? 1000;
    this.logger = options.logger ?? silentLogger;
    this.client = client;

    const onFetchRequest = (
      event: TypedEventGeneric<InspectorClientEventMap, "fetchRequest">,
    ): void => {
      const entry = event.detail;
      if (
        this.maxFetchRequests > 0 &&
        this.fetchRequests.length >= this.maxFetchRequests
      ) {
        this.fetchRequests.shift();
      }
      this.fetchRequests.push(entry);
      this.dispatchTypedEvent("fetchRequest", entry);
      this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
    };
    this.client.addEventListener("fetchRequest", onFetchRequest);

    // Body is read asynchronously by fetchTracking and arrives via a
    // separate event; patch the matching entry in place and re-emit so
    // React subscribers re-render with the body filled in.
    const onFetchRequestBodyUpdate = (
      event: TypedEventGeneric<
        InspectorClientEventMap,
        "fetchRequestBodyUpdate"
      >,
    ): void => {
      const { id, responseBody } = event.detail;
      const idx = this.fetchRequests.findIndex((e) => e.id === id);
      if (idx === -1) {
        // The deferred body read (fire-and-forget tee'd stream in
        // fetchTracking) found no matching entry. Distinguish the two causes:
        // a *rotation* drop — the entry was evicted because the log is at
        // capacity (>= maxFetchRequests, with a finite cap) — versus a benign
        // straggler whose entry was simply cleared (length below the cap, or
        // an unlimited log where rotation can't happen). Only the rotation
        // case is unexpected data loss worth surfacing; a post-clear straggler
        // is expected and stays silent.
        const rotatedOut =
          this.maxFetchRequests > 0 &&
          this.fetchRequests.length >= this.maxFetchRequests;
        if (rotatedOut) {
          // `warn` (not `debug`) so the trace clears the web remote logger's
          // default `info` level and is observable without opt-in.
          this.logger.warn(
            { fetchRequestId: id, maxFetchRequests: this.maxFetchRequests },
            "fetchRequestBodyUpdate dropped: entry rotated out before body arrived",
          );
          // Let the UI surface the drop (toast) and offer to raise the cap.
          this.dispatchTypedEvent("fetchRequestBodyDropped", {
            id,
            maxFetchRequests: this.maxFetchRequests,
          });
        }
        return;
      }
      this.fetchRequests[idx] = {
        ...this.fetchRequests[idx]!,
        responseBody,
      };
      // Body fill-in re-emits the list event only, not the per-entry
      // `fetchRequest` event (that one fires once, on append). Consumers read
      // the full list (`useFetchRequests`), so they pick up the body on the
      // next list re-render. A future per-entry subscriber wanting incremental
      // body updates would need its own event here.
      this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
    };
    this.client.addEventListener(
      "fetchRequestBodyUpdate",
      onFetchRequestBodyUpdate,
    );

    const sessionStorage = options.sessionStorage;
    const sessionId = options.sessionId;

    if (sessionStorage) {
      // Backstop persistence on the client's `saveSession` event. For the
      // OAuth full-page-redirect case the web client's `BrowserNavigation`
      // `beforeNavigate` hook is the *primary* flush (it runs synchronously
      // before navigation, so a keepalive request survives the unload); this
      // listener fires from the same event but can lose the race with an
      // already-scheduled navigation. It remains the save path for any
      // non-redirect `saveSession` caller (e.g. a future token-refresh save
      // point) and is harmless when it duplicates the primary flush —
      // last-writer-wins on an identical payload under the same id.
      //
      // SECURITY TRIPWIRE: captured `auth`-category response bodies in this log
      // are stored UNMASKED (masking is a Network-UI display concern only).
      // Today the only `saveSession` trigger is the pre-redirect flush, which
      // runs before the `/token` exchange — so no bearer token is ever
      // persisted. Any NEW `saveSession` trigger added after token exchange
      // (e.g. a periodic snapshot) would write `access_token` /
      // `refresh_token` to disk. Redact response bodies here before persisting
      // if that ever changes.
      const onSaveSession = (
        event: TypedEventGeneric<InspectorClientEventMap, "saveSession">,
      ): void => {
        const { sessionId: id } = event.detail;
        const state: InspectorClientSessionState = {
          fetchRequests: this.getFetchRequests(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        sessionStorage.saveSession(id, state).catch(() => {
          // fire-and-forget; storage may log internally
        });
      };
      this.client.addEventListener("saveSession", onSaveSession);
      this.unsubscribe = () => {
        if (this.client) {
          this.client.removeEventListener("fetchRequest", onFetchRequest);
          this.client.removeEventListener(
            "fetchRequestBodyUpdate",
            onFetchRequestBodyUpdate,
          );
          this.client.removeEventListener("saveSession", onSaveSession);
        }
        this.client = null;
      };
      if (sessionId) {
        sessionStorage
          .loadSession(sessionId)
          .then((state) => {
            if (this.client && state?.fetchRequests?.length) {
              this.hydrateFetchRequests(state.fetchRequests);
            }
          })
          .catch(() => {
            // fire-and-forget; storage may log internally. Matches the
            // saveSession swallow above so a corrupt or unreadable session
            // doesn't surface as an unhandled rejection.
          });
      }
    } else {
      this.unsubscribe = () => {
        if (this.client) {
          this.client.removeEventListener("fetchRequest", onFetchRequest);
          this.client.removeEventListener(
            "fetchRequestBodyUpdate",
            onFetchRequestBodyUpdate,
          );
        }
        this.client = null;
      };
    }
  }

  // Restore persisted entries (e.g. the pre-redirect OAuth Network log loaded
  // on the `/oauth/callback` page). Merges rather than replaces: the async
  // load races against entries appended live by the resuming connect
  // (`completeOAuthFlow` + transport handshake), so we must not clobber
  // whichever arrived first. Restored entries are older, so they go in front;
  // duplicates (by id) already present from a live append are skipped.
  private hydrateFetchRequests(entries: FetchRequestEntry[]): void {
    if (entries.length === 0) return;
    const existingIds = new Set(this.fetchRequests.map((e) => e.id));
    const restored = entries.filter((e) => !existingIds.has(e.id));
    if (restored.length === 0) return;
    const merged = [...restored, ...this.fetchRequests];
    this.fetchRequests =
      this.maxFetchRequests > 0
        ? merged.slice(-this.maxFetchRequests)
        : merged;
    this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
  }

  getFetchRequests(): FetchRequestEntry[] {
    return [...this.fetchRequests];
  }

  /**
   * Adjust the retention cap live (e.g. when the user edits the per-server
   * `maxFetchRequests` setting) without reconnecting. Shrinking the cap trims
   * the oldest entries immediately and re-emits so the Network UI updates;
   * growing it (or setting 0 = unlimited) just takes effect for future appends.
   */
  setMaxFetchRequests(max: number): void {
    if (max === this.maxFetchRequests) return;
    this.maxFetchRequests = max;
    if (max > 0 && this.fetchRequests.length > max) {
      this.fetchRequests = this.fetchRequests.slice(-max);
      this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
    }
  }

  /**
   * Clear all fetch requests. Dispatches fetchRequestsChange only if the list
   * was non-empty.
   */
  clearFetchRequests(): void {
    if (this.fetchRequests.length === 0) return;
    this.fetchRequests = [];
    this.dispatchTypedEvent("fetchRequestsChange", []);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.fetchRequests = [];
  }
}
