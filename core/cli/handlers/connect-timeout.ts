import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
  type InspectorServerSettings,
} from "../../mcp/types.js";

/**
 * Default connect timeout (ms) for ad-hoc server invocations. Without this an
 * unreachable server hangs the CLI indefinitely.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

/**
 * The remedy the one-shot CLI and mcpdo append to a connect-time timeout error
 * (#2615): both accept `--connect-timeout`, and both read `connectionTimeout`
 * from the server's `mcp.json` entry — neither has the web's Server Settings.
 */
export const CLI_CONNECTION_TIMEOUT_REMEDY =
  "To accommodate a slower server, pass a larger --connect-timeout <ms>, or set connectionTimeout on the server's entry in mcp.json.";

/**
 * Apply a connection timeout to a resolved server's settings, building a
 * minimal {@link InspectorServerSettings} when none came from the file.
 */
export function withConnectTimeout(
  settings: InspectorServerSettings | undefined,
  connectionTimeout: number | undefined,
): InspectorServerSettings | undefined {
  if (connectionTimeout === undefined) return settings;
  if (settings) return { ...settings, connectionTimeout };
  return {
    headers: [],
    metadata: {},
    env: [],
    connectionTimeout,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
    autoRefreshOnListChanged: false,
    paginatedLists: false,
    roots: [],
  };
}
