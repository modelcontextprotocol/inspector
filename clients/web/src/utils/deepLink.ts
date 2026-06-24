import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { normalizeServerUrl } from "@inspector/core/auth/store.js";

/**
 * Parsed deep-link parameters that drive an automated session: the inspector
 * connects to `serverConfig` on load, then (if `openApp` is set) switches to
 * the Apps tab with that tool selected and `appArgs` pre-filled.
 */
export interface DeepLink {
  serverId: string;
  serverConfig: MCPServerConfig;
  openApp?: string;
  appArgs: Record<string, unknown>;
}

/**
 * Stable, URL-safe id for the ad-hoc server entry a deep link creates. Reusing
 * one id (rather than a fresh uuid per load) means a reload reconnects to the
 * same catalog row instead of accumulating duplicates.
 */
export const DEEP_LINK_SERVER_ID = "deep-link";

const ALLOWED_TRANSPORTS = new Set(["http", "sse"]);

function decodeAppArgs(encoded: string | null): Record<string, unknown> {
  if (!encoded) return {};
  // base64url → base64
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let json: string;
  try {
    json = atob(padded);
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Reject any `serverUrl` that is not a well-formed `http:`/`https:` URL. The
 * connect form already accepts arbitrary URLs from the user, so this is not a
 * new capability — but a deep link can be crafted by a third party, and we do
 * not want a click to drive a `javascript:` / `file:` / `data:` value into the
 * connect path.
 *
 * Loopback and private-range hosts are intentionally **not** blocked here:
 * connecting to a locally running MCP server is the inspector's primary
 * development use case, and the manual connect form imposes no such
 * restriction either. The CSRF gate on `autoConnect` (see
 * {@link parseDeepLink}) is what prevents a third-party page from driving a
 * connect the user did not initiate.
 */
function validateServerUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  // Canonicalize via the same normalizer the OAuth store keys on, so a token
  // saved by the web inspector under the deep-link URL is found by the CLI's
  // `--use-stored-auth` lookup (and vice versa) regardless of trailing-slash
  // or host-case differences in how the URL was typed.
  return normalizeServerUrl(url.href);
}

/**
 * Shallow equality for the subset of {@link MCPServerConfig} a deep link can
 * produce. Used by the auto-connect effect to decide whether the persisted
 * `deep-link` catalog row needs updating before connecting — comparing only
 * `url` (the previous behavior) misses a stale `type` (sse↔streamable-http)
 * and would connect with the wrong transport.
 */
export function deepLinkConfigEquals(
  a: MCPServerConfig,
  b: MCPServerConfig,
): boolean {
  if (a.type !== b.type) return false;
  const aUrl = "url" in a ? a.url : undefined;
  const bUrl = "url" in b ? b.url : undefined;
  return aUrl === bUrl;
}

/**
 * Parse the page's query string into a {@link DeepLink}. Returns `undefined`
 * when no deep link is present **or** when the security gate fails.
 *
 * Security gate: `autoConnect` must equal the session's API auth token. The
 * token is per-launch random and only known to whatever started the web server,
 * so a deep link minted by an external page cannot satisfy this check — it
 * defeats the "send a developer a crafted localhost URL" SSRF / auto-invocation
 * vector while keeping the one-URL automated flow (the launcher knows the
 * token, so it can always build a valid link).
 *
 * Carrying the token in the URL is the same exposure surface as the existing
 * `?MCP_INSPECTOR_API_TOKEN=…` query param the launcher banner already prints
 * (see `getAuthToken()` in `App.tsx`): the value is ephemeral (regenerated per
 * launch), the page is loopback-only, and it never crosses to a third-party
 * referer because the inspector's own backend serves every navigation.
 */
export function parseDeepLink(
  search: string,
  authToken: string | undefined,
): DeepLink | undefined {
  const params = new URLSearchParams(search);
  const rawServerUrl = params.get("serverUrl");
  const autoConnect = params.get("autoConnect");
  if (!rawServerUrl || !autoConnect) return undefined;

  if (!authToken || autoConnect !== authToken) return undefined;

  const serverUrl = validateServerUrl(rawServerUrl);
  if (!serverUrl) return undefined;

  const transportParam = params.get("transport") ?? "http";
  const transport = ALLOWED_TRANSPORTS.has(transportParam)
    ? transportParam
    : "http";
  const serverConfig: MCPServerConfig =
    transport === "sse"
      ? { type: "sse", url: serverUrl }
      : { type: "streamable-http", url: serverUrl };

  const openApp = params.get("openApp") ?? undefined;
  const appArgs = decodeAppArgs(params.get("appArgs"));

  return { serverId: DEEP_LINK_SERVER_ID, serverConfig, openApp, appArgs };
}
