import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import { InspectorConfig } from "./configurationTypes";
import {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Fetches a URL through the Inspector proxy server to bypass CORS restrictions.
 * This is particularly useful for OAuth well-known endpoints that don't have CORS configured.
 *
 * @param url - The URL to fetch through the proxy
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to the response
 */
export async function fetchThroughProxy(
  url: string,
  config: InspectorConfig,
): Promise<Response> {
  const { token: proxyAuthToken, header: proxyAuthTokenHeader } =
    getMCPProxyAuthToken(config);

  if (!proxyAuthToken) {
    // If no proxy token, fall back to direct fetch
    // This maintains backward compatibility for non-proxy mode
    return fetch(url);
  }

  const proxyServerUrl = getMCPProxyAddress(config);
  const proxyUrl = new URL("/proxy", proxyServerUrl);
  proxyUrl.searchParams.set("url", url);

  const response = await fetch(proxyUrl.toString(), {
    method: "GET",
    headers: {
      [proxyAuthTokenHeader]: `Bearer ${proxyAuthToken}`,
    },
  });

  return response;
}

/**
 * Fetches JSON data through the proxy server.
 * @param url - The URL to fetch
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to the parsed JSON data
 */
export async function fetchJsonThroughProxy<T = unknown>(
  url: string,
  config: InspectorConfig,
): Promise<T> {
  const response = await fetchThroughProxy(url, config);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Discovers OAuth authorization server metadata through the proxy.
 * This fetches the /.well-known/oauth-authorization-server endpoint.
 *
 * @param serverUrl - The base URL of the OAuth server
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth metadata or null if not found
 */
export async function discoverAuthorizationServerMetadataThroughProxy(
  serverUrl: URL | string,
  config: InspectorConfig,
): Promise<OAuthMetadata | null> {
  const baseUrl =
    typeof serverUrl === "string" ? new URL(serverUrl) : serverUrl;
  const wellKnownUrl = new URL(
    "/.well-known/oauth-authorization-server",
    baseUrl,
  );

  try {
    return await fetchJsonThroughProxy<OAuthMetadata>(
      wellKnownUrl.toString(),
      config,
    );
  } catch (error) {
    console.debug(
      "OAuth authorization server metadata discovery failed:",
      error,
    );
    return null;
  }
}

/**
 * Discovers OAuth protected resource metadata through the proxy.
 * This fetches the /.well-known/oauth-protected-resource endpoint.
 *
 * @param serverUrl - The base URL of the protected resource
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to protected resource metadata or null if not found
 */
export async function discoverOAuthProtectedResourceMetadataThroughProxy(
  serverUrl: URL | string,
  config: InspectorConfig,
): Promise<OAuthProtectedResourceMetadata | null> {
  const baseUrl =
    typeof serverUrl === "string" ? new URL(serverUrl) : serverUrl;
  const wellKnownUrl = new URL(
    "/.well-known/oauth-protected-resource",
    baseUrl,
  );

  try {
    return await fetchJsonThroughProxy<OAuthProtectedResourceMetadata>(
      wellKnownUrl.toString(),
      config,
    );
  } catch (error) {
    console.debug("OAuth protected resource metadata discovery failed:", error);
    return null;
  }
}
