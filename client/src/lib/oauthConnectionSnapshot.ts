// The connection an OAuth redirect was started for, saved per tab.
//
// The OAuth callback routes are reached by a redirect from the authorization
// server, so nothing the callback page can read from its URL or from
// origin-wide localStorage (which any other tab can write) may decide which
// connection it opens. Just before redirecting, the provider saves the active
// connection to sessionStorage, which belongs to this tab alone; the callback
// restores from that snapshot and reconnects only when the live settings still
// match it. Without a snapshot, or for a stdio transport (OAuth applies only to
// SSE and Streamable HTTP), the callback does not reconnect.

export const OAUTH_CALLBACK_PATH = "/oauth/callback";
export const OAUTH_DEBUG_CALLBACK_PATH = "/oauth/callback/debug";

/** True on the routes App renders as an OAuth callback. */
export const isOAuthCallbackPath = (
  pathname: string = window.location.pathname,
): boolean =>
  pathname === OAUTH_CALLBACK_PATH || pathname === OAUTH_DEBUG_CALLBACK_PATH;

export type SnapshotTransportType = "stdio" | "sse" | "streamable-http";
export type SnapshotConnectionType = "direct" | "proxy";

export interface OAuthConnectionSnapshot {
  serverUrl: string;
  transportType: SnapshotTransportType;
  connectionType: SnapshotConnectionType;
  command: string;
  args: string;
  /** The resolved proxy address the connection used. */
  proxyAddress: string;
}

const STORAGE_KEY = "mcp_oauth_connection_snapshot";

const TRANSPORT_TYPES: readonly string[] = ["stdio", "sse", "streamable-http"];
const CONNECTION_TYPES: readonly string[] = ["direct", "proxy"];

const isSnapshot = (value: unknown): value is OAuthConnectionSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.serverUrl === "string" &&
    typeof v.transportType === "string" &&
    TRANSPORT_TYPES.includes(v.transportType) &&
    typeof v.connectionType === "string" &&
    CONNECTION_TYPES.includes(v.connectionType) &&
    typeof v.command === "string" &&
    typeof v.args === "string" &&
    typeof v.proxyAddress === "string"
  );
};

export const saveOAuthConnectionSnapshot = (
  snapshot: OAuthConnectionSnapshot,
): void => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

export const readOAuthConnectionSnapshot =
  (): OAuthConnectionSnapshot | null => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

export const clearOAuthConnectionSnapshot = (): void => {
  sessionStorage.removeItem(STORAGE_KEY);
};

/** The snapshot to restore from, on a callback route only. */
export const getOAuthCallbackSnapshot = (): OAuthConnectionSnapshot | null =>
  isOAuthCallbackPath() ? readOAuthConnectionSnapshot() : null;

export interface LiveConnectionSettings {
  /** The server URL the callback authorized (SESSION_KEYS.SERVER_URL). */
  authorizedServerUrl: string;
  /** The settings the reconnect would actually use. */
  sseUrl: string;
  transportType: SnapshotTransportType;
  connectionType: SnapshotConnectionType;
  proxyAddress: string;
}

/**
 * Why the callback must not reconnect, or undefined when it may. It may only
 * when a snapshot exists, names an HTTP transport, and the live settings the
 * reconnect would use are the ones the snapshot recorded.
 */
export const getOAuthReconnectRefusal = (
  snapshot: OAuthConnectionSnapshot | null,
  live: LiveConnectionSettings,
): string | undefined => {
  if (!snapshot) {
    return "No saved connection for this authorization. Connect again from the sidebar.";
  }
  if (snapshot.transportType === "stdio" || live.transportType === "stdio") {
    return "OAuth applies only to SSE and Streamable HTTP connections. Not reconnecting.";
  }
  const matches =
    live.authorizedServerUrl === snapshot.serverUrl &&
    live.sseUrl === snapshot.serverUrl &&
    live.transportType === snapshot.transportType &&
    live.connectionType === snapshot.connectionType &&
    live.proxyAddress === snapshot.proxyAddress;
  if (!matches) {
    return "Connection settings changed during authorization. Connect again from the sidebar.";
  }
  return undefined;
};
