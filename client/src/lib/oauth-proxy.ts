/**
 * OAuth Proxy Utilities
 *
 * These functions route OAuth requests through the MCP Inspector proxy server
 * to avoid CORS issues when connectionType is "proxy".
 */

import {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthClientInformation,
  OAuthTokens,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import { InspectorConfig } from "./configurationTypes";

/**
 * Get proxy headers for authentication
 * @param config - Inspector configuration containing proxy authentication settings
 * @returns Headers object with Content-Type and optional Bearer token
 */
function getProxyHeaders(config: InspectorConfig): Record<string, string> {
  const { token, header } = getMCPProxyAuthToken(config);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers[header] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Common helper for proxying fetch requests
 * @param endpoint - The API endpoint path (e.g., "/oauth/metadata")
 * @param method - HTTP method (GET or POST)
 * @param config - Inspector configuration containing proxy settings
 * @param body - Optional request body object
 * @param queryParams - Optional query parameters to append to URL
 * @returns Promise resolving to the typed response
 * @throws Error if the request fails or returns non-ok status
 */
async function proxyFetch<T>(
  endpoint: string,
  method: "GET" | "POST",
  config: InspectorConfig,
  body?: object,
  queryParams?: Record<string, string>,
): Promise<T> {
  const proxyAddress = getMCPProxyAddress(config);
  const url = new URL(endpoint, proxyAddress);

  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: getProxyHeaders(config),
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // Network errors (connection refused, timeout, etc.)
    throw new Error(
      `Network error: ${error instanceof Error ? error.message : "Failed to connect to proxy server"}`,
    );
  }

  if (!response.ok) {
    // Try to get detailed error from response body
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    const errorMessage = errorData.error || response.statusText;
    const errorDetails = errorData.details ? ` - ${errorData.details}` : "";

    // Provide specific error messages based on status code
    switch (response.status) {
      case 400:
        throw new Error(`Bad Request: ${errorMessage}${errorDetails}`);
      case 401:
        throw new Error(
          `Authentication failed: ${errorMessage}. Check your proxy authentication token.`,
        );
      case 403:
        throw new Error(
          `Access forbidden: ${errorMessage}. You may not have permission to access this resource.`,
        );
      case 404:
        throw new Error(
          `Not found: ${errorMessage}. The OAuth endpoint may not exist or be misconfigured.`,
        );
      case 500:
      case 502:
      case 503:
      case 504:
        throw new Error(
          `Server error (${response.status}): ${errorMessage}${errorDetails}`,
        );
      default:
        throw new Error(
          `Request failed (${response.status}): ${errorMessage}${errorDetails}`,
        );
    }
  }

  return await response.json();
}

/**
 * Discover OAuth Authorization Server Metadata via proxy
 * @param authServerUrl - The OAuth authorization server URL
 * @param config - Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth metadata
 * @throws Error if metadata discovery fails
 */
export async function discoverAuthorizationServerMetadataViaProxy(
  authServerUrl: URL,
  config: InspectorConfig,
): Promise<OAuthMetadata> {
  // Construct the well-known URL per RFC 8414
  const pathname = authServerUrl.pathname.endsWith("/")
    ? authServerUrl.pathname.slice(0, -1)
    : authServerUrl.pathname;
  const wellKnownUrl = new URL(
    `/.well-known/oauth-authorization-server${pathname}`,
    authServerUrl,
  );

  try {
    return await proxyFetch<OAuthMetadata>(
      "/oauth/metadata",
      "GET",
      config,
      undefined,
      { url: wellKnownUrl.toString() },
    );
  } catch (error) {
    throw new Error(
      `Failed to discover OAuth metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Discover OAuth Protected Resource Metadata via proxy
 * @param serverUrl - The MCP server URL
 * @param config - Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth protected resource metadata
 * @throws Error if resource metadata discovery fails
 */
export async function discoverOAuthProtectedResourceMetadataViaProxy(
  serverUrl: string,
  config: InspectorConfig,
): Promise<OAuthProtectedResourceMetadata> {
  // Construct the well-known URL per RFC 9728
  const url = new URL(serverUrl);
  const pathname = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const wellKnownUrl = new URL(
    `/.well-known/oauth-protected-resource${pathname}`,
    url,
  );

  try {
    return await proxyFetch<OAuthProtectedResourceMetadata>(
      "/oauth/resource-metadata",
      "GET",
      config,
      undefined,
      { url: wellKnownUrl.toString() },
    );
  } catch (error) {
    throw new Error(
      `Failed to discover resource metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Register OAuth client via proxy (Dynamic Client Registration)
 * @param registrationEndpoint - The OAuth client registration endpoint URL
 * @param clientMetadata - OAuth client metadata for registration
 * @param config - Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth client information
 * @throws Error if client registration fails
 */
export async function registerClientViaProxy(
  registrationEndpoint: string,
  clientMetadata: OAuthClientMetadata,
  config: InspectorConfig,
): Promise<OAuthClientInformation> {
  try {
    return await proxyFetch<OAuthClientInformation>(
      "/oauth/register",
      "POST",
      config,
      { registrationEndpoint, clientMetadata },
    );
  } catch (error) {
    throw new Error(
      `Failed to register client: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Exchange authorization code for tokens via proxy
 * @param tokenEndpoint - The OAuth token endpoint URL
 * @param params - Token exchange parameters (code, client_id, etc.)
 * @param config - Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth tokens
 * @throws Error if token exchange fails
 */
export async function exchangeAuthorizationViaProxy(
  tokenEndpoint: string,
  params: Record<string, string>,
  config: InspectorConfig,
): Promise<OAuthTokens> {
  try {
    return await proxyFetch<OAuthTokens>("/oauth/token", "POST", config, {
      tokenEndpoint,
      params,
    });
  } catch (error) {
    throw new Error(
      `Failed to exchange authorization code: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
