/**
 * Remote HTTP storage adapter for Zustand persist middleware.
 * Stores entire store state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 */
import { createJSONStorage } from "zustand/middleware";
/**
 * Creates a Zustand storage adapter that reads/writes via HTTP API.
 * Conforms to Zustand's StateStorage interface.
 */
export function createRemoteStorageAdapter(options) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    return createJSONStorage(() => ({
        getItem: async (name) => {
            const headers = {};
            if (options.authToken) {
                headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
            }
            const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
                method: "GET",
                headers,
            });
            if (!res.ok) {
                if (res.status === 404) {
                    return null;
                }
                throw new Error(`Failed to read store: ${res.status}`);
            }
            const store = await res.json();
            // Zustand stores: { state: {...}, version: number }
            // API returns the stored blob. If empty, Zustand hasn't initialized yet.
            if (Object.keys(store).length === 0) {
                return null; // Empty store means not initialized yet
            }
            // Return the stored Zustand format as string
            return JSON.stringify(store);
        },
        setItem: async (name, value) => {
            const headers = {
                "Content-Type": "application/json",
            };
            if (options.authToken) {
                headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
            }
            // Zustand gives us the full persisted format as a string
            // Store it as-is (the API treats it as an opaque blob)
            const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
                method: "POST",
                headers,
                body: value, // Already a JSON string from Zustand
            });
            if (!res.ok) {
                throw new Error(`Failed to write store: ${res.status}`);
            }
        },
        removeItem: async (name) => {
            const headers = {};
            if (options.authToken) {
                headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
            }
            const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
                method: "DELETE",
                headers,
            });
            // 404 is fine (already deleted), but other errors should propagate
            if (!res.ok && res.status !== 404) {
                throw new Error(`Failed to delete store: ${res.status}`);
            }
        },
    }));
}
//# sourceMappingURL=remote-storage.js.map