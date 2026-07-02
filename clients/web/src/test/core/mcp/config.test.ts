import { describe, it, expect } from "vitest";
import {
  getOAuthServerUrl,
  getServerType,
  isOAuthCapableServerType,
} from "@inspector/core/mcp/config.js";

describe("isOAuthCapableServerType", () => {
  it("returns true for remote HTTP transports", () => {
    expect(isOAuthCapableServerType("sse")).toBe(true);
    expect(isOAuthCapableServerType("streamable-http")).toBe(true);
  });

  it("returns false for stdio", () => {
    expect(isOAuthCapableServerType("stdio")).toBe(false);
  });

  it("aligns with getServerType for configs without an explicit type", () => {
    const type = getServerType({ type: "stdio", command: "node" });
    expect(isOAuthCapableServerType(type)).toBe(false);
  });
});

describe("getOAuthServerUrl", () => {
  it("returns the MCP URL for HTTP transports", () => {
    expect(
      getOAuthServerUrl({
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
      }),
    ).toBe("https://mcp.example.com/mcp");
    expect(
      getOAuthServerUrl({ type: "sse", url: "https://mcp.example.com/sse" }),
    ).toBe("https://mcp.example.com/sse");
  });

  it("returns undefined for stdio", () => {
    expect(
      getOAuthServerUrl({ type: "stdio", command: "node", args: [] }),
    ).toBeUndefined();
  });
});
