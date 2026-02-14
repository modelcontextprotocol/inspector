import type { OAuthStorage } from "../storage.js";
import type { OAuthClientInformation, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
/**
 * Get path to state.json file.
 * @param customPath - Optional custom path (full path to state file). Default: ~/.mcp-inspector/oauth/state.json
 */
export declare function getStateFilePath(customPath?: string): string;
/**
 * Get or create the OAuth store instance for the given path.
 * @param stateFilePath - Optional custom path to state file. Default: ~/.mcp-inspector/oauth/state.json
 */
export declare function getOAuthStore(stateFilePath?: string): Omit<import("zustand/vanilla").StoreApi<import("../store.js").OAuthStoreState>, "setState" | "persist"> & {
    setState(partial: import("../store.js").OAuthStoreState | Partial<import("../store.js").OAuthStoreState> | ((state: import("../store.js").OAuthStoreState) => import("../store.js").OAuthStoreState | Partial<import("../store.js").OAuthStoreState>), replace?: false | undefined): unknown;
    setState(state: import("../store.js").OAuthStoreState | ((state: import("../store.js").OAuthStoreState) => import("../store.js").OAuthStoreState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<import("../store.js").OAuthStoreState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: import("../store.js").OAuthStoreState) => void) => () => void;
        onFinishHydration: (fn: (state: import("../store.js").OAuthStoreState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<import("../store.js").OAuthStoreState, unknown, unknown>>;
    };
};
/**
 * Clear all OAuth client state (all servers) in the default store.
 * Useful for test isolation in E2E OAuth tests.
 * Use a custom-path store and clear per serverUrl if you need to clear non-default storage.
 */
export declare function clearAllOAuthClientState(): void;
/**
 * Node.js storage implementation using Zustand with file-based persistence
 * For InspectorClient, CLI, and TUI
 */
export declare class NodeOAuthStorage implements OAuthStorage {
    private store;
    /**
     * @param storagePath - Optional path to state file. Default: ~/.mcp-inspector/oauth/state.json
     */
    constructor(storagePath?: string);
    getClientInformation(serverUrl: string, isPreregistered?: boolean): Promise<OAuthClientInformation | undefined>;
    saveClientInformation(serverUrl: string, clientInformation: OAuthClientInformation): Promise<void>;
    savePreregisteredClientInformation(serverUrl: string, clientInformation: OAuthClientInformation): Promise<void>;
    clearClientInformation(serverUrl: string, isPreregistered?: boolean): void;
    getTokens(serverUrl: string): Promise<OAuthTokens | undefined>;
    saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void>;
    clearTokens(serverUrl: string): void;
    getCodeVerifier(serverUrl: string): string | undefined;
    saveCodeVerifier(serverUrl: string, codeVerifier: string): Promise<void>;
    clearCodeVerifier(serverUrl: string): void;
    getScope(serverUrl: string): string | undefined;
    saveScope(serverUrl: string, scope: string | undefined): Promise<void>;
    clearScope(serverUrl: string): void;
    getServerMetadata(serverUrl: string): OAuthMetadata | null;
    saveServerMetadata(serverUrl: string, metadata: OAuthMetadata): Promise<void>;
    clearServerMetadata(serverUrl: string): void;
    clear(serverUrl: string): void;
}
//# sourceMappingURL=storage-node.d.ts.map