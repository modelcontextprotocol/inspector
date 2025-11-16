/**
 * Proxy OAuth Provider - Uses backend API (avoids CORS)
 */
import {
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthProvider,
  DiscoveryResult,
  RegisterClientParams,
  AuthorizationParams,
  AuthorizationResult,
  ExchangeParams,
  RefreshParams,
} from "./provider-interface";
import { DEFAULT_MCP_PROXY_LISTEN_PORT } from "../constants";
import { extractClientSecret } from "./utils/client-helpers.js";

/**
 * ProxyOAuthProvider - Makes OAuth requests through the backend proxy
 * This avoids CORS issues by proxying all OAuth requests through the backend
 */
export class ProxyOAuthProvider implements OAuthProvider {
  private proxyBaseUrl: string;
  private proxyAuthToken: string;

  constructor(proxyBaseUrl?: string, proxyAuthToken?: string) {
    // Default to localhost with default port
    this.proxyBaseUrl =
      proxyBaseUrl || `http://localhost:${DEFAULT_MCP_PROXY_LISTEN_PORT}`;
    this.proxyAuthToken = proxyAuthToken || "";
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.proxyAuthToken) {
      headers["x-mcp-proxy-auth"] = `Bearer ${this.proxyAuthToken}`;
    }

    return headers;
  }

  private async fetchFromProxy<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.proxyBaseUrl}/api/oauth/${endpoint}`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Proxy request failed: ${response.status} ${response.statusText} - ${errorData.message || ""}`,
      );
    }

    return (await response.json()) as T;
  }

  async discover(
    serverUrl: string,
    provider?: string,
  ): Promise<DiscoveryResult> {
    return this.fetchFromProxy<DiscoveryResult>("discover", {
      serverUrl,
      provider,
    });
  }

  async discoverScopes(
    serverUrl: string,
    resourceMetadata?: OAuthProtectedResourceMetadata,
  ): Promise<string | undefined> {
    const result = await this.fetchFromProxy<{ scopes?: string }>(
      "discover-scopes",
      {
        serverUrl,
        resourceMetadata,
      },
    );
    return result.scopes;
  }

  async registerClient(
    params: RegisterClientParams,
  ): Promise<OAuthClientInformationFull | OAuthClientInformation> {
    const result = await this.fetchFromProxy<{
      clientId: string;
      clientSecret?: string;
      isDynamic: boolean;
    }>("register-client", {
      authServerUrl: params.authServerUrl,
      metadata: params.metadata,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      clientMetadata: params.clientMetadata,
    });

    if (result.clientSecret) {
      return {
        client_id: result.clientId,
        client_secret: result.clientSecret,
      } as OAuthClientInformationFull;
    }

    return {
      client_id: result.clientId,
    } as OAuthClientInformation;
  }

  async startAuthorization(
    params: AuthorizationParams,
  ): Promise<AuthorizationResult> {
    const result = await this.fetchFromProxy<{
      authorizationUrl: string;
      codeVerifier: string;
      state: string;
    }>("start-authorization", {
      authServerUrl: params.metadata.authorization_endpoint,
      clientId: params.clientInformation.client_id,
      scope: params.scope,
      redirectUri: params.redirectUrl,
      resource: params.resource?.toString(),
    });

    return {
      authorizationUrl: new URL(result.authorizationUrl),
      codeVerifier: result.codeVerifier,
    };
  }

  async exchangeToken(params: ExchangeParams): Promise<OAuthTokens> {
    return this.fetchFromProxy<OAuthTokens>("exchange-token", {
      tokenEndpoint: params.metadata.token_endpoint,
      code: params.authorizationCode,
      codeVerifier: params.codeVerifier,
      clientId: params.clientInformation.client_id,
      clientSecret: extractClientSecret(params.clientInformation),
      redirectUri: params.redirectUri,
      resource: params.resource?.toString(),
    });
  }

  async refreshToken(params: RefreshParams): Promise<OAuthTokens> {
    return this.fetchFromProxy<OAuthTokens>("refresh-token", {
      tokenEndpoint: params.metadata.token_endpoint,
      refreshToken: params.refreshToken,
      clientId: params.clientInformation.client_id,
      clientSecret: extractClientSecret(params.clientInformation),
    });
  }
}
