/**
 * Remote HTTP storage implementation for OAuth state.
 * Uses Zustand with remote storage adapter (HTTP API).
 * For web clients that need to share state with Node apps.
 */
import { OAuthClientInformationSchema, OAuthTokensSchema, } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createOAuthStore } from "../store.js";
import { createRemoteStorageAdapter } from "../../storage/adapters/remote-storage.js";
/**
 * Remote HTTP storage implementation using Zustand with remote storage adapter.
 * Stores OAuth state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to share state with Node apps (TUI, CLI).
 */
export class RemoteOAuthStorage {
    store;
    constructor(options) {
        const storage = createRemoteStorageAdapter({
            baseUrl: options.baseUrl,
            storeId: options.storeId ?? "oauth",
            authToken: options.authToken,
            fetchFn: options.fetchFn,
        });
        this.store = createOAuthStore(storage);
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
//# sourceMappingURL=storage-remote.js.map