import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Discovers OAuth scopes from server metadata, with preference for resource metadata scopes
 * @param serverUrl - The MCP server URL
 * @param resourceMetadata - Optional resource metadata containing preferred scopes
 * @param fetchFn - Optional fetch function for HTTP requests (e.g. proxy fetch in browser)
 * @returns Promise resolving to space-separated scope string or undefined
 */
export const discoverScopes = async (
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
  fetchFn?: typeof fetch,
): Promise<string | undefined> => {
  try {
    const metadata = await discoverAuthorizationServerMetadata(
      new URL("/", serverUrl),
      { fetchFn },
    );

    // Prefer resource metadata scopes, but fall back to OAuth metadata if empty
    const resourceScopes = resourceMetadata?.scopes_supported;
    const oauthScopes = metadata?.scopes_supported;

    const scopesSupported =
      resourceScopes && resourceScopes.length > 0
        ? resourceScopes
        : oauthScopes;

    return scopesSupported && scopesSupported.length > 0
      ? scopesSupported.join(" ")
      : undefined;
  } catch (error) {
    return undefined;
  }
};
