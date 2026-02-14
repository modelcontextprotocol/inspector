import { OAuthClientInformationSchema, OAuthTokensSchema, } from "@modelcontextprotocol/sdk/shared/auth.js";
import * as path from "node:path";
import { createOAuthStore } from "../store.js";
import { createFileStorageAdapter } from "../../storage/adapters/file-storage.js";
const DEFAULT_STATE_PATH = (() => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return path.join(homeDir, ".mcp-inspector", "oauth", "state.json");
})();
/**
 * Get path to state.json file.
 * @param customPath - Optional custom path (full path to state file). Default: ~/.mcp-inspector/oauth/state.json
 */
export function getStateFilePath(customPath) {
    return customPath ?? DEFAULT_STATE_PATH;
}
const storeCache = new Map();
/**
 * Get or create the OAuth store instance for the given path.
 * @param stateFilePath - Optional custom path to state file. Default: ~/.mcp-inspector/oauth/state.json
 */
export function getOAuthStore(stateFilePath) {
    const key = getStateFilePath(stateFilePath);
    let store = storeCache.get(key);
    if (!store) {
        const filePath = getStateFilePath(stateFilePath);
        const storage = createFileStorageAdapter({ filePath });
        store = createOAuthStore(storage);
        storeCache.set(key, store);
    }
    return store;
}
/**
 * Clear all OAuth client state (all servers) in the default store.
 * Useful for test isolation in E2E OAuth tests.
 * Use a custom-path store and clear per serverUrl if you need to clear non-default storage.
 */
export function clearAllOAuthClientState() {
    const store = getOAuthStore();
    const state = store.getState();
    const urls = Object.keys(state.servers ?? {});
    for (const url of urls) {
        state.clearServerState(url);
    }
}
/**
 * Node.js storage implementation using Zustand with file-based persistence
 * For InspectorClient, CLI, and TUI
 */
export class NodeOAuthStorage {
    store;
    /**
     * @param storagePath - Optional path to state file. Default: ~/.mcp-inspector/oauth/state.json
     */
    constructor(storagePath) {
        this.store = getOAuthStore(storagePath);
    }
    async getClientInformation(serverUrl, isPreregistered) {
        const state = this.store.getState().getServerState(serverUrl);
        const clientInfo = isPreregistered
            ? state.preregisteredClientInformation
            : state.clientInformation;
        if (!clientInfo) {
            return undefined;
        }
        return await OAuthClientInformationSchema.parseAsync(clientInfo);
    }
    async saveClientInformation(serverUrl, clientInformation) {
        this.store.getState().setServerState(serverUrl, {
            clientInformation,
        });
    }
    async savePreregisteredClientInformation(serverUrl, clientInformation) {
        this.store.getState().setServerState(serverUrl, {
            preregisteredClientInformation: clientInformation,
        });
    }
    clearClientInformation(serverUrl, isPreregistered) {
        const state = this.store.getState().getServerState(serverUrl);
        const updates = {};
        if (isPreregistered) {
            updates.preregisteredClientInformation = undefined;
        }
        else {
            updates.clientInformation = undefined;
        }
        this.store.getState().setServerState(serverUrl, updates);
    }
    async getTokens(serverUrl) {
        const state = this.store.getState().getServerState(serverUrl);
        if (!state.tokens) {
            return undefined;
        }
        return await OAuthTokensSchema.parseAsync(state.tokens);
    }
    async saveTokens(serverUrl, tokens) {
        this.store.getState().setServerState(serverUrl, { tokens });
    }
    clearTokens(serverUrl) {
        this.store.getState().setServerState(serverUrl, { tokens: undefined });
    }
    getCodeVerifier(serverUrl) {
        const state = this.store.getState().getServerState(serverUrl);
        return state.codeVerifier;
    }
    async saveCodeVerifier(serverUrl, codeVerifier) {
        this.store.getState().setServerState(serverUrl, { codeVerifier });
    }
    clearCodeVerifier(serverUrl) {
        this.store
            .getState()
            .setServerState(serverUrl, { codeVerifier: undefined });
    }
    getScope(serverUrl) {
        const state = this.store.getState().getServerState(serverUrl);
        return state.scope;
    }
    async saveScope(serverUrl, scope) {
        this.store.getState().setServerState(serverUrl, { scope });
    }
    clearScope(serverUrl) {
        this.store.getState().setServerState(serverUrl, { scope: undefined });
    }
    getServerMetadata(serverUrl) {
        const state = this.store.getState().getServerState(serverUrl);
        return state.serverMetadata || null;
    }
    async saveServerMetadata(serverUrl, metadata) {
        this.store
            .getState()
            .setServerState(serverUrl, { serverMetadata: metadata });
    }
    clearServerMetadata(serverUrl) {
        this.store
            .getState()
            .setServerState(serverUrl, { serverMetadata: undefined });
    }
    clear(serverUrl) {
        this.store.getState().clearServerState(serverUrl);
    }
}
//# sourceMappingURL=storage-node.js.map