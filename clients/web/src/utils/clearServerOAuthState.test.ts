import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import { clearServerOAuthState } from "./clearServerOAuthState";

describe("clearServerOAuthState", () => {
  let storage: BrowserOAuthStorage;

  beforeEach(() => {
    storage = new BrowserOAuthStorage();
    storage.clear("https://mcp.example.com/mcp");
  });

  it("clears storage by server URL when not the active connection", async () => {
    await storage.saveTokens("https://mcp.example.com/mcp", {
      access_token: "tok",
      token_type: "Bearer",
    });

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      isActiveConnection: false,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(
      await storage.getTokens("https://mcp.example.com/mcp"),
    ).toBeUndefined();
  });

  it("uses the live client when clearing the active connection", () => {
    const clearOAuthTokens = vi.fn<() => void>();
    const inspectorClient = { clearOAuthTokens };

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      inspectorClient,
      isActiveConnection: true,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(clearOAuthTokens).toHaveBeenCalledTimes(1);
  });

  it("returns false for stdio servers", () => {
    expect(
      clearServerOAuthState({
        config: { type: "stdio", command: "node", args: [] },
        isActiveConnection: false,
        oauthStorage: storage,
      }),
    ).toBe(false);
  });
});
