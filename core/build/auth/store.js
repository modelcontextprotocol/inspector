/**
 * OAuth store factory using Zustand.
 * Creates a store with any storage adapter (file, remote, sessionStorage).
 */
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
/**
 * Creates a Zustand store for OAuth state with the given storage adapter.
 * The storage adapter handles persistence (file, remote HTTP, sessionStorage, etc.).
 *
 * @param storage - Zustand storage adapter (from createJSONStorage)
 * @returns Zustand store instance
 */
export function createOAuthStore(storage) {
    return createStore()(persist((set, get) => ({
        servers: {},
        getServerState: (serverUrl) => {
            return get().servers[serverUrl] || {};
        },
        setServerState: (serverUrl, updates) => {
            set((state) => ({
                servers: {
                    ...state.servers,
                    [serverUrl]: {
                        ...state.servers[serverUrl],
                        ...updates,
                    },
                },
            }));
        },
        clearServerState: (serverUrl) => {
            set((state) => {
                const { [serverUrl]: _, ...rest } = state.servers;
                return { servers: rest };
            });
        },
    }), {
        name: "mcp-inspector-oauth",
        storage,
    }));
}
//# sourceMappingURL=store.js.map