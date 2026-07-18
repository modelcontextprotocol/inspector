import { describe, expect, it } from "vitest";
import type {
  MessageEntry,
  FetchRequestEntry,
} from "@inspector/core/mcp/types.js";
import {
  correlateFetchEntry,
  enrichProtocolEntries,
  messageJsonRpcId,
} from "./correlateTransportErrors";

function requestEntry(id: number, method = "tools/call"): MessageEntry {
  return {
    id: `msg-${id}`,
    timestamp: new Date("2026-07-28T10:30:00Z"),
    direction: "request",
    origin: "client",
    message: { jsonrpc: "2.0", id, method, params: { name: "t" } },
  };
}

function transportFetch(
  jsonRpcId: number | string,
  responseBody: string | undefined,
  overrides: Partial<FetchRequestEntry> = {},
): FetchRequestEntry {
  return {
    id: `fetch-${jsonRpcId}`,
    timestamp: new Date("2026-07-28T10:30:00Z"),
    method: "POST",
    url: "https://example.com/mcp",
    requestHeaders: {},
    requestBody: JSON.stringify({
      jsonrpc: "2.0",
      id: jsonRpcId,
      method: "tools/call",
    }),
    responseStatus: 404,
    responseBody,
    category: "transport",
    ...overrides,
  };
}

const errorBody = (code: number, data?: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code, message: "x", ...(data ? { data } : {}) },
  });

describe("messageJsonRpcId", () => {
  it("returns the request id, undefined for notifications", () => {
    expect(messageJsonRpcId(requestEntry(7))).toBe(7);
    const note: MessageEntry = {
      id: "n",
      timestamp: new Date(),
      direction: "notification",
      message: { jsonrpc: "2.0", method: "notifications/message" },
    };
    expect(messageJsonRpcId(note)).toBeUndefined();
  });
});

describe("enrichProtocolEntries", () => {
  it("folds a thrown transport error onto its pending request (by JSON-RPC id)", () => {
    const messages = [requestEntry(1)];
    const fetches = [transportFetch(1, errorBody(-32601))];
    const [out] = enrichProtocolEntries(messages, fetches);
    expect(
      out.response && "error" in out.response && out.response.error.code,
    ).toBe(-32601);
  });

  it("returns the SAME array reference when nothing matches", () => {
    const messages = [requestEntry(1)];
    // A fetch for a different id, and one with no error body.
    const fetches = [
      transportFetch(2, errorBody(-32601)),
      transportFetch(1, '{"jsonrpc":"2.0","id":1,"result":{}}'),
    ];
    expect(enrichProtocolEntries(messages, fetches)).toBe(messages);
  });

  it("leaves an already-answered request untouched", () => {
    const answered: MessageEntry = {
      ...requestEntry(1),
      response: { jsonrpc: "2.0", id: 1, result: {} },
    };
    const fetches = [transportFetch(1, errorBody(-32601))];
    const [out] = enrichProtocolEntries([answered], fetches);
    expect("result" in (out.response ?? {})).toBe(true);
  });

  it("ignores auth-category fetches", () => {
    const messages = [requestEntry(1)];
    const fetches = [
      transportFetch(1, errorBody(-32020), { category: "auth" }),
    ];
    expect(enrichProtocolEntries(messages, fetches)).toBe(messages);
  });
});

describe("correlateFetchEntry", () => {
  it("finds the transport fetch with a matching JSON-RPC id (most recent wins)", () => {
    const older = transportFetch(1, errorBody(-32020), { id: "fetch-old" });
    const newer = transportFetch(1, errorBody(-32020), { id: "fetch-new" });
    expect(correlateFetchEntry(requestEntry(1), [older, newer])?.id).toBe(
      "fetch-new",
    );
  });

  it("returns undefined for a notification or when no fetch matches", () => {
    const note: MessageEntry = {
      id: "n",
      timestamp: new Date(),
      direction: "notification",
      message: { jsonrpc: "2.0", method: "notifications/message" },
    };
    expect(
      correlateFetchEntry(note, [transportFetch(1, undefined)]),
    ).toBeUndefined();
    expect(
      correlateFetchEntry(requestEntry(9), [transportFetch(1, undefined)]),
    ).toBeUndefined();
  });
});

describe("request-body id parsing edge cases", () => {
  it("skips a non-JSON or batch (array) request body", () => {
    const messages = [requestEntry(1)];
    const fetches = [
      { ...transportFetch(1, errorBody(-32601)), requestBody: "not json" },
      { ...transportFetch(1, errorBody(-32601)), requestBody: "[1,2]" },
      { ...transportFetch(1, errorBody(-32601)), requestBody: undefined },
    ];
    expect(enrichProtocolEntries(messages, fetches)).toBe(messages);
  });

  it("matches a string JSON-RPC id and preserves the error data", () => {
    const message: MessageEntry = {
      ...requestEntry(1),
      message: { jsonrpc: "2.0", id: "abc", method: "tools/call" },
    };
    const fetch = transportFetch(
      "abc",
      errorBody(-32022, { supported: ["2026-07-28"] }),
    );
    const [out] = enrichProtocolEntries([message], [fetch]);
    const folded =
      out.response && "error" in out.response ? out.response.error : undefined;
    expect(folded?.code).toBe(-32022);
    expect((folded?.data as { supported: string[] }).supported).toEqual([
      "2026-07-28",
    ]);
  });
});
