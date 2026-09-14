/**
 * Unit tests for the shared `progressTokenOf` guard (#2028) — the string/safe
 * integer extractor both relay waits (browser `RemoteClientTransport` and Node
 * `RemoteSession`) use to correlate a `notifications/progress` with the request
 * whose timeout it should re-arm. Covers the protocol's accept set and, since
 * the guard delegates to the SDK's `ProgressTokenSchema`, the fractional and
 * past-`MAX_SAFE_INTEGER` values a bare `typeof` check would have let through.
 */
import { describe, it, expect } from "vitest";
import { progressTokenOf } from "@inspector/core/mcp/remote/progressToken.js";
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
