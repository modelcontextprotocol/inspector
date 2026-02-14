export type OAuthCallbackHandler = (params: {
    code: string;
    state?: string;
}) => Promise<void>;
export type OAuthErrorHandler = (params: {
    error: string;
    error_description?: string | null;
}) => void;
export interface OAuthCallbackServerStartOptions {
    port?: number;
    hostname?: string;
    path?: string;
    onCallback?: OAuthCallbackHandler;
    onError?: OAuthErrorHandler;
}
export interface OAuthCallbackServerStartResult {
    port: number;
    redirectUrl: string;
}
/**
 * Minimal HTTP server that receives OAuth 2.1 redirects at GET /oauth/callback.
 * Used by TUI/CLI to complete the authorization code flow (both normal and guided).
 * Caller provides onCallback/onError; typically onCallback calls
 * InspectorClient.completeOAuthFlow(code) then stops the server.
 */
export declare class OAuthCallbackServer {
    private server;
    private port;
    private hostname;
    private callbackPath;
    private handled;
    private onCallback?;
    private onError?;
    /**
     * Start the server. Listens on the given port (default 0 = random).
     * Returns port and redirectUrl for use as oauth.redirectUrl.
     */
    start(options?: OAuthCallbackServerStartOptions): Promise<OAuthCallbackServerStartResult>;
    /**
     * Stop the server. Idempotent.
     */
    stop(): Promise<void>;
    private handleRequest;
}
/**
 * Create an OAuth callback server instance.
 * Use start() then stop() when the OAuth flow is done.
 */
export declare function createOAuthCallbackServer(): OAuthCallbackServer;
//# sourceMappingURL=oauth-callback-server.d.ts.map