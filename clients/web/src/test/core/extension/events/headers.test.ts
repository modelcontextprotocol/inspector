import { describe, it, expect, vi } from "vitest";
import { PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/client";
import {
  createEventsMcpNameFetch,
  mcpParamHeadersForEvent,
  partitionEventTypesByHeaderValidity,
} from "@inspector/core/extension/events/headers.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import { MODERN_PROTOCOL_VERSION } from "@inspector/core/mcp/types.js";

const URL_ = "https://example.com/mcp";

function eventType(
  name: string,
  properties: Record<string, unknown> = {},
): EventType {
  return {
    name,
    delivery: ["poll"],
    inputSchema: { type: "object", properties },
  };
}

const REGION = eventType("incident.created", {
  region: { type: "string", "x-mcp-header": "Region" },
  severity: { type: "string" },
});
const BAD = eventType("bad.number", {
  score: { type: "number", "x-mcp-header": "Score" },
});
const PLAIN = eventType("email.received", { from: { type: "string" } });

describe("partitionEventTypesByHeaderValidity (#3028)", () => {
  it("keeps valid types in order and excludes invalid ones with a reason", () => {
    const { kept, excluded } = partitionEventTypesByHeaderValidity([
      PLAIN,
      BAD,
      REGION,
    ]);
    expect(kept.map((e) => e.name)).toEqual([
      "email.received",
      "incident.created",
    ]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].eventType.name).toBe("bad.number");
    expect(excluded[0].reason).toMatch(/number/);
  });
});

describe("mcpParamHeadersForEvent (#3028)", () => {
  it("mirrors an annotated argument", () => {
    expect(
      mcpParamHeadersForEvent(REGION, { region: "us-west1", severity: "P1" }),
    ).toEqual({ "Mcp-Param-Region": "us-west1" });
  });

  it("is empty with no annotation, no value, or invalid annotations", () => {
    expect(mcpParamHeadersForEvent(PLAIN, { from: "a" })).toEqual({});
    expect(mcpParamHeadersForEvent(REGION, {})).toEqual({});
    expect(mcpParamHeadersForEvent(REGION, undefined)).toEqual({});
    expect(mcpParamHeadersForEvent(BAD, { score: 1 })).toEqual({});
  });
});

function request(
  method: string,
  params: Record<string, unknown>,
  // `null` = no `_meta` claim at all (a default parameter cannot tell an
  // explicit `undefined` from an omitted one).
  version: string | null = MODERN_PROTOCOL_VERSION,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 4,
    method,
    params: {
      ...params,
      ...(version !== null && {
        _meta: { [PROTOCOL_VERSION_META_KEY]: version },
      }),
    },
  };
}

function post(body: unknown, headers?: HeadersInit): RequestInit {
  return {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  };
}

/** Run one call through the wrapper; return the init the base fetch saw. */
async function send(
  init: RequestInit | undefined,
): Promise<RequestInit | undefined> {
  const baseFetch = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  await createEventsMcpNameFetch(baseFetch)(URL_, init);
  expect(baseFetch).toHaveBeenCalledTimes(1);
  return baseFetch.mock.calls[0]![1];
}

describe("createEventsMcpNameFetch (#3028)", () => {
  it.each([
    "events/poll",
    "events/stream",
    "events/subscribe",
    "events/unsubscribe",
  ])("stamps Mcp-Name = params.name on a modern %s", async (method) => {
    const seen = await send(
      post(request(method, { name: "incident.created" }), {
        "mcp-session-id": "abc",
      }),
    );
    const headers = new Headers(seen?.headers);
    expect(headers.get("mcp-name")).toBe("incident.created");
    expect(headers.get("mcp-session-id")).toBe("abc");
  });

  it("encodes a name that is not a safe header value", async () => {
    const seen = await send(
      post(request("events/poll", { name: "café.ordered" })),
    );
    expect(new Headers(seen?.headers).get("mcp-name")).toMatch(
      /^=\?base64\?.+\?=$/,
    );
  });

  it("overwrites a preset header that would disagree with params.name", async () => {
    const seen = await send(
      post(request("events/poll", { name: "incident.created" }), {
        "Mcp-Name": "preset",
      }),
    );
    expect(new Headers(seen?.headers).get("mcp-name")).toBe("incident.created");
  });

  it("leaves events/list alone — it has no params.name", async () => {
    const init = post(request("events/list", {}));
    expect(await send(init)).toBe(init);
  });

  it("passes everything else through untouched", async () => {
    const cases: Array<RequestInit | undefined> = [
      undefined,
      { method: "GET" },
      post(request("tools/call", { name: "echo" })),
      // legacy / unclaimed era
      post(request("events/poll", { name: "a" }, "2025-11-25")),
      post(request("events/poll", { name: "a" }, null)),
      // a notification (no id), a batch, a non-JSON and a non-string body
      post({ jsonrpc: "2.0", method: "events/poll", params: { name: "a" } }),
      post([request("events/poll", { name: "a" })]),
      post("not json"),
      { method: "POST", body: new Uint8Array([1]) },
      // no method, no params, a non-string name
      post({ jsonrpc: "2.0", id: 1 }),
      post({ jsonrpc: "2.0", id: 1, method: "events/poll" }),
      post(request("events/poll", { name: 7 })),
    ];
    for (const init of cases) {
      expect(await send(init)).toBe(init);
    }
  });
});
