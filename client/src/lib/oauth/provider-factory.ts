/**
 * OAuth Provider Factory
 * Creates the appropriate OAuth provider based on the selected mode
 */
import { OAuthProvider } from "./provider-interface";
import { DirectOAuthProvider } from "./direct-provider";
import { ProxyOAuthProvider } from "./proxy-provider";
import { SESSION_KEYS, getServerSpecificKey } from "../constants";

export type OAuthMode = "direct" | "proxy";

/**
 * Get the OAuth mode for a specific server from sessionStorage
 */
export function getOAuthMode(serverUrl?: string): OAuthMode {
  const key = getServerSpecificKey(SESSION_KEYS.OAUTH_MODE, serverUrl);
  const mode = sessionStorage.getItem(key);
  return (mode as OAuthMode) || "direct"; // Default to direct for backward compatibility
}

/**
 * Set the OAuth mode for a specific server in sessionStorage
 */
export function setOAuthMode(mode: OAuthMode, serverUrl?: string): void {
  const key = getServerSpecificKey(SESSION_KEYS.OAUTH_MODE, serverUrl);
  sessionStorage.setItem(key, mode);
}

/**
 * Create an OAuth provider based on the selected mode
 */
export function createOAuthProvider(
  mode: OAuthMode,
  proxyBaseUrl?: string,
  proxyAuthToken?: string,
): OAuthProvider {
  if (mode === "proxy") {
    return new ProxyOAuthProvider(proxyBaseUrl, proxyAuthToken);
  }

  return new DirectOAuthProvider();
}

/**
 * Create an OAuth provider for a specific server
 * Reads the mode from sessionStorage
 */
export function createOAuthProviderForServer(
  serverUrl?: string,
  proxyBaseUrl?: string,
  proxyAuthToken?: string,
): OAuthProvider {
  const mode = getOAuthMode(serverUrl);
  return createOAuthProvider(mode, proxyBaseUrl, proxyAuthToken);
}
