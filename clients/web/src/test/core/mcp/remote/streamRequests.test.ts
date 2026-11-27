import { describe, it, expect } from "vitest";
import {
  cancelledRequestIdOf,
  isUnboundedStreamRequest,
} from "@inspector/core/mcp/remote/streamRequests.js";

describe("isUnboundedStreamRequest (#3029)", () => {
  it("is true only for an events/stream request", () => {
    expect(
      isUnboundedStreamRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "events/stream",
      }),
    ).toBe(true);
    expect(
      isUnboundedStreamRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "events/poll",
      }),
    ).toBe(false);
    // A notification with the same method is not a request to wait on.
    expect(
      isUnboundedStreamRequest({ jsonrpc: "2.0", method: "events/stream" }),
    ).toBe(false);
    expect(
      isUnboundedStreamRequest({ jsonrpc: "2.0", id: 1, result: {} }),
    ).toBe(false);
  });
});

describe("cancelledRequestIdOf (#3029)", () => {
  it("returns the id a notifications/cancelled names", () => {
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 4 },
      }),
    ).toBe(4);
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "abc" },
      }),
    ).toBe("abc");
  });

  it("returns undefined for anything else", () => {
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        method: "notifications/progress",
      }),
    ).toBeUndefined();
    expect(cancelledRequestIdOf({ jsonrpc: "2.0", id: 1, result: {} })).toBe(
      undefined,
    );
    // A request (has an id) with the method is not the notification.
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        id: 2,
        method: "notifications/cancelled",
        params: { requestId: 4 },
      }),
    ).toBeUndefined();
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
      }),
    ).toBeUndefined();
    expect(
      cancelledRequestIdOf({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: null },
      }),
    ).toBeUndefined();
  });
});
