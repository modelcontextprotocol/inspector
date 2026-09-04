import { getOAuthServerUrl } from "@inspector/core/mcp/config.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

/**
 * The identity a *clear* of stored OAuth state acts on.
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
