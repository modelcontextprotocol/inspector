import {
  clearAndPlanRevocation,
  executeOAuthRevocation,
  type TokenRevocationOutcome,
} from "@inspector/core/auth/revocation.js";
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
  /**
   * Whether to revoke the grant at the authorization server (RFC 7009, #2144).
   * Defaults to on. Two callers turn it off: a server whose settings
   * opted out, and `lost_authorization_state` recovery — that path clears a
   * half-finished flow in order to retry it, so there is no completed grant to
   * revoke and the request would be noise at best.
   */
  revoke?: boolean;
  /**
   * Fetch used for the revocation POST when this server is **not** the active
   * connection (there is no live client to borrow one from). In the browser
   * this must be the backend-proxied fetch the OAuth flow itself uses —
   * `globalThis.fetch` would put the request on the page's origin, where an
   * authorization server that serves no CORS headers rejects it. Omitting it
   * skips revocation on that path rather than sending a request that cannot
   * work.
   */
  fetchFn?: typeof fetch;
}

export interface ClearServerOAuthStateResult {
  /** False when the config has no OAuth server URL — nothing was cleared. */
  cleared: boolean;
  /** What the RFC 7009 leg did. Absent when nothing was cleared. */
  revocation?: TokenRevocationOutcome;
}

/**
 * Clear persisted OAuth state (tokens, DCR/CIMD client id, PKCE, etc.) for an
 * HTTP MCP server, revoking the grant at the authorization server. When
 * clearing the active connection, uses the live client so in-memory flow state
 * is reset too.
 *
 * Revocation is best-effort throughout — an authorization server advertising no
 * `revocation_endpoint` is untouched, and a failure is reported in the result
 * rather than thrown — so the local clear always finishes.
 */
export async function clearServerOAuthState(
  params: ClearServerOAuthStateParams,
): Promise<ClearServerOAuthStateResult> {
  const serverUrl = getOAuthServerUrl(params.config);
  if (!serverUrl) {
    return { cleared: false };
  }

  const revoke = params.revoke !== false;

  if (params.isActiveConnection && params.inspectorClient) {
    const revocation = await params.inspectorClient.clearOAuthTokens({
      revoke,
    });
    return { cleared: true, revocation };
  }

  // No proxied fetch on hand means no request we could usefully make, so the
  // leg is reported as skipped rather than attempted against the page origin.
  const fetchFn = params.fetchFn;
  // Takes the state and deletes it in ONE atomic storage step, then sends. The
  // clear must not wait on the network: this server can be inactive when the
  // call starts and complete a *fresh* authorization while the request is in
  // flight, at which point a later clear would delete the new credentials. The
  // session checks in `useOAuthRecovery` run after this helper returns and
  // cannot protect the store, so the ordering is what does (#2144).
  const plan = await clearAndPlanRevocation({
    serverUrl,
    storage: params.oauthStorage,
    enabled: revoke && fetchFn !== undefined,
  });
  const revocation: TokenRevocationOutcome = fetchFn
    ? await executeOAuthRevocation(plan, { fetchFn })
    : { status: "skipped", reason: "disabled" };
  return { cleared: true, revocation };
}
