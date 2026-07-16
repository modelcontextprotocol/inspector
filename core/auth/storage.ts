import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type { OAuthClientRegistrationKind } from "./types.js";

/**
 * Abstract storage interface for OAuth state
 * Supports browser (sessionStorage), Node.js (file), and remote HTTP backends.
 */
export interface SaveTokensOptions {
  /** Marks resource tokens minted via EMA (legs 2–3) for sign-out cleanup. */
  enterpriseManaged?: boolean;
  /**
   * Authorization-server `issuer` these tokens are bound to (SEP-2352). When set,
   * tokens are keyed under `(server, issuer)`; when omitted (EMA / legacy callers)
   * they write the per-server fallback slot.
   */
  issuer?: string;
}

export type { OAuthClientRegistrationKind };

export interface SaveClientInformationOptions {
  registrationKind: "dcr" | "cimd";
  /**
   * Authorization-server `issuer` this client registration is bound to (SEP-2352).
   * Client identifiers are unique to the AS that issued them (RFC 6749 §2.2).
   */
  issuer?: string;
}

export interface OAuthStorage {
  /**
   * Optional preload of persisted state into memory. Getters and setters load
   * automatically when needed; use this only for fail-fast at known boundaries
   * (e.g. OAuth callback resume after a full-page navigation).
   */
  load(): Promise<void>;

  /**
   * Get client information (preregistered or dynamically registered).
   *
   * @param issuer - When set, return the registration bound to this AS `issuer`
   *   (SEP-2352). When omitted, return the active-issuer slot, falling back to
   *   the legacy unkeyed entry.
   */
  getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
    issuer?: string,
  ): Promise<OAuthClientInformation | undefined>;

  /**
   * Get how the dynamic client registration slot was established.
   */
  getClientRegistrationKind(
    serverUrl: string,
    issuer?: string,
  ): Promise<OAuthClientRegistrationKind | undefined>;

  /**
   * Save client information (dynamically registered)
   */
  saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
    options: SaveClientInformationOptions,
  ): Promise<void>;

  /**
   * Save preregistered client information (static client from config)
   */
  savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void>;

  /**
   * Clear client information. When `issuer` is set, clear only that AS's
   * registration; when omitted, clear every issuer's registration plus the
   * legacy unkeyed entry.
   */
  clearClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
    issuer?: string,
  ): Promise<void>;

  /**
   * Get OAuth tokens. When `issuer` is set, return that AS's tokens (SEP-2352);
   * when omitted, return the active-issuer tokens, falling back to the legacy
   * unkeyed entry (the transport's per-request bearer read).
   */
  getTokens(
    serverUrl: string,
    issuer?: string,
  ): Promise<OAuthTokens | undefined>;

  /**
   * Save OAuth tokens
   */
  saveTokens(
    serverUrl: string,
    tokens: OAuthTokens,
    options?: SaveTokensOptions,
  ): Promise<void>;

  /**
   * Clear OAuth tokens. When `issuer` is set, clear only that AS's tokens; when
   * omitted, clear every issuer's tokens plus the legacy unkeyed entry.
   */
  clearTokens(serverUrl: string, issuer?: string): Promise<void>;

  /**
   * Get code verifier (for PKCE)
   */
  getCodeVerifier(serverUrl: string): Promise<string | undefined>;

  /**
   * Save code verifier (for PKCE)
   */
  saveCodeVerifier(serverUrl: string, codeVerifier: string): Promise<void>;

  /**
   * Clear code verifier
   */
  clearCodeVerifier(serverUrl: string): Promise<void>;

  /**
   * Get scope
   */
  getScope(serverUrl: string): Promise<string | undefined>;

  /**
   * Save scope
   */
  saveScope(serverUrl: string, scope: string | undefined): Promise<void>;

  /**
   * Clear scope
   */
  clearScope(serverUrl: string): Promise<void>;

  /**
   * Get server metadata discovered during OAuth
   */
  getServerMetadata(serverUrl: string): Promise<OAuthMetadata | null>;

  /**
   * Save server metadata discovered during OAuth
   */
  saveServerMetadata(serverUrl: string, metadata: OAuthMetadata): Promise<void>;

  /**
   * Clear server metadata
   */
  clearServerMetadata(serverUrl: string): Promise<void>;

  /**
   * Get the cached RFC 9728/8414 discovery state (SEP-2352). The SDK restores it
   * to skip re-discovery and, on the authorization-code callback leg, to bind the
   * exchange to the AS that minted the code (`AuthorizationServerMismatchError`).
   */
  getDiscoveryState(
    serverUrl: string,
  ): Promise<OAuthDiscoveryState | undefined>;

  /**
   * Save the RFC 9728/8414 discovery state. Persisted alongside the code verifier
   * so it survives the authorization redirect round-trip.
   */
  saveDiscoveryState(
    serverUrl: string,
    state: OAuthDiscoveryState,
  ): Promise<void>;

  /**
   * Clear the cached discovery state (SDK `invalidateCredentials('discovery')`).
   */
  clearDiscoveryState(serverUrl: string): Promise<void>;

  /**
   * Clear all OAuth data for a server
   */
  clear(serverUrl: string): Promise<void>;

  /**
   * Get cached IdP OIDC session for EMA (keyed by issuer).
   */
  getIdpSession(issuer: string): Promise<IdpSessionState | undefined>;

  /**
   * Save IdP OIDC session fields for EMA.
   */
  saveIdpSession(
    issuer: string,
    session: Partial<IdpSessionState>,
  ): Promise<void>;

  /**
   * Clear cached IdP session for an issuer.
   */
  clearIdpSession(issuer: string): Promise<void>;

  /**
   * Remove per-server OAuth state for MCP servers whose tokens were minted via EMA.
   */
  clearEnterpriseManagedResourceServers(): Promise<void>;
}

/**
 * Cached IdP OIDC session for EMA leg 1.
 */
export interface IdpSessionState {
  idToken?: string;
  refreshToken?: string;
  /** Epoch ms when the ID Token expires (when known). */
  idTokenExpiresAt?: number;
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
