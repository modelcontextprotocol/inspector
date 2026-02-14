import { createJSONStorage } from "zustand/middleware";
import { OAuthClientInformationSchema, OAuthTokensSchema, } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createOAuthStore } from "../store.js";
/**
 * Browser storage implementation using Zustand with sessionStorage.
 * For web client (can be used by InspectorClient in browser).
 */
export class BrowserOAuthStorage {
    store;
    constructor() {
        // Use Zustand's built-in sessionStorage adapter
        // The `name` option in persist() ("mcp-inspector-oauth") becomes the sessionStorage key
        const storage = createJSONStorage(() => sessionStorage);
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
//# sourceMappingURL=storage.js.map