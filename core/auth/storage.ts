import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Abstract storage interface for OAuth state
 * Supports both browser (sessionStorage) and Node.js (Zustand) environments
 */
export interface OAuthStorage {
  /**
   * Get client information (preregistered or dynamically registered)
   */
  getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined>;

  /**
   * Save client information (dynamically registered)
   */
  saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void>;

  /**
   * Save preregistered client information (static client from config)
   */
  savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void>;

  /**
   * Clear client information
   */
  clearClientInformation(serverUrl: string, isPreregistered?: boolean): void;

  /**
   * Get OAuth tokens
   */
  getTokens(serverUrl: string): Promise<OAuthTokens | undefined>;

  /**
   * Save OAuth tokens
   */
  saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void>;

  /**
   * Clear OAuth tokens
   */
  clearTokens(serverUrl: string): void;

  /**
   * Get code verifier (for PKCE)
   */
  getCodeVerifier(serverUrl: string): string | undefined;

  /**
   * Save code verifier (for PKCE)
   */
  saveCodeVerifier(serverUrl: string, codeVerifier: string): Promise<void>;

  /**
   * Clear code verifier
   */
  clearCodeVerifier(serverUrl: string): void;

  /**
   * Get scope
   */
  getScope(serverUrl: string): string | undefined;

  /**
   * Save scope
   */
  saveScope(serverUrl: string, scope: string | undefined): Promise<void>;

  /**
   * Clear scope
   */
  clearScope(serverUrl: string): void;

  /**
   * Get server metadata (for guided mode)
   */
  getServerMetadata(serverUrl: string): OAuthMetadata | null;

  /**
   * Save server metadata (for guided mode)
   */
  saveServerMetadata(serverUrl: string, metadata: OAuthMetadata): Promise<void>;

  /**
   * Clear server metadata
   */
  clearServerMetadata(serverUrl: string): void;

  /**
   * Clear all OAuth data for a server
   */
  clear(serverUrl: string): void;
}

/**
 * Generate server-specific storage key
 */
export function getServerSpecificKey(
  baseKey: string,
  serverUrl: string,
): string {
  return `[${serverUrl}] ${baseKey}`;
}

/**
 * Base storage keys for OAuth data
 */
export const OAUTH_STORAGE_KEYS = {
  CODE_VERIFIER: "mcp_code_verifier",
  TOKENS: "mcp_tokens",
  CLIENT_INFORMATION: "mcp_client_information",
  PREREGISTERED_CLIENT_INFORMATION: "mcp_preregistered_client_information",
  SERVER_METADATA: "mcp_server_metadata",
  SCOPE: "mcp_scope",
} as const;
