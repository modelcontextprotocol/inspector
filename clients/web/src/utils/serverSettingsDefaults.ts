import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";

// Stable empty-shell for `InspectorServerSettings`. Used both as the
// initial draft for a server entry that hasn't been touched yet, and as
// the fallback the settings modal renders against when it's closed
// (Mantine renders the dialog shell regardless of `opened`). Hoisted to
// module scope so both call sites share the same object identity and so
// React doesn't re-allocate on every render.
export const EMPTY_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
  requestTimeout: 0,
  taskTtl: DEFAULT_TASK_TTL_MS,
  autoRefreshOnListChanged: false,
  paginatedLists: false,
  maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
  roots: [],
};
