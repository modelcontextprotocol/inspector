import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { getOAuthServerUrl } from "@inspector/core/mcp/config.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

export interface ClearServerOAuthStateParams {
  config: MCPServerConfig;
  /** When set and this server is the active connection, clear via the live client. */
  inspectorClient?: InspectorClient | null;
  isActiveConnection: boolean;
  /**
   * Backend-backed OAuth storage (`RemoteOAuthStorage`) used to clear a
   * non-active server's persisted state. Must be the same shared instance the
   * connection path writes through so the clear targets `oauth.json`, not a
   * divergent sessionStorage copy.
   */
  oauthStorage: Pick<OAuthStorage, "clear">;
}

/**
 * Clear persisted OAuth state (tokens, DCR/CIMD client id, PKCE, etc.) for an
 * HTTP MCP server. When clearing the active connection, uses the live client so
 * in-memory flow state is reset too.
 */
export function clearServerOAuthState(
  params: ClearServerOAuthStateParams,
): boolean {
  const serverUrl = getOAuthServerUrl(params.config);
  if (!serverUrl) {
    return false;
  }

  if (params.isActiveConnection && params.inspectorClient) {
    params.inspectorClient.clearOAuthTokens();
  } else {
    params.oauthStorage.clear(serverUrl);
  }
  return true;
}
