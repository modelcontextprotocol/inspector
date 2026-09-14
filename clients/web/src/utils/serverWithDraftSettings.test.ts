import { describe, it, expect } from "vitest";
import type {
  InspectorServerSettings,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import { serverWithDraftSettings } from "./serverWithDraftSettings";

const settings = (
  over: Partial<InspectorServerSettings> = {},
): InspectorServerSettings => ({
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  ...over,
});

const entry = (over: Partial<ServerEntry> = {}): ServerEntry =>
  ({
    id: "a",
    name: "Server A",
    config: { type: "streamable-http", url: "https://mcp.example/mcp" },
    connection: { status: "disconnected" },
    ...over,
  }) as ServerEntry;

describe("serverWithDraftSettings", () => {
  // The case the helper exists for (#2144): an action in the settings modal
  // must read the value on screen, not the one the debounced save has written.
  it("prefers an unsaved draft over the persisted settings", () => {
    const result = serverWithDraftSettings(
      entry({ settings: settings({ oauthRevokeOnClear: undefined }) }),
      settings({ oauthRevokeOnClear: false }),
    );
    expect(result.settings?.oauthRevokeOnClear).toBe(false);
  });

  // The other direction matters just as much: re-checking the box before the
  // save lands must not leave the clear skipping revocation.
  it("prefers a draft that turns the setting back on", () => {
    const result = serverWithDraftSettings(
      entry({ settings: settings({ oauthRevokeOnClear: false }) }),
      settings({ oauthRevokeOnClear: undefined }),
    );
    expect(result.settings?.oauthRevokeOnClear).toBeUndefined();
  });

  it("returns the entry untouched when there is no draft", () => {
    const original = entry({
      settings: settings({ oauthRevokeOnClear: false }),
    });
    expect(serverWithDraftSettings(original, undefined)).toBe(original);
  });

  it("keeps the entry's identity and config", () => {
    const original = entry({ settings: settings() });
    const result = serverWithDraftSettings(original, settings({ taskTtl: 1 }));
    expect(result.id).toBe(original.id);
    expect(result.name).toBe(original.name);
    expect(result.config).toBe(original.config);
    expect(result).not.toBe(original);
  });
});
