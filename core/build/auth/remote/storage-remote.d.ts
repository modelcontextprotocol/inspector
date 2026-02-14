/**
 * Remote HTTP storage implementation for OAuth state.
 * Uses Zustand with remote storage adapter (HTTP API).
 * For web clients that need to share state with Node apps.
 */
import type { OAuthStorage } from "../storage.js";
import type { OAuthClientInformation, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
export interface RemoteOAuthStorageOptions {
    /** Base URL of the remote server (e.g. http://localhost:3000) */
    baseUrl: string;
    /** Store ID (default: "oauth") */
    storeId?: string;
    /** Optional auth token for x-mcp-remote-auth header */
    authToken?: string;
    /** Fetch function to use (default: globalThis.fetch) */
    fetchFn?: typeof fetch;
}
/**
 * Remote HTTP storage implementation using Zustand with remote storage adapter.
 * Stores OAuth state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to share state with Node apps (TUI, CLI).
 */
export declare class RemoteOAuthStorage implements OAuthStorage {
    private store;
    constructor(options: RemoteOAuthStorageOptions);
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
//# sourceMappingURL=storage-remote.d.ts.map