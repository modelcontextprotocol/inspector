import { describe, it, expect } from "vitest";
import { SESSION_RPC_METHODS } from "../src/handlers/method-types.js";

describe("SESSION_RPC_METHODS", () => {
  it("lists the RPC methods the daemon / session CLI share", () => {
    expect(SESSION_RPC_METHODS).toContain("tools/list");
    expect(SESSION_RPC_METHODS).toContain("tools/call");
    expect(SESSION_RPC_METHODS).toContain("logging/tail");
    expect(SESSION_RPC_METHODS).toContain("roots/set");
    expect(new Set(SESSION_RPC_METHODS).size).toBe(SESSION_RPC_METHODS.length);
  });
});
