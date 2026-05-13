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

export interface FetchRequestLogStateEventMap {
  fetchRequest: FetchRequestEntry;
  fetchRequestsChange: FetchRequestEntry[];
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
}

export class FetchRequestLogState extends TypedEventTarget<FetchRequestLogStateEventMap> {
  private fetchRequests: FetchRequestEntry[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxFetchRequests: number;

  constructor(
    client: InspectorClientProtocol,
    options: FetchRequestLogStateOptions = {},
  ) {
    super();
    this.maxFetchRequests = options.maxFetchRequests ?? 1000;
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

    const sessionStorage = options.sessionStorage;
    const sessionId = options.sessionId;

    if (sessionStorage) {
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
        }
        this.client = null;
      };
    }
  }

  private hydrateFetchRequests(entries: FetchRequestEntry[]): void {
    const trimmed =
      this.maxFetchRequests > 0
        ? entries.slice(-this.maxFetchRequests)
        : entries;
    this.fetchRequests = trimmed;
    this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
  }

  getFetchRequests(): FetchRequestEntry[] {
    return [...this.fetchRequests];
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
