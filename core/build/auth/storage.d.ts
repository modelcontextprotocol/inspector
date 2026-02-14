import type { OAuthClientInformation, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
/**
 * Abstract storage interface for OAuth state
 * Supports both browser (sessionStorage) and Node.js (Zustand) environments
 */
export interface OAuthStorage {
    /**
     * Get client information (preregistered or dynamically registered)
     */
    getClientInformation(serverUrl: string, isPreregistered?: boolean): Promise<OAuthClientInformation | undefined>;
    /**
     * Save client information (dynamically registered)
     */
    saveClientInformation(serverUrl: string, clientInformation: OAuthClientInformation): Promise<void>;
    /**
     * Save preregistered client information (static client from config)
     */
    savePreregisteredClientInformation(serverUrl: string, clientInformation: OAuthClientInformation): Promise<void>;
    /**
     * Clear client information
     */
    clearClientInformation(serverUrl: string, isPreregistered?: boolean): void;
    /**
     * Get OAuth tokens
     */
    getTokens(serverUrl: string): Promise<OAuthTokens | undefined>;
    /**
     * Save OAuth tokens
     */
    saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void>;
    /**
     * Clear OAuth tokens
     */
    clearTokens(serverUrl: string): void;
    /**
     * Get code verifier (for PKCE)
     */
    getCodeVerifier(serverUrl: string): string | undefined;
    /**
     * Save code verifier (for PKCE)
     */
    saveCodeVerifier(serverUrl: string, codeVerifier: string): Promise<void>;
    /**
     * Clear code verifier
     */
    clearCodeVerifier(serverUrl: string): void;
    /**
     * Get scope
     */
    getScope(serverUrl: string): string | undefined;
    /**
     * Save scope
     */
    saveScope(serverUrl: string, scope: string | undefined): Promise<void>;
    /**
     * Clear scope
     */
    clearScope(serverUrl: string): void;
    /**
     * Get server metadata (for guided mode)
     */
    getServerMetadata(serverUrl: string): OAuthMetadata | null;
    /**
     * Save server metadata (for guided mode)
     */
    saveServerMetadata(serverUrl: string, metadata: OAuthMetadata): Promise<void>;
    /**
     * Clear server metadata
     */
    clearServerMetadata(serverUrl: string): void;
    /**
     * Clear all OAuth data for a server
     */
    clear(serverUrl: string): void;
}
/**
 * Generate server-specific storage key
 */
export declare function getServerSpecificKey(baseKey: string, serverUrl: string): string;
/**
 * Base storage keys for OAuth data
 */
export declare const OAUTH_STORAGE_KEYS: {
    readonly CODE_VERIFIER: "mcp_code_verifier";
    readonly TOKENS: "mcp_tokens";
    readonly CLIENT_INFORMATION: "mcp_client_information";
    readonly PREREGISTERED_CLIENT_INFORMATION: "mcp_preregistered_client_information";
    readonly SERVER_METADATA: "mcp_server_metadata";
    readonly SCOPE: "mcp_scope";
};
//# sourceMappingURL=storage.d.ts.map