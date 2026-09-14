import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";
import { EMPTY_SETTINGS } from "./serverSettingsDefaults";

describe("EMPTY_SETTINGS", () => {
  it("is an empty draft carrying the shared defaults", () => {
    expect(EMPTY_SETTINGS).toEqual({
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
    });
  });

  it("keeps one object identity so React sees a stable reference", async () => {
    const again = await import("./serverSettingsDefaults");
    expect(again.EMPTY_SETTINGS).toBe(EMPTY_SETTINGS);
  });
});
