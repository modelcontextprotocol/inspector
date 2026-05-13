import type { FetchRequestEntry } from "./types.js";

/**
 * Serialized session state for InspectorClient.
 * Contains data that should persist across page navigations (e.g., OAuth redirects).
 */
export interface InspectorClientSessionState {
  /** Fetch requests tracked during the session */
  fetchRequests: FetchRequestEntry[];
  /** Timestamp when session was created */
  createdAt: number;
  /** Timestamp when session was last updated */
  updatedAt: number;
}

/**
 * Storage interface for persisting InspectorClient session state.
 * Used to maintain session data (e.g., fetch requests) across page navigations
 * during OAuth flows.
 */
export interface InspectorClientStorage {
  saveSession(
    sessionId: string,
    state: InspectorClientSessionState,
  ): Promise<void>;
  loadSession(
    sessionId: string,
  ): Promise<InspectorClientSessionState | undefined>;
  deleteSession(sessionId: string): Promise<void>;
}
