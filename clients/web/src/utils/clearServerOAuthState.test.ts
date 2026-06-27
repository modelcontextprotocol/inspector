import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBrowserOAuthStorage } from "@inspector/core/auth/browser/index.js";
import { clearServerOAuthState } from "./clearServerOAuthState";

describe("clearServerOAuthState", () => {
  beforeEach(() => {
    getBrowserOAuthStorage().clear("https://mcp.example.com/mcp");
  });

  it("clears storage by server URL when not the active connection", async () => {
    const storage = getBrowserOAuthStorage();
    await storage.saveTokens("https://mcp.example.com/mcp", {
      access_token: "tok",
      token_type: "Bearer",
    });

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      isActiveConnection: false,
    });

    expect(cleared).toBe(true);
    expect(
      await storage.getTokens("https://mcp.example.com/mcp"),
    ).toBeUndefined();
  });

  it("uses the live client when clearing the active connection", () => {
    const inspectorClient = {
      clearOAuthTokens: vi.fn(),
    };

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      inspectorClient: inspectorClient as never,
      isActiveConnection: true,
    });

    expect(cleared).toBe(true);
    expect(inspectorClient.clearOAuthTokens).toHaveBeenCalledTimes(1);
  });

  it("returns false for stdio servers", () => {
    expect(
      clearServerOAuthState({
        config: { type: "stdio", command: "node", args: [] },
        isActiveConnection: false,
      }),
    ).toBe(false);
  });
});
