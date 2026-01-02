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
 * Discover OAuth Authorization Server Metadata via proxy
 */
export async function discoverAuthorizationServerMetadataViaProxy(
  authServerUrl: URL,
  config: InspectorConfig,
): Promise<OAuthMetadata> {
  const proxyAddress = getMCPProxyAddress(config);
  const url = new URL("/oauth/metadata", proxyAddress);
  url.searchParams.set("authServerUrl", authServerUrl.toString());

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getProxyHeaders(config),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      `Failed to discover OAuth metadata: ${error.error || response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Discover OAuth Protected Resource Metadata via proxy
 */
export async function discoverOAuthProtectedResourceMetadataViaProxy(
  serverUrl: string,
  config: InspectorConfig,
): Promise<OAuthProtectedResourceMetadata> {
  const proxyAddress = getMCPProxyAddress(config);
  const url = new URL("/oauth/resource-metadata", proxyAddress);
  url.searchParams.set("serverUrl", serverUrl);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getProxyHeaders(config),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      `Failed to discover resource metadata: ${error.error || response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Register OAuth client via proxy (Dynamic Client Registration)
 */
export async function registerClientViaProxy(
  registrationEndpoint: string,
  clientMetadata: OAuthClientMetadata,
  config: InspectorConfig,
): Promise<OAuthClientInformation> {
  const proxyAddress = getMCPProxyAddress(config);
  const url = new URL("/oauth/register", proxyAddress);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getProxyHeaders(config),
    body: JSON.stringify({
      registrationEndpoint,
      clientMetadata,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      `Failed to register client: ${error.error || response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Exchange authorization code for tokens via proxy
 */
export async function exchangeAuthorizationViaProxy(
  tokenEndpoint: string,
  params: Record<string, string>,
  config: InspectorConfig,
): Promise<OAuthTokens> {
  const proxyAddress = getMCPProxyAddress(config);
  const url = new URL("/oauth/token", proxyAddress);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getProxyHeaders(config),
    body: JSON.stringify({
      tokenEndpoint,
      params,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      `Failed to exchange authorization code: ${error.error || response.statusText}`,
    );
  }

  return await response.json();
}
