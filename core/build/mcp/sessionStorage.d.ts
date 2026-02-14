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
    /**
     * Save InspectorClient session state.
     * @param sessionId - Unique session identifier (typically from OAuth state authId)
     * @param state - Serialized InspectorClient state
     */
    saveSession(sessionId: string, state: InspectorClientSessionState): Promise<void>;
    /**
     * Load InspectorClient session state.
     * @param sessionId - Unique session identifier
     * @returns Session state or undefined if not found
     */
    loadSession(sessionId: string): Promise<InspectorClientSessionState | undefined>;
    /**
     * Delete session state (cleanup).
     * @param sessionId - Unique session identifier
     */
    deleteSession(sessionId: string): Promise<void>;
}
//# sourceMappingURL=sessionStorage.d.ts.map