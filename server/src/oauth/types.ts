/**
 * Shared TypeScript types for OAuth implementation
 *
 * Standard OAuth types are imported from the MCP SDK.
 * This file contains only custom types specific to the backend proxy API.
 */

// Import standard OAuth types from MCP SDK
export type {
  OAuthProtectedResourceMetadata,
  OAuthMetadata,
  AuthorizationServerMetadata,
  OAuthTokens,
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthErrorResponse,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// Custom types for backend proxy API requests/responses

export interface DiscoveryRequest {
  serverUrl: string;
  provider?: string;
}

export interface DiscoveryResult {
  resourceMetadata: OAuthProtectedResourceMetadata | null;
  authServerMetadata: AuthorizationServerMetadata;
  resourceUrl?: string;
}

export interface DiscoverScopesRequest {
  serverUrl: string;
  resourceMetadata?: OAuthProtectedResourceMetadata;
}

export interface RegisterClientRequest {
  authServerUrl: string;
  metadata: AuthorizationServerMetadata;
  clientId?: string;
  clientSecret?: string;
  clientMetadata?: OAuthClientMetadata;
}

export interface ClientInfo {
  clientId: string;
  clientSecret?: string;
  isDynamic: boolean;
}

// Re-import these types for backwards compatibility with naming
import type {
  OAuthProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface AuthorizationRequest {
  authServerUrl: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  resource?: string;
}

export interface AuthorizationResult {
  authorizationUrl: string;
  codeVerifier: string;
  state: string;
}

export interface TokenExchangeRequest {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  resource?: string;
}

export interface TokenRefreshRequest {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

export interface UserInfoRequest {
  userInfoEndpoint: string;
  accessToken: string;
}

export interface ValidateIdTokenRequest {
  idToken: string;
  jwksUri: string;
  issuer: string;
  clientId: string;
}
