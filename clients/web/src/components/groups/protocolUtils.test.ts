import { describe, it, expect } from "vitest";
import { SUBSCRIPTION_ID_META_KEY } from "@modelcontextprotocol/client";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import {
  extractMethod,
  extractRequestState,
  extractResultType,
  extractSubscriptionId,
  groupProtocolEntries,
} from "./protocolUtils";

// A tools/call request entry whose paired response is the given result. `at`
// seeds the timestamp so grouping/order assertions are deterministic.
function callEntry(
  id: string,
  jsonRpcId: number,
  params: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  at = 0,
): MessageEntry {
  return {
    id,
    timestamp: new Date(at),
    direction: "request",
    origin: "client",
    message: { jsonrpc: "2.0", id: jsonRpcId, method: "tools/call", params },
    response: result ? { jsonrpc: "2.0", id: jsonRpcId, result } : undefined,
  };
}

describe("extractMethod", () => {
  it("returns the method name for a request entry", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    };
    expect(extractMethod(entry)).toBe("tools/list");
  });

  it("returns the method name for a notification entry", () => {
    const entry: MessageEntry = {
      id: "2",
      timestamp: new Date(),
      direction: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    };
    expect(extractMethod(entry)).toBe("notifications/initialized");
  });

  it("returns 'response' for a result-response entry without a method", () => {
    const entry: MessageEntry = {
      id: "3",
      timestamp: new Date(),
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [] },
      },
    };
    expect(extractMethod(entry)).toBe("response");
  });

  it("returns 'response' for an error-response entry without a method", () => {
    const entry: MessageEntry = {
      id: "4",
      timestamp: new Date(),
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid Request" },
      },
    };
    expect(extractMethod(entry)).toBe("response");
  });
});

describe("extractResultType", () => {
  it("returns 'input_required' when the result carries the discriminator", () => {
    const entry = callEntry(
      "1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "tok",
      },
    );
    expect(extractResultType(entry)).toBe("input_required");
  });

  it("returns 'input_required' when only inputRequests is present", () => {
    const entry = callEntry(
      "1",
      1,
      {},
      {
        resultType: "input_required",
        inputRequests: { "1": { method: "elicitation/create", params: {} } },
      },
    );
    expect(extractResultType(entry)).toBe("input_required");
  });

  it("returns 'complete' for a modern complete result", () => {
    const entry = callEntry(
      "1",
      1,
      {},
      {
        resultType: "complete",
        content: [],
      },
    );
    expect(extractResultType(entry)).toBe("complete");
  });

  it("returns undefined for a legacy result with no resultType", () => {
    const entry = callEntry("1", 1, {}, { content: [] });
    expect(extractResultType(entry)).toBeUndefined();
  });

  it("returns undefined for a pending request (no response)", () => {
    const entry = callEntry("1", 1, {}, undefined);
    expect(extractResultType(entry)).toBeUndefined();
  });

  it("returns undefined for an error response", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "request",
      message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
      response: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "bad" },
      },
    };
    expect(extractResultType(entry)).toBeUndefined();
  });

  it("returns undefined when the result is not an object", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "request",
      message: { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
      // A primitive result (e.g. an EmptyResult serialized oddly) is not modern.
      response: { jsonrpc: "2.0", id: 1, result: null as never },
    };
    expect(extractResultType(entry)).toBeUndefined();
  });
});

describe("extractRequestState", () => {
  it("reads the token off an input_required result", () => {
    const entry = callEntry(
      "1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "opaque-1",
      },
    );
    expect(extractRequestState(entry)).toBe("opaque-1");
  });

  it("reads the token echoed on a retried request's params", () => {
    const entry = callEntry(
      "2",
      2,
      { name: "greet", requestState: "opaque-1", inputResponses: {} },
      { resultType: "complete", content: [] },
    );
    expect(extractRequestState(entry)).toBe("opaque-1");
  });

  it("returns undefined when neither result nor params carry a token", () => {
    const entry = callEntry("1", 1, { name: "greet" }, { content: [] });
    expect(extractRequestState(entry)).toBeUndefined();
  });

  it("ignores an empty-string token", () => {
    const entry = callEntry(
      "1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "",
      },
    );
    expect(extractRequestState(entry)).toBeUndefined();
  });
});

describe("extractSubscriptionId", () => {
  it("reads the subscriptionId off a tagged notification's _meta", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "notification",
      origin: "server",
      message: {
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed",
        params: { _meta: { [SUBSCRIPTION_ID_META_KEY]: "sub-42" } },
      },
    };
    expect(extractSubscriptionId(entry)).toBe("sub-42");
  });

  it("returns undefined for an untagged notification", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "notification",
      message: { jsonrpc: "2.0", method: "notifications/initialized" },
    };
    expect(extractSubscriptionId(entry)).toBeUndefined();
  });

  it("returns undefined when params carry no _meta", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info" },
      },
    };
    expect(extractSubscriptionId(entry)).toBeUndefined();
  });

  it("returns undefined when _meta carries a non-string id", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { _meta: { [SUBSCRIPTION_ID_META_KEY]: 99 } },
      },
    };
    expect(extractSubscriptionId(entry)).toBeUndefined();
  });
});

describe("groupProtocolEntries", () => {
  it("leaves non-MRTR traffic as single rows, in order", () => {
    const a = callEntry("a", 1, { name: "x" }, { content: [] }, 1);
    const b = callEntry("b", 2, { name: "y" }, { content: [] }, 2);
    const rows = groupProtocolEntries([a, b]);
    expect(rows).toEqual([
      { kind: "single", entry: a },
      { kind: "single", entry: b },
    ]);
  });

  it("clusters an original call + its retry into one MRTR row", () => {
    const original = callEntry(
      "orig",
      1,
      { name: "greet" },
      { resultType: "input_required", requestState: "tok" },
      1,
    );
    const retry = callEntry(
      "retry",
      2,
      { name: "greet", requestState: "tok", inputResponses: {} },
      { resultType: "complete", content: [] },
      2,
    );
    const rows = groupProtocolEntries([original, retry]);
    expect(rows).toEqual([
      { kind: "mrtr", requestState: "tok", rounds: [original, retry] },
    ]);
  });

  it("clusters a multi-round MRTR conversation", () => {
    const r1 = callEntry(
      "r1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "tok",
      },
      1,
    );
    const r2 = callEntry(
      "r2",
      2,
      { requestState: "tok" },
      { resultType: "input_required", requestState: "tok" },
      2,
    );
    const r3 = callEntry(
      "r3",
      3,
      { requestState: "tok" },
      { resultType: "complete", content: [] },
      3,
    );
    const rows = groupProtocolEntries([r1, r2, r3]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      kind: "mrtr",
      requestState: "tok",
      rounds: [r1, r2, r3],
    });
  });

  it("does NOT merge adjacent MRTR runs with different tokens", () => {
    const a1 = callEntry(
      "a1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "A",
      },
      1,
    );
    const a2 = callEntry(
      "a2",
      2,
      { requestState: "A" },
      { resultType: "complete", content: [] },
      2,
    );
    const b1 = callEntry(
      "b1",
      3,
      {},
      {
        resultType: "input_required",
        requestState: "B",
      },
      3,
    );
    const rows = groupProtocolEntries([a1, a2, b1]);
    expect(rows).toEqual([
      { kind: "mrtr", requestState: "A", rounds: [a1, a2] },
      { kind: "mrtr", requestState: "B", rounds: [b1] },
    ]);
  });

  it("keeps an unrelated entry interleaved between two separate MRTR runs as its own row", () => {
    const a1 = callEntry(
      "a1",
      1,
      {},
      {
        resultType: "input_required",
        requestState: "A",
      },
      1,
    );
    const middle = callEntry("mid", 2, { name: "other" }, { content: [] }, 2);
    const a2 = callEntry(
      "a2",
      3,
      { requestState: "A" },
      { resultType: "complete", content: [] },
      3,
    );
    const rows = groupProtocolEntries([a1, middle, a2]);
    // The unrelated frame breaks contiguity, so the two "A" entries become two
    // separate single-round MRTR rows rather than one merged conversation.
    expect(rows).toEqual([
      { kind: "mrtr", requestState: "A", rounds: [a1] },
      { kind: "single", entry: middle },
      { kind: "mrtr", requestState: "A", rounds: [a2] },
    ]);
  });
});
