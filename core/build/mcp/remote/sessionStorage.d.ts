/**
 * Remote HTTP storage implementation for InspectorClient session state.
 * Uses the remote /api/storage/:storeId endpoint to persist session data
 * across page navigations during OAuth flows.
 */
import type { InspectorClientStorage, InspectorClientSessionState } from "../sessionStorage.js";
export interface RemoteInspectorClientStorageOptions {
    /** Base URL of the remote server (e.g. http://localhost:3000) */
    baseUrl: string;
    /** Optional auth token for x-mcp-remote-auth header */
    authToken?: string;
    /** Fetch function to use (default: globalThis.fetch) */
    fetchFn?: typeof fetch;
}
/**
 * Remote HTTP storage implementation for InspectorClient session state.
 * Stores session data via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to persist session state across OAuth redirects.
 */
export declare class RemoteInspectorClientStorage implements InspectorClientStorage {
    private baseUrl;
    private authToken?;
    private fetchFn;
    constructor(options: RemoteInspectorClientStorageOptions);
    private getStoreId;
    saveSession(sessionId: string, state: InspectorClientSessionState): Promise<void>;
    loadSession(sessionId: string): Promise<InspectorClientSessionState | undefined>;
    deleteSession(sessionId: string): Promise<void>;
}
//# sourceMappingURL=sessionStorage.d.ts.map