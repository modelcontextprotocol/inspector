/**
 * Unit tests for the shared `progressTokenOf` guard (#2028) — the string/safe
 * integer extractor both relay waits (browser `RemoteClientTransport` and Node
 * `RemoteSession`) use to correlate a `notifications/progress` with the request
 * whose timeout it should re-arm. Covers the protocol's accept set and, since
 * the guard delegates to the SDK's `ProgressTokenSchema`, the fractional and
 * past-`MAX_SAFE_INTEGER` values a bare `typeof` check would have let through.
 */
import { describe, it, expect } from "vitest";
import {
  progressTokenOf,
  waitForProgressToken,
} from "@inspector/core/mcp/remote/progressToken.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";

// Cast helper: these fixtures are deliberately off-spec to exercise the guard
// branches, which the typed JSONRPCMessage shape would otherwise forbid.
const msg = (m: unknown): JSONRPCMessage => m as JSONRPCMessage;

describe("progressTokenOf (#2028)", () => {
  it("returns a numeric progressToken from a progress notification", () => {
    expect(
      progressTokenOf({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: 42, progress: 1, total: 3 },
      }),
    ).toBe(42);
  });

  it("returns a string progressToken", () => {
    expect(
      progressTokenOf({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: "abc", progress: 1 },
      }),
    ).toBe("abc");
  });

  it("returns undefined for a different notification method", () => {
    expect(
      progressTokenOf({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: {} },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a JSON-RPC response (no method)", () => {
    expect(
      progressTokenOf({ jsonrpc: "2.0", id: 1, result: {} }),
    ).toBeUndefined();
  });

  it("returns undefined when a progress note carries no params", () => {
    expect(
      progressTokenOf(
        msg({ jsonrpc: "2.0", method: "notifications/progress" }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when params is null", () => {
    expect(
      progressTokenOf(
        msg({ jsonrpc: "2.0", method: "notifications/progress", params: null }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the progressToken is neither string nor number", () => {
    expect(
      progressTokenOf(
        msg({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: { nested: true } },
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects a fractional numeric token (the protocol allows only integers)", () => {
    expect(
      progressTokenOf(
        msg({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: 1.5, progress: 1 },
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects an integer past MAX_SAFE_INTEGER", () => {
    expect(
      progressTokenOf(
        msg({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: Number.MAX_SAFE_INTEGER + 1, progress: 1 },
        }),
      ),
    ).toBeUndefined();
  });

  it("accepts a safe integer at the boundary", () => {
    expect(
      progressTokenOf({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: Number.MAX_SAFE_INTEGER, progress: 1 },
      }),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("waitForProgressToken (#2458)", () => {
  const waits = new Map<string | number, string>([
    [4, "numeric-4"],
    ["abc", "string-abc"],
    ["7", "string-7"],
  ]);

  it("matches a numeric token exactly", () => {
    expect(waitForProgressToken(waits, 4)).toBe("numeric-4");
  });

  it("matches a string token exactly", () => {
    expect(waitForProgressToken(waits, "abc")).toBe("string-abc");
  });

  it("prefers an exact string key over the numeric coercion", () => {
    const both = new Map<string | number, string>([
      [7, "numeric-7"],
      ["7", "string-7"],
    ]);
    expect(waitForProgressToken(both, "7")).toBe("string-7");
  });

  it("coerces a numeric string token to the numeric request id, as the SDK does", () => {
    expect(waitForProgressToken(waits, "4")).toBe("numeric-4");
  });

  it("does not coerce a numeric token to a string key", () => {
    expect(waitForProgressToken(waits, 7)).toBeUndefined();
  });

  it("returns undefined for a non-numeric string with no exact match", () => {
    expect(waitForProgressToken(waits, "nope")).toBeUndefined();
  });

  it("returns undefined for a string that coerces to a non-safe-integer", () => {
    const fractional = new Map<string | number, string>([[4.5, "x"]]);
    expect(waitForProgressToken(fractional, "4.5")).toBeUndefined();
  });
});
