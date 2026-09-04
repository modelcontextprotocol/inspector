import { getOAuthServerUrl } from "@inspector/core/mcp/config.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

/**
 * The identity a *clear* of stored OAuth state acts on, for a config on its
 * own.
 *
 * Persisted OAuth state is keyed by the server URL, and `core/mcp/serverList`
 * enforces no URL uniqueness — so two catalog entries with distinct ids can
 * point at one URL and therefore share one credential blob, one live grant and
 * one revocation. Anything that dedupes, locks or compares *clears* has to key
 * on that shared identity rather than on the entry id, which cannot see it
 * (#2217).
 *
 * A config with no OAuth server URL (stdio, and anything else
 * `getOAuthServerUrl` declines) has no shared blob to collide over, so it falls
 * back to the entry id — which keeps every such entry distinct from every
 * other, rather than collapsing them all onto one shared key.
 */
export function oauthClearKey(config: MCPServerConfig, id: string): string {
  const url = getOAuthServerUrl(config);
  // Prefixed so a URL-keyed entry can never collide with an id-keyed one.
  return url !== undefined ? `url:${url}` : `id:${id}`;
}

/** What a clear is being asked to do, relative to the live session. */
export interface OAuthClearIdentityInput {
  /** The catalog entry whose OAuth state the user asked to clear. */
  server: { id: string; config: MCPServerConfig };
  activeServerId: string | undefined;
  /**
   * The config the **live** `InspectorClient` was built with
   * (`getTransportConfig()`), when there is one.
   *
   * This — not the catalog entry — is what the session's credentials are keyed
   * under. A card can be edited while connected and the catalog write does not
   * rebuild the client, so after A connects to X and is edited to Y, the live
   * client still authorizes against X while the entry reads Y (Copilot).
   */
  activeClientConfig: MCPServerConfig | undefined;
  /** The active entry's catalog config, used only when there is no client. */
  activeEntryConfig: MCPServerConfig | undefined;
}

export interface OAuthClearIdentity {
  /** The cleared entry *is* the active one. */
  isActive: boolean;
  /** A different entry, whose OAuth state the live session is using. */
  sharesActiveOAuthKey: boolean;
  /** Either of the above: the active session's credentials are being destroyed. */
  affectsActiveSession: boolean;
  /**
   * The identity to lock an in-flight clear on. Names the storage operation
   * that will actually be performed — for anything touching the live session
   * that is the client's key, which is not necessarily the entry's own.
   */
  inFlightKey: string;
}

/**
 * Resolve who a clear affects and what it locks, from one place.
 *
 * Both consumers need the same answer and would otherwise each re-derive it:
 * `useOAuthRecovery` to decide whether to route through the live client and
 * disconnect, and `App`'s `runClear` to dedupe concurrent clears. Two copies of
 * this rule that disagree is exactly the class of bug #2217 is.
 */
export function resolveOAuthClearIdentity({
  server,
  activeServerId,
  activeClientConfig,
  activeEntryConfig,
}: OAuthClearIdentityInput): OAuthClearIdentity {
  const isActive = activeServerId !== undefined && server.id === activeServerId;
  // Client first: the entry is mutable, the built client is not.
  const activeConfig = activeClientConfig ?? activeEntryConfig;
  const activeKey = activeConfig ? getOAuthServerUrl(activeConfig) : undefined;
  const clearedKey = getOAuthServerUrl(server.config);
  const sharesActiveOAuthKey =
    !isActive && clearedKey !== undefined && clearedKey === activeKey;
  const affectsActiveSession = isActive || sharesActiveOAuthKey;
  return {
    isActive,
    sharesActiveOAuthKey,
    affectsActiveSession,
    inFlightKey:
      affectsActiveSession && activeKey !== undefined
        ? `url:${activeKey}`
        : oauthClearKey(server.config, server.id),
  };
}
