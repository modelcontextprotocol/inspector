/**
 * OAuth Test Server Infrastructure
 *
 * Provides OAuth 2.1 authorization server functionality for test servers.
 * Integrates with Express apps to add OAuth endpoints and Bearer token verification.
 */
import express from "express";
import type { ServerConfig } from "./composable-test-server.js";
/**
 * OAuth configuration from ServerConfig
 */
export type OAuthConfig = NonNullable<ServerConfig["oauth"]>;
/**
 * Set up OAuth routes on an Express application
 * This adds all OAuth endpoints (authorization, token, metadata, etc.)
 *
 * @param app - Express application
 * @param config - OAuth configuration
 * @param baseUrl - Base URL of the test server (for constructing issuer URL)
 */
export declare function setupOAuthRoutes(app: express.Application, config: OAuthConfig, baseUrl: string): void;
/**
 * Create Bearer token verification middleware
 * Returns 401 if token is missing or invalid when requireAuth is true
 *
 * @param config - OAuth configuration
 * @returns Express middleware function
 */
export declare function createBearerTokenMiddleware(config: OAuthConfig): express.RequestHandler;
/**
 * Clear all OAuth test data (useful for test cleanup)
 */
export declare function clearOAuthTestData(): void;
/**
 * Returns recorded DCR request bodies (redirect_uris) for tests that verify
 * both normal and guided redirect URLs are registered.
 */
export declare function getDCRRequests(): Array<{
    redirect_uris: string[];
}>;
/**
 * Invalidate a single access token (remove from valid set).
 * Used by E2E tests to simulate expired/revoked access token while keeping
 * refresh_token valid, so 401 → auth() → refresh → retry can be exercised.
 */
export declare function invalidateAccessToken(token: string): void;
//# sourceMappingURL=test-server-oauth.d.ts.map