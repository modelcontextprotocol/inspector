import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
/**
 * Discovers OAuth scopes from server metadata, with preference for resource metadata scopes
 * @param serverUrl - The MCP server URL
 * @param resourceMetadata - Optional resource metadata containing preferred scopes
 * @param fetchFn - Optional fetch function for HTTP requests (e.g. proxy fetch in browser)
 * @returns Promise resolving to space-separated scope string or undefined
 */
export declare const discoverScopes: (serverUrl: string, resourceMetadata?: OAuthProtectedResourceMetadata, fetchFn?: typeof fetch) => Promise<string | undefined>;
//# sourceMappingURL=discovery.d.ts.map