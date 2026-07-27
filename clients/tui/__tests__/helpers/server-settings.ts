import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

/**
 * A full {@link InspectorServerSettings} carrying the same product defaults the
 * server-list loader applies. Lets a test supply only the field(s) under test
 * (e.g. `{ enterpriseManaged: true }`) while `tsc` still sees a complete object,
 * avoiding `as unknown as` casts (see #1791 and the AGENTS.md `as`-cast policy).
 */
export function makeFakeServerSettings(
  overrides: Partial<InspectorServerSettings> = {},
): InspectorServerSettings {
  return {
    headers: [],
    metadata: [],
    env: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
    roots: [],
    ...overrides,
  };
}
