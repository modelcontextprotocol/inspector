/**
 * OAuth discovery endpoint handlers
 * Uses the MCP SDK's discovery functions which provide schema validation and proper error handling
 */
import {
  discoverOAuthProtectedResourceMetadata as sdkDiscoverResourceMetadata,
  discoverAuthorizationServerMetadata as sdkDiscoverAuthServerMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  DiscoveryResult,
  OAuthProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OAuthMetadata,
} from "./types.js";

/**
 * Discover OAuth protected resource metadata
 * Proxies the .well-known/oauth-protected-resource endpoint with Zod schema validation
 */
export async function discoverResourceMetadata(
  serverUrl: string,
): Promise<OAuthProtectedResourceMetadata | null> {
  try {
    const metadata = await sdkDiscoverResourceMetadata(serverUrl);
    return metadata || null;
  } catch (error) {
    console.warn("Error discovering resource metadata:", error);
    return null;
  }
}

/**
 * Discover OAuth authorization server metadata
 * Uses SDK's discovery which tries RFC 8414 OAuth metadata first, then falls back to OpenID Connect Discovery
 */
export async function discoverAuthServerMetadata(
  authServerUrl: string,
): Promise<AuthorizationServerMetadata> {
  const metadata = await sdkDiscoverAuthServerMetadata(authServerUrl);

  if (!metadata) {
    throw new Error(
      `Failed to discover authorization server metadata for ${authServerUrl}`,
    );
  }

  return metadata;
}

/**
 * Full discovery flow combining resource and auth server metadata
 */
export async function discover(
  serverUrl: string,
  provider?: string,
): Promise<DiscoveryResult> {
  // First try to discover resource metadata
  const resourceMetadata = await discoverResourceMetadata(serverUrl);

  // Determine auth server URL
  let authServerUrl = new URL("/", serverUrl);
  if (resourceMetadata?.authorization_servers?.length) {
    authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
  }

  // Discover auth server metadata
  const authServerMetadata = await discoverAuthServerMetadata(
    authServerUrl.toString(),
  );

  return {
    resourceMetadata,
    authServerMetadata,
    resourceUrl: resourceMetadata?.resource,
  };
}

/**
 * Resolves scopes from resource metadata and OAuth server metadata.
 * Prefers resource metadata scopes, falls back to OAuth metadata scopes.
 */
function resolveScopes(
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

/**
 * Discover OAuth scopes from server metadata
 * Prefers resource metadata scopes over authorization server scopes
 */
export async function discoverScopes(
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
): Promise<string | undefined> {
  try {
    // Determine auth server URL from resource metadata or default to root
    let authServerUrl = new URL("/", serverUrl);
    if (resourceMetadata?.authorization_servers?.length) {
      authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
    }

    const authServerMetadata = await discoverAuthServerMetadata(
      authServerUrl.toString(),
    );

    return resolveScopes(resourceMetadata, authServerMetadata);
  } catch (error) {
    console.debug("OAuth scope discovery failed:", error);
    return undefined;
  }
}
