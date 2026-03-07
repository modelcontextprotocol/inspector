/**
 * FetchRequestLogState: holds fetch request log, subscribes to protocol "fetchRequest" events.
 * Takes InspectorClient (will become InspectorClientProtocol in Stage 5).
 * Protocol emits only per-entry "fetchRequest" (with payload); this manager owns the list
 * and emits fetchRequest + fetchRequestsChange on append, fetchRequestsChange on clear.
 * Mirrors InspectorClient: maxFetchRequests trim, getFetchRequests(), clearFetchRequests().
 * Does not clear on connect/disconnect (client does not clear fetch log).
 *
 * When sessionStorage and sessionId are provided, restores fetch requests from storage on
 * creation and listens for the client's "saveSession" event to persist before OAuth redirect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { FetchRequestEntry } from "../types.js";
import type {
  InspectorClientStorage,
  InspectorClientSessionState,
} from "../sessionStorage.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface FetchRequestLogStateEventMap {
  fetchRequest: FetchRequestEntry;
  fetchRequestsChange: FetchRequestEntry[];
}

export interface FetchRequestLogStateOptions {
  /**
   * Maximum number of fetch requests to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000, matching InspectorClient.
   */
  maxFetchRequests?: number;
  /**
   * When provided with sessionId, fetch requests are restored from storage on creation
   * and saved when the client dispatches "saveSession" (e.g. before OAuth redirect).
   */
  sessionStorage?: InspectorClientStorage;
  /** Session ID for load/save; required for sessionStorage to have effect. */
  sessionId?: string;
}

/**
 * State manager that holds the fetch request log. Subscribes to the protocol's "fetchRequest"
 * event (per-entry with payload); appends to its list (trimming to maxFetchRequests when set),
 * then dispatches "fetchRequest" (payload) and "fetchRequestsChange" (full list).
 * getFetchRequests() and clearFetchRequests() match InspectorClient API.
 * Does not clear on connect or disconnect: pre-connect and post-connect entries both remain.
 * With sessionStorage + sessionId, restores on creation and saves on client "saveSession" event.
 */
export class FetchRequestLogState extends TypedEventTarget<FetchRequestLogStateEventMap> {
  private fetchRequests: FetchRequestEntry[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxFetchRequests: number;

  constructor(
    client: InspectorClient,
    options: FetchRequestLogStateOptions = {},
  ) {
    super();
    this.maxFetchRequests = options.maxFetchRequests ?? 1000;
    this.client = client;

    const onFetchRequest = (event: Event): void => {
      const entry = (event as CustomEvent<FetchRequestEntry>).detail;
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

    // Listen for saveSession whenever we have sessionStorage (sessionId is in the event before redirect)
    if (sessionStorage) {
      const onSaveSession = (event: Event): void => {
        const { sessionId: id } = (event as CustomEvent<{ sessionId: string }>)
          .detail;
        const state: InspectorClientSessionState = {
          fetchRequests: this.getFetchRequests(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        sessionStorage.saveSession(id, state).catch(() => {
          // Fire-and-forget; storage may log internally
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
      // Restore when we have sessionId (e.g. after OAuth callback)
      if (sessionId) {
        sessionStorage.loadSession(sessionId).then((state) => {
          if (this.client && state?.fetchRequests?.length) {
            this.hydrateFetchRequests(state.fetchRequests);
          }
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

  /**
   * Replace current list with restored entries (e.g. from session load). Dispatches fetchRequestsChange.
   */
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
   * Clear all fetch requests. Dispatches fetchRequestsChange only if the list was non-empty.
   */
  clearFetchRequests(): void {
    if (this.fetchRequests.length === 0) return;
    this.fetchRequests = [];
    this.dispatchTypedEvent("fetchRequestsChange", []);
  }

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.fetchRequests = [];
  }
}
