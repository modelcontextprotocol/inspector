/**
 * OAuth store factory using Zustand.
 * Creates a store with any storage adapter (file, remote, sessionStorage).
 */
import { createJSONStorage } from "zustand/middleware";
import type { OAuthClientInformation, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
/**
 * OAuth state for a single server
 */
export interface ServerOAuthState {
    clientInformation?: OAuthClientInformation;
    preregisteredClientInformation?: OAuthClientInformation;
    tokens?: OAuthTokens;
    codeVerifier?: string;
    scope?: string;
    serverMetadata?: OAuthMetadata;
}
/**
 * Zustand store state (all servers)
 */
export interface OAuthStoreState {
    servers: Record<string, ServerOAuthState>;
    getServerState: (serverUrl: string) => ServerOAuthState;
    setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
    clearServerState: (serverUrl: string) => void;
}
/**
 * Creates a Zustand store for OAuth state with the given storage adapter.
 * The storage adapter handles persistence (file, remote HTTP, sessionStorage, etc.).
 *
 * @param storage - Zustand storage adapter (from createJSONStorage)
 * @returns Zustand store instance
 */
export declare function createOAuthStore(storage: ReturnType<typeof createJSONStorage>): Omit<import("zustand/vanilla").StoreApi<OAuthStoreState>, "setState" | "persist"> & {
    setState(partial: OAuthStoreState | Partial<OAuthStoreState> | ((state: OAuthStoreState) => OAuthStoreState | Partial<OAuthStoreState>), replace?: false | undefined): unknown;
    setState(state: OAuthStoreState | ((state: OAuthStoreState) => OAuthStoreState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<OAuthStoreState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: OAuthStoreState) => void) => () => void;
        onFinishHydration: (fn: (state: OAuthStoreState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<OAuthStoreState, unknown, unknown>>;
    };
};
//# sourceMappingURL=store.d.ts.map