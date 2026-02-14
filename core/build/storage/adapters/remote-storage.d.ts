/**
 * Remote HTTP storage adapter for Zustand persist middleware.
 * Stores entire store state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 */
import { createJSONStorage } from "zustand/middleware";
export interface RemoteStorageAdapterOptions {
    /** Base URL of the remote server (e.g. http://localhost:3000) */
    baseUrl: string;
    /** Store ID (e.g. "oauth", "inspector-settings") */
    storeId: string;
    /** Optional auth token for x-mcp-remote-auth header */
    authToken?: string;
    /** Fetch function to use (default: globalThis.fetch) */
    fetchFn?: typeof fetch;
}
/**
 * Creates a Zustand storage adapter that reads/writes via HTTP API.
 * Conforms to Zustand's StateStorage interface.
 */
export declare function createRemoteStorageAdapter(options: RemoteStorageAdapterOptions): ReturnType<typeof createJSONStorage>;
//# sourceMappingURL=remote-storage.d.ts.map