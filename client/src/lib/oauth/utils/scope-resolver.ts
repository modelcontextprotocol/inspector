/**
 * Shared utility for resolving OAuth scopes from metadata
 */
import {
  OAuthProtectedResourceMetadata,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Resolves scopes from resource metadata and OAuth server metadata.
 * Prefers resource metadata scopes, falls back to OAuth metadata scopes.
 *
 * @param resourceMetadata - Optional protected resource metadata
 * @param authServerMetadata - OAuth authorization server metadata
 * @returns Space-separated scope string, or undefined if no scopes found
 */
export function resolveScopes(
  resourceMetadata: OAuthProtectedResourceMetadata | undefined,
  authServerMetadata: OAuthMetadata | undefined,
): string | undefined {
  const resourceScopes = resourceMetadata?.scopes_supported;
  const oauthScopes = authServerMetadata?.scopes_supported;

  const scopesSupported =
    resourceScopes && resourceScopes.length > 0 ? resourceScopes : oauthScopes;

  return scopesSupported && scopesSupported.length > 0
    ? scopesSupported.join(" ")
    : undefined;
}
