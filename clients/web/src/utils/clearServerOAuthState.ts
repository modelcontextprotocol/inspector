import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { getOAuthServerUrl } from "@inspector/core/mcp/config.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

export interface ClearServerOAuthStateParams {
  config: MCPServerConfig;
  /** When set and this server is the active connection, clear via the live client. */
  inspectorClient?: Pick<InspectorClient, "clearOAuthTokens"> | null;
  isActiveConnection: boolean;
  /** Shared web OAuth store; required so clear hits the same blob as connect. */
  oauthStorage: OAuthStorage;
}

/**
 * Clear persisted OAuth state (tokens, DCR/CIMD client id, PKCE, etc.) for an
 * HTTP MCP server. When clearing the active connection, uses the live client so
 * in-memory flow state is reset too.
 */
export async function clearServerOAuthState(
  params: ClearServerOAuthStateParams,
): Promise<boolean> {
  const serverUrl = getOAuthServerUrl(params.config);
  if (!serverUrl) {
    return false;
  }

  if (params.isActiveConnection && params.inspectorClient) {
    await params.inspectorClient.clearOAuthTokens();
  } else {
    await params.oauthStorage.clear(serverUrl);
  }
  return true;
}
