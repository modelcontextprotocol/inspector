/**
 * Direct OAuth Provider - Uses MCP SDK directly (browser-based)
 *
 * ## Purpose of the Provider Abstraction
 *
 * The OAuthProvider interface allows the Inspector client to switch between two OAuth strategies:
 *
 * 1. **DirectOAuthProvider** (this file): Makes OAuth requests directly from the browser to the
 *    authorization server using the MCP SDK. This is the standard OAuth flow but may encounter
 *    CORS issues when the auth server doesn't allow browser requests.
 *
 * 2. **ProxyOAuthProvider**: Routes OAuth requests through the Inspector's backend server to
 *    avoid CORS issues. The backend acts as a proxy to the authorization server.
 *
 * ## Benefits of the Abstraction
 *
 * - **Flexibility**: Users can choose between direct and proxy modes based on their needs
 * - **Fallback**: If direct mode fails due to CORS, can switch to proxy mode
 * - **Testability**: Each provider can be tested independently
 * - **Type Safety**: Both providers implement the same interface
 *
 * ## Implementation Notes
 *
 * This provider is essentially a thin wrapper around the MCP SDK's auth functions. While it may
 * seem redundant, it serves these purposes:
 * - Provides a consistent interface with ProxyOAuthProvider
 * - Handles parameter mapping from the provider interface to SDK functions
 * - Adds error handling specific to the Inspector's needs
 * - Allows for future customization without changing the SDK
 *
 * ## Refactoring Considerations
 *
 * If the abstraction proves unnecessary (i.e., if proxy mode is always used or if the wrapper
 * adds no value), consider:
 * - Using the SDK directly in the client code
 * - Keeping only ProxyOAuthProvider for CORS-free operation
 * - Simplifying the interface to remove redundant parameter mapping
 */
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient as sdkRegisterClient,
  startAuthorization as sdkStartAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { resolveScopes } from "./utils/scope-resolver.js";
import { extractClientSecret } from "./utils/client-helpers.js";
import {
  OAuthProvider,
  DiscoveryResult,
  RegisterClientParams,
  AuthorizationParams,
  AuthorizationResult,
  ExchangeParams,
  RefreshParams,
} from "./provider-interface";

/**
 * DirectOAuthProvider - Uses MCP SDK directly from the browser
 * This is the existing implementation, may encounter CORS issues
 */
export class DirectOAuthProvider implements OAuthProvider {
  async discover(serverUrl: string): Promise<DiscoveryResult> {
    // Default to discovering from the server's URL
    let authServerUrl = new URL("/", serverUrl);
    let resourceMetadata = null;

    try {
      resourceMetadata =
        await discoverOAuthProtectedResourceMetadata(serverUrl);
      if (resourceMetadata?.authorization_servers?.length) {
        authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
      }
    } catch (e) {
      console.warn("Failed to discover resource metadata:", e);
    }

    const metadata = await discoverAuthorizationServerMetadata(authServerUrl);
    if (!metadata) {
      throw new Error("Failed to discover OAuth metadata");
    }

    const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);

    return {
      resourceMetadata,
      authServerMetadata: parsedMetadata,
      resourceUrl: resourceMetadata?.resource,
    };
  }

  async discoverScopes(
    serverUrl: string,
    resourceMetadata?: OAuthProtectedResourceMetadata,
  ): Promise<string | undefined> {
    try {
      const metadata = await discoverAuthorizationServerMetadata(
        new URL("/", serverUrl),
      );

      return resolveScopes(resourceMetadata, metadata);
    } catch (error) {
      console.debug("OAuth scope discovery failed:", error);
      return undefined;
    }
  }

  async registerClient(
    params: RegisterClientParams,
  ): Promise<OAuthClientInformationFull | OAuthClientInformation> {
    // If client credentials are provided, use them (static client)
    if (params.clientId) {
      const clientInfo: OAuthClientInformation = {
        client_id: params.clientId,
      };
      if (params.clientSecret) {
        (clientInfo as OAuthClientInformationFull).client_secret =
          params.clientSecret;
        return clientInfo as OAuthClientInformationFull;
      }
      return clientInfo;
    }

    // Otherwise, use Dynamic Client Registration
    const clientMetadata = params.clientMetadata || {};
    // Ensure redirect_uris is present (required by the SDK)
    const finalMetadata = {
      redirect_uris: [],
      ...clientMetadata,
    };

    const fullInformation = await sdkRegisterClient(params.authServerUrl, {
      metadata: params.metadata,
      clientMetadata: finalMetadata,
    });

    return fullInformation;
  }

  async startAuthorization(
    params: AuthorizationParams,
  ): Promise<AuthorizationResult> {
    const result = await sdkStartAuthorization(params.metadata.issuer, {
      metadata: params.metadata,
      clientInformation: params.clientInformation,
      redirectUrl: params.redirectUrl,
      scope: params.scope,
      state: params.state,
      resource: params.resource,
    });

    return {
      authorizationUrl: result.authorizationUrl,
      codeVerifier: result.codeVerifier,
    };
  }

  async exchangeToken(params: ExchangeParams): Promise<OAuthTokens> {
    const tokens = await exchangeAuthorization(params.metadata.issuer, {
      metadata: params.metadata,
      clientInformation: params.clientInformation,
      authorizationCode: params.authorizationCode,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
      resource: params.resource,
    });

    return tokens;
  }

  async refreshToken(params: RefreshParams): Promise<OAuthTokens> {
    // Note: We don't use the SDK's refreshAuthorization here because:
    // - It requires discovering the token endpoint from the auth server URL, which can cause CORS
    // - We already have the token endpoint in params.metadata
    // - Direct fetch gives us better control and avoids extra network requests

    const formData = new URLSearchParams();
    formData.set("grant_type", "refresh_token");
    formData.set("refresh_token", params.refreshToken);
    formData.set("client_id", params.clientInformation.client_id);

    const clientSecret = extractClientSecret(params.clientInformation);
    if (clientSecret) {
      formData.set("client_secret", clientSecret);
    }

    const response = await fetch(params.metadata.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const tokens = (await response.json()) as OAuthTokens;
    return tokens;
  }
}
