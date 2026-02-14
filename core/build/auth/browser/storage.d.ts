import type { OAuthStorage } from "../storage.js";
import type { OAuthClientInformation, OAuthTokens, OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
/**
 * Browser storage implementation using Zustand with sessionStorage.
 * For web client (can be used by InspectorClient in browser).
 */
export declare class BrowserOAuthStorage implements OAuthStorage {
    private store;
    constructor();
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
//# sourceMappingURL=storage.d.ts.map