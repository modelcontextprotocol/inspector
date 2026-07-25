import { describe, it, expect } from "vitest";
import {
  isOneShotMethod,
  metaValueToString,
  ONE_SHOT_METHODS,
  SESSION_RPC_METHODS,
} from "../src/handlers/method-types.js";

describe("SESSION_RPC_METHODS", () => {
  it("lists the RPC methods the daemon / session CLI share", () => {
    expect(SESSION_RPC_METHODS).toContain("tools/list");
    expect(SESSION_RPC_METHODS).toContain("tools/call");
    expect(SESSION_RPC_METHODS).toContain("logging/tail");
    expect(SESSION_RPC_METHODS).toContain("roots/set");
    expect(new Set(SESSION_RPC_METHODS).size).toBe(SESSION_RPC_METHODS.length);
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

describe("metaValueToString", () => {
  it("passes strings through and JSON-encodes structured values", () => {
    expect(metaValueToString("plain")).toBe("plain");
    expect(metaValueToString({ a: 1 })).toBe('{"a":1}');
    expect(metaValueToString([1, 2])).toBe("[1,2]");
  });
});
