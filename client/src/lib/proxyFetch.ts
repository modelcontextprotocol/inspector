import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import { InspectorConfig } from "./configurationTypes";
import {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  registerClient as sdkRegisterClient,
  exchangeAuthorization as sdkExchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";

/**
 * Fetches a URL through the Inspector proxy server to bypass CORS restrictions.
 * This is particularly useful for OAuth well-known endpoints that don't have CORS configured.
 *
 * @param url - The URL to fetch through the proxy
 * @param config - The Inspector configuration containing proxy settings
 * @param options - Optional fetch options (method, body, headers)
 * @returns Promise resolving to the response
 */
export async function fetchThroughProxy(
  url: string,
  config: InspectorConfig,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const { token: proxyAuthToken, header: proxyAuthTokenHeader } =
    getMCPProxyAuthToken(config);

  if (!proxyAuthToken) {
    // If no proxy token, fall back to direct fetch
    // This maintains backward compatibility for non-proxy mode
    const fetchOptions: RequestInit = {
      method: options?.method || "GET",
      headers: options?.headers,
    };
    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }
    return fetch(url, fetchOptions);
  }

  const proxyServerUrl = getMCPProxyAddress(config);
  const proxyUrl = new URL("/proxy", proxyServerUrl);
  proxyUrl.searchParams.set("url", url);

  const headers: Record<string, string> = {
    [proxyAuthTokenHeader]: `Bearer ${proxyAuthToken}`,
  };

  // Add any additional headers from options
  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  const fetchOptions: RequestInit = {
    method: options?.method || "GET",
    headers,
  };

  // Include body for POST/PUT/PATCH requests
  if (options?.body) {
    // If body is already a string (e.g., form-encoded), use it as-is
    // Otherwise, JSON.stringify it
    if (typeof options.body === "string") {
      fetchOptions.body = options.body;
      console.log(
        "[fetchThroughProxy] Using body as-is (string):",
        fetchOptions.body,
      );
    } else {
      fetchOptions.body = JSON.stringify(options.body);
      console.log("[fetchThroughProxy] Stringified body:", fetchOptions.body);
    }
  }

  console.log("[fetchThroughProxy] Proxy URL:", proxyUrl.toString());
  console.log("[fetchThroughProxy] Fetch options:", fetchOptions);

  const response = await fetch(proxyUrl.toString(), fetchOptions);

  console.log("[fetchThroughProxy] Response status:", response.status);
  const responseText = await response.text();
  console.log("[fetchThroughProxy] Response body:", responseText);

  // Create a new response with the same properties
  return new Response(responseText, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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

/**
 * Registers an OAuth client through the proxy.
 * This wraps the SDK's registerClient function and routes it through the proxy
 * to bypass CORS restrictions.
 *
 * @param authorizationServerUrl - The URL of the authorization server
 * @param params - Parameters for client registration
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to client information
 */
export async function registerClientThroughProxy(
  authorizationServerUrl: string | URL,
  params: {
    metadata?: AuthorizationServerMetadata;
    clientMetadata: OAuthClientMetadata;
  },
  config: InspectorConfig,
): Promise<OAuthClientInformationFull> {
  const { token: proxyAuthToken } = getMCPProxyAuthToken(config);

  console.log(
    "[registerClientThroughProxy] Server URL:",
    authorizationServerUrl,
  );
  console.log(
    "[registerClientThroughProxy] Client metadata:",
    params.clientMetadata,
  );
  console.log("[registerClientThroughProxy] Using proxy:", !!proxyAuthToken);

  // Create a custom fetch function that uses the proxy
  const proxyFetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();

    console.log("[registerClientThroughProxy/proxyFetchFn] URL:", url);
    console.log(
      "[registerClientThroughProxy/proxyFetchFn] Method:",
      init?.method,
    );
    console.log(
      "[registerClientThroughProxy/proxyFetchFn] Body type:",
      typeof init?.body,
    );
    console.log(
      "[registerClientThroughProxy/proxyFetchFn] Body value:",
      init?.body,
    );
    console.log(
      "[registerClientThroughProxy/proxyFetchFn] Headers:",
      init?.headers,
    );

    // Extract method, headers, and body from RequestInit
    const method = init?.method || "POST";
    const headers: Record<string, string> = {};

    // Extract headers - init.headers can be Headers object, array, or plain object
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        // Headers object - iterate to extract
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
        console.log(
          "[registerClientThroughProxy/proxyFetchFn] Extracted headers from Headers object:",
          headers,
        );
      } else if (Array.isArray(init.headers)) {
        // Array of [key, value] tuples
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        // Plain object
        Object.assign(headers, init.headers);
      }
    }

    // Extract and convert body
    let body: unknown = undefined;

    if (init?.body) {
      if (typeof init.body === "string") {
        try {
          // If it's a JSON string, parse it to an object
          body = JSON.parse(init.body);
          console.log(
            "[registerClientThroughProxy/proxyFetchFn] Parsed body:",
            body,
          );
        } catch {
          // If parsing fails, it might be form-encoded, keep as string
          body = init.body;
          console.log(
            "[registerClientThroughProxy/proxyFetchFn] Using body as-is (parse failed):",
            body,
          );
        }
      } else {
        // If it's already an object or other type, use it directly
        body = init.body;
        console.log(
          "[registerClientThroughProxy/proxyFetchFn] Using body as-is (not string):",
          body,
        );
      }
    }

    return fetchThroughProxy(url, config, {
      method,
      body,
      headers,
    });
  };

  // If no proxy token, use direct SDK call (fallback)
  if (!proxyAuthToken) {
    return sdkRegisterClient(authorizationServerUrl, params);
  }

  // Call SDK function with custom fetch that routes through proxy
  return sdkRegisterClient(authorizationServerUrl, {
    ...params,
    fetchFn: proxyFetchFn,
  });
}

/**
 * Exchanges an authorization code for tokens through the proxy.
 * This wraps the SDK's exchangeAuthorization function and routes it through the proxy
 * to bypass CORS restrictions.
 *
 * @param authorizationServerUrl - The URL of the authorization server
 * @param params - Parameters for token exchange
 * @param config - The Inspector configuration containing proxy settings
 * @returns Promise resolving to OAuth tokens
 */
export async function exchangeAuthorizationThroughProxy(
  authorizationServerUrl: string | URL,
  params: {
    metadata?: AuthorizationServerMetadata;
    clientInformation: OAuthClientInformation;
    authorizationCode: string;
    codeVerifier: string;
    redirectUri: string | URL;
    resource?: string | URL;
    addClientAuthentication?: (
      request: Request,
      clientInformation: OAuthClientInformation,
    ) => void | Promise<void>;
  },
  config: InspectorConfig,
): Promise<OAuthTokens> {
  const { token: proxyAuthToken } = getMCPProxyAuthToken(config);

  // Create a custom fetch function that uses the proxy
  const proxyFetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();

    console.log("[exchangeAuthorizationThroughProxy/proxyFetchFn] URL:", url);
    console.log(
      "[exchangeAuthorizationThroughProxy/proxyFetchFn] Method:",
      init?.method,
    );
    console.log(
      "[exchangeAuthorizationThroughProxy/proxyFetchFn] Body type:",
      typeof init?.body,
    );
    console.log(
      "[exchangeAuthorizationThroughProxy/proxyFetchFn] Body value:",
      init?.body,
    );
    console.log(
      "[exchangeAuthorizationThroughProxy/proxyFetchFn] Headers:",
      init?.headers,
    );

    // Extract method, headers, and body from RequestInit
    const method = init?.method || "POST";
    const headers: Record<string, string> = {};

    // Extract headers - init.headers can be Headers object, array, or plain object
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        // Headers object - iterate to extract
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
        console.log(
          "[exchangeAuthorizationThroughProxy/proxyFetchFn] Extracted headers from Headers object:",
          headers,
        );
      } else if (Array.isArray(init.headers)) {
        // Array of [key, value] tuples
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        // Plain object
        Object.assign(headers, init.headers);
      }
    }

    // Extract and convert body
    let body: unknown = undefined;
    let isFormEncoded = false;

    if (init?.body) {
      if (typeof init.body === "string") {
        try {
          // If it's a JSON string, parse it to an object
          body = JSON.parse(init.body);
          console.log(
            "[exchangeAuthorizationThroughProxy/proxyFetchFn] Parsed body:",
            body,
          );
        } catch {
          // If parsing fails, it might be form-encoded, keep as string
          body = init.body;
          isFormEncoded = true;
          console.log(
            "[exchangeAuthorizationThroughProxy/proxyFetchFn] Using body as-is (parse failed):",
            body,
          );
        }
      } else if (init.body instanceof URLSearchParams) {
        // If it's URLSearchParams, convert to string (form-encoded format)
        // The SDK already added client_id/client_secret to this URLSearchParams
        body = init.body.toString();
        isFormEncoded = true;
        console.log(
          "[exchangeAuthorizationThroughProxy/proxyFetchFn] URLSearchParams to string:",
          body,
        );
        console.log(
          "[exchangeAuthorizationThroughProxy/proxyFetchFn] URLSearchParams size:",
          init.body.size,
        );
        // Log each parameter for debugging
        init.body.forEach((value, key) => {
          console.log(
            `[exchangeAuthorizationThroughProxy/proxyFetchFn]   ${key}=${value}`,
          );
        });
      } else {
        // If it's another type of object, use it directly
        body = init.body;
        console.log(
          "[exchangeAuthorizationThroughProxy/proxyFetchFn] Using body as-is (not string):",
          body,
        );
      }
    } else {
      console.log(
        "[exchangeAuthorizationThroughProxy/proxyFetchFn] NO BODY PROVIDED!",
      );
    }

    // Ensure Content-Type is set for form-encoded data
    if (isFormEncoded && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      console.log(
        "[exchangeAuthorizationThroughProxy/proxyFetchFn] Set Content-Type to form-urlencoded",
      );
    }

    return fetchThroughProxy(url, config, {
      method,
      body,
      headers,
    });
  };

  // Convert resource to URL if it's a string
  const resource = params.resource
    ? typeof params.resource === "string"
      ? new URL(params.resource)
      : params.resource
    : undefined;

  // If no proxy token, use direct SDK call (fallback)
  if (!proxyAuthToken) {
    return sdkExchangeAuthorization(authorizationServerUrl, {
      metadata: params.metadata,
      clientInformation: params.clientInformation,
      authorizationCode: params.authorizationCode,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
      resource,
    });
  }

  // Call SDK function with custom fetch that routes through proxy
  return sdkExchangeAuthorization(authorizationServerUrl, {
    metadata: params.metadata,
    clientInformation: params.clientInformation,
    authorizationCode: params.authorizationCode,
    codeVerifier: params.codeVerifier,
    redirectUri: params.redirectUri,
    resource,
    fetchFn: proxyFetchFn,
  });
}
