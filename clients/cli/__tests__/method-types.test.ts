import { describe, it, expect } from "vitest";
import {
  isOneShotMethod,
  ONE_SHOT_METHODS,
  CONNECTION_RPC_METHODS,
} from "../src/handlers/method-types.js";

describe("CONNECTION_RPC_METHODS", () => {
  it("lists the full RPC method set supported by runMethod", () => {
    expect(CONNECTION_RPC_METHODS).toContain("tools/list");
    expect(CONNECTION_RPC_METHODS).toContain("tools/call");
    expect(CONNECTION_RPC_METHODS).toContain("logging/tail");
    expect(CONNECTION_RPC_METHODS).toContain("roots/set");
    expect(new Set(CONNECTION_RPC_METHODS).size).toBe(
      CONNECTION_RPC_METHODS.length,
    );
  });
});

describe("ONE_SHOT_METHODS", () => {
  it("excludes stream and session-only methods", () => {
    expect(isOneShotMethod("tools/list")).toBe(true);
    expect(isOneShotMethod("logging/setLevel")).toBe(true);
    expect(isOneShotMethod("logging/tail")).toBe(false);
    expect(isOneShotMethod("resources/subscribe")).toBe(false);
    expect(isOneShotMethod("tasks/list")).toBe(false);
    expect(ONE_SHOT_METHODS).not.toContain("logging/tail");
  });
});
