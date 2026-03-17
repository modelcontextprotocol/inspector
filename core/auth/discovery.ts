import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Returns the URL to use for OAuth authorization server metadata discovery.
 * Uses resource metadata's authorization_servers[0] when present, otherwise the MCP server URL.
 */
export function getAuthorizationServerUrl(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata | null,
): URL {
  const first = resourceMetadata?.authorization_servers?.[0];
  // Use truthy check to match original state-machine: empty string falls back to serverUrl
  return first ? new URL(first) : new URL("/", serverUrl);
}

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
    const authServerUrl = getAuthorizationServerUrl(
      serverUrl,
      resourceMetadata,
    );
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl, {
      fetchFn,
    });

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
  } catch {
    return undefined;
  }
};
