import { describe, it, expect } from "vitest";
import {
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
