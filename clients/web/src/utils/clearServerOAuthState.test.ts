import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { clearServerOAuthState } from "./clearServerOAuthState";

describe("clearServerOAuthState", () => {
  let storage: BrowserOAuthStorage;

  beforeEach(async () => {
    storage = new BrowserOAuthStorage();
    await storage.clear("https://mcp.example.com/mcp");
  });

  it("clears storage by server URL when not the active connection", async () => {
    await storage.saveTokens("https://mcp.example.com/mcp", {
      access_token: "tok",
      token_type: "Bearer",
    });

    const cleared = await clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      isActiveConnection: false,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(
      await storage.getTokens("https://mcp.example.com/mcp"),
    ).toBeUndefined();
  });

  it("uses the live client when clearing the active connection", async () => {
    const clearOAuthTokens = vi.fn<InspectorClient["clearOAuthTokens"]>();
    const inspectorClient = { clearOAuthTokens };

    const cleared = await clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      inspectorClient,
      isActiveConnection: true,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(clearOAuthTokens).toHaveBeenCalledTimes(1);
  });

  it("returns false for stdio servers", async () => {
    await expect(
      clearServerOAuthState({
        config: { type: "stdio", command: "node", args: [] },
        isActiveConnection: false,
        oauthStorage: storage,
      }),
    ).resolves.toBe(false);
  });
});
