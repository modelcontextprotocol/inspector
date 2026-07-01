import { describe, it, expect, vi } from "vitest";
import { clearServerOAuthState } from "./clearServerOAuthState";

describe("clearServerOAuthState", () => {
  it("clears storage by server URL when not the active connection", () => {
    const oauthStorage = { clear: vi.fn() };

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      isActiveConnection: false,
      oauthStorage,
    });

    expect(cleared).toBe(true);
    expect(oauthStorage.clear).toHaveBeenCalledWith(
      "https://mcp.example.com/mcp",
    );
  });

  it("uses the live client when clearing the active connection", () => {
    const inspectorClient = {
      clearOAuthTokens: vi.fn(),
    };
    const oauthStorage = { clear: vi.fn() };

    const cleared = clearServerOAuthState({
      config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      inspectorClient: inspectorClient as never,
      isActiveConnection: true,
      oauthStorage,
    });

    expect(cleared).toBe(true);
    expect(inspectorClient.clearOAuthTokens).toHaveBeenCalledTimes(1);
    // The backend-backed store is not touched directly when a live client is
    // present — the client owns resetting both persisted and in-memory state.
    expect(oauthStorage.clear).not.toHaveBeenCalled();
  });

  it("returns false for stdio servers", () => {
    const oauthStorage = { clear: vi.fn() };
    expect(
      clearServerOAuthState({
        config: { type: "stdio", command: "node", args: [] },
        isActiveConnection: false,
        oauthStorage,
      }),
    ).toBe(false);
  });
});
