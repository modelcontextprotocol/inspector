/**
 * OAuth Provider Interface - Abstraction for OAuth operations
 */
import {
  OAuthMetadata,
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface DiscoveryResult {
  resourceMetadata: OAuthProtectedResourceMetadata | null;
  authServerMetadata: OAuthMetadata;
  resourceUrl?: string;
}

export interface RegisterClientParams {
  metadata: OAuthMetadata;
  authServerUrl: string;
  clientId?: string;
  clientSecret?: string;
  clientMetadata?: Record<string, unknown>;
}

export interface AuthorizationParams {
  metadata: OAuthMetadata;
  clientInformation: OAuthClientInformationFull | OAuthClientInformation;
  redirectUrl: string;
  scope: string;
  state: string;
  resource?: URL;
}

export interface AuthorizationResult {
  authorizationUrl: URL;
  codeVerifier: string;
}

export interface ExchangeParams {
  metadata: OAuthMetadata;
  clientInformation: OAuthClientInformationFull | OAuthClientInformation;
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  resource?: URL;
}

export interface RefreshParams {
  metadata: OAuthMetadata;
  clientInformation: OAuthClientInformationFull | OAuthClientInformation;
  refreshToken: string;
}

/**
 * OAuthProvider interface - defines methods for OAuth operations
 * Implementations: DirectOAuthProvider (SDK), ProxyOAuthProvider (Backend API)
 */
export interface OAuthProvider {
  /**
   * Discover OAuth metadata from server
   */
  discover(serverUrl: string, provider?: string): Promise<DiscoveryResult>;

  /**
   * Discover OAuth scopes from server metadata
   * Prefers resource metadata scopes over authorization server scopes
   */
  discoverScopes(
    serverUrl: string,
    resourceMetadata?: OAuthProtectedResourceMetadata,
  ): Promise<string | undefined>;

  /**
   * Register client with OAuth server
   */
  registerClient(
    params: RegisterClientParams,
  ): Promise<OAuthClientInformationFull | OAuthClientInformation>;

  /**
   * Start OAuth authorization flow
   */
  startAuthorization(params: AuthorizationParams): Promise<AuthorizationResult>;

  /**
   * Exchange authorization code for tokens
   */
  exchangeToken(params: ExchangeParams): Promise<OAuthTokens>;

  /**
   * Refresh access token
   */
  refreshToken(params: RefreshParams): Promise<OAuthTokens>;
}
