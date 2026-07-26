import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
  type InspectorServerSettings,
} from "@inspector/core/mcp/types.js";

/**
 * Default connect timeout (ms) for ad-hoc server invocations. Without this an
 * unreachable server hangs the CLI indefinitely.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

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
    metadata: [],
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
