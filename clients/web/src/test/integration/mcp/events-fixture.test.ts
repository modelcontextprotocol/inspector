import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestServerHttp,
  type TestServerHttp,
  loadConfig,
  resolveConfig,
  type ServerConfig,
  EVENT_TYPE_NAMES,
  EVENTS_EXTENSION_KEY,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Server-side coverage of the Events extension fixture (#3027, SEP-3415).
 *
 * The client side does not exist yet — that is what this fixture is for — so
 * these tests speak raw JSON-RPC over `fetch`, with the modern per-request
 * envelope and the Streamable HTTP routing headers written by hand. That also
 * keeps the fixture honest independently of the Inspector: nothing here goes
 * through code the fixture is meant to test.
 *
 * Each server is built by **resolving the checked-in config**, so a config
 * that stops threading `events` through `resolveConfig` fails here rather than
 * only when someone runs the fixture by hand.
 */

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");
const LEGACY_CONFIG = path.join(configsDir, "events-legacy-http.json");

const MODERN_VERSION = "2026-07-28";
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
  "io.modelcontextprotocol/clientInfo": {
    name: "events-fixture-test",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const SUB_KEY = "io.modelcontextprotocol/subscriptionId";
const WHSEC = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

type Json = Record<string, unknown>;

interface RpcReply {
  status: number;
  body: {
    result?: Json;
    error?: { code: number; message: string; data?: Json };
  };
}

let server: TestServerHttp | null = null;
let nextId = 1;

afterEach(async () => {
  if (server) {
    try {
      await server.stop();
    } catch {
      // ignore
    }
    server = null;
  }
});

async function start(
  configPath = MODERN_CONFIG,
  overrides: Partial<ServerConfig> = {},
): Promise<TestServerHttp> {
  const started = createTestServerHttp({
    ...resolveConfig(loadConfig(configPath)),
    port: undefined,
    ...overrides,
  });
  await started.start();
  server = started;
  return started;
}

/** Parse a JSON or single-message SSE reply body. */
function parseReply(text: string): RpcReply["body"] {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice(6) : text) as RpcReply["body"];
}

/** Headers a conforming client sends for `method` with these params. */
function routingHeaders(method: string, params: Json): Record<string, string> {
  const headers: Record<string, string> = {
    "mcp-protocol-version": MODERN_VERSION,
    "mcp-method": method,
  };
  if (method !== "events/list" && typeof params.name === "string") {
    headers["mcp-name"] = params.name;
  }
  const region = (params.arguments as Json | undefined)?.region;
  if (typeof region === "string") headers["mcp-param-region"] = region;
  return headers;
}

async function rpc(
  method: string,
  params: Json = {},
  options: {
    headers?: Record<string, string>;
    auto?: boolean;
    envelope?: boolean;
  } = {},
): Promise<RpcReply> {
  const body = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params:
      options.envelope === false ? params : { ...params, _meta: ENVELOPE },
  };
  const res = await fetch(server!.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(options.auto === false ? {} : routingHeaders(method, params)),
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: parseReply(await res.text()) };
}

async function result(method: string, params: Json = {}): Promise<Json> {
  const reply = await rpc(method, params);
  expect(reply.body.error, JSON.stringify(reply.body.error)).toBeUndefined();
  return reply.body.result!;
}

async function errorOf(method: string, params: Json = {}) {
  const reply = await rpc(method, params);
  expect(reply.body.result).toBeUndefined();
  return reply.body.error!;
}

async function callTool(name: string, args: Json = {}): Promise<Json> {
  const res = await result("tools/call", { name, arguments: args });
  return res;
}

async function stats(): Promise<Json> {
  return (await callTool("get_event_stats")).structuredContent as Json;
}

/** An open `events/stream`: frames as they arrive, and the abort. */
interface OpenStream {
  id: number;
  next: (timeoutMs?: number) => Promise<Json>;
  abort: () => void;
}

async function openStream(params: Json, id = nextId++): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(server!.url, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...routingHeaders("events/stream", params),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "events/stream",
      params: { ...params, _meta: ENVELOPE },
    }),
  });
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`not a stream: ${await res.text()}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue: Json[] = [];
  const next = async (timeoutMs = 5000): Promise<Json> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const frame = queue.shift();
      if (frame) return frame;
      const separator = buffer.indexOf("\n\n");
      if (separator !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = raw.split("\n").find((l) => l.startsWith("data: "));
        if (data) queue.push(JSON.parse(data.slice(6)) as Json);
        continue;
      }
      if (Date.now() > deadline)
        throw new Error("timed out waiting for a frame");
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stream ended");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  return { id, next, abort: () => controller.abort() };
}

async function nextOf(stream: OpenStream, method: string): Promise<Json> {
  for (;;) {
    const frame = await stream.next();
    if (frame.method === method) return frame;
  }
}

/** Wait (bounded) for a stats predicate — stream teardown is asynchronous. */
async function waitForStats(predicate: (s: Json) => boolean): Promise<Json> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const current = await stats();
    if (predicate(current)) return current;
    if (Date.now() > deadline)
      throw new Error(`stats never matched: ${JSON.stringify(current)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("events-modern-http.json (#3027)", () => {
  it("resolves with events on and the modern leg", () => {
    const resolved = resolveConfig(loadConfig(MODERN_CONFIG));
    expect(resolved.events).toBe(true);
    expect(resolved.modern).toEqual({});
  });

  it("advertises the extension with listChanged to a modern server/discover", async () => {
    await start();
    const discovered = await result("server/discover");
    const caps = discovered.capabilities as Json;
    expect((caps.extensions as Json)[EVENTS_EXTENSION_KEY]).toEqual({
      listChanged: true,
    });
  });

  it("exposes the control tools", async () => {
    await start();
    const listed = await result("tools/list");
    const names = (listed.tools as Json[]).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "emit_event",
        "add_event_type",
        "remove_event_type",
        "inject_event_failure",
        "get_event_stats",
      ]),
    );
  });

  describe("events/list", () => {
    it("paginates the five built-in types two per page", async () => {
      await start();
      const names: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await result("events/list", cursor ? { cursor } : {});
        expect(page.resultType).toBe("complete");
        names.push(...(page.events as Json[]).map((e) => e.name as string));
        cursor = page.nextCursor as string | undefined;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(names).toEqual([
        EVENT_TYPE_NAMES.pollOnly,
        EVENT_TYPE_NAMES.pushOnly,
        EVENT_TYPE_NAMES.allModes,
        EVENT_TYPE_NAMES.headerAnnotated,
        EVENT_TYPE_NAMES.invalidHeader,
      ]);
    });

    it("describes delivery modes and the x-mcp-header annotations", async () => {
      await start();
      const all = [
        ...((await result("events/list")).events as Json[]),
        ...((await result("events/list", { cursor: "2" })).events as Json[]),
        ...((await result("events/list", { cursor: "4" })).events as Json[]),
      ];
      const byName = new Map(all.map((e) => [e.name, e]));
      expect(byName.get("email.received")!.delivery).toEqual(["poll"]);
      expect(byName.get("build.finished")!.delivery).toEqual(["push"]);
      expect(byName.get("incident.created")!.delivery).toEqual([
        "poll",
        "push",
        "webhook",
      ]);
      const deploy = byName.get("deploy.completed")!.inputSchema as Json;
      expect((deploy.properties as Json).region).toMatchObject({
        "x-mcp-header": "Region",
      });
      const invalid = byName.get("invalid.header")!.inputSchema as Json;
      expect((invalid.properties as Json).tenant).toMatchObject({
        "x-mcp-header": "Bad Header",
      });
    });

    it("rejects an invalid cursor with InvalidParams", async () => {
      await start();
      expect((await errorOf("events/list", { cursor: "nope" })).code).toBe(
        -32602,
      );
    });
  });

  describe("events/poll", () => {
    it("treats a null and an absent cursor as start-from-now", async () => {
      await start();
      await callTool("emit_event", { name: "email.received" });
      for (const params of [{ cursor: null }, {}]) {
        const res = await result("events/poll", {
          name: "email.received",
          ...params,
        });
        expect(res).toMatchObject({
          resultType: "complete",
          events: [],
          cursor: "cur_1",
          truncated: false,
          hasMore: false,
          nextPollMs: 1000,
        });
      }
    });

    it("returns occurrences after the cursor, without a per-event cursor", async () => {
      await start();
      const first = await result("events/poll", {
        name: "email.received",
        cursor: null,
      });
      await callTool("emit_event", { name: "email.received", count: 2 });
      const res = await result("events/poll", {
        name: "email.received",
        cursor: first.cursor,
      });
      const events = res.events as Json[];
      expect(events.map((e) => e.eventId)).toEqual(["evt_0", "evt_1"]);
      expect(events[0]).not.toHaveProperty("cursor");
      expect(events[0]).toMatchObject({
        name: "email.received",
        data: { messageId: "msg_0" },
      });
      expect(res.cursor).toBe("cur_2");
    });

    it("drains a backlog with hasMore and maxEvents (backlog preset)", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "incident.created",
        cursor: null,
      });
      await callTool("inject_event_failure", { preset: "backlog", count: 5 });
      const page1 = await result("events/poll", {
        name: "incident.created",
        cursor,
        maxEvents: 2,
      });
      expect((page1.events as Json[]).length).toBe(2);
      expect(page1.hasMore).toBe(true);
      const page2 = await result("events/poll", {
        name: "incident.created",
        cursor: page1.cursor,
        maxEvents: 2,
      });
      const page3 = await result("events/poll", {
        name: "incident.created",
        cursor: page2.cursor,
        maxEvents: 2,
      });
      expect((page3.events as Json[]).length).toBe(1);
      expect(page3.hasMore).toBe(false);
    });

    it("reports truncated when maxAgeMs skips old occurrences", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "incident.created",
        cursor: null,
      });
      await callTool("emit_event", { name: "incident.created", ageMs: 60_000 });
      await callTool("emit_event", { name: "incident.created" });
      const res = await result("events/poll", {
        name: "incident.created",
        cursor,
        maxAgeMs: 10_000,
      });
      expect(res.truncated).toBe(true);
      expect((res.events as Json[]).map((e) => e.eventId)).toEqual(["evt_1"]);
    });

    it("applies maxAgeMs to every occurrence, not just a leading run", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "incident.created",
        cursor: null,
      });
      await callTool("emit_event", { name: "incident.created" });
      await callTool("emit_event", { name: "incident.created", ageMs: 60_000 });
      const res = await result("events/poll", {
        name: "incident.created",
        cursor,
        maxAgeMs: 10_000,
      });
      expect(res.truncated).toBe(true);
      expect((res.events as Json[]).map((e) => e.eventId)).toEqual(["evt_0"]);
      expect(res.cursor).toBe("cur_2");
    });

    it("reports truncated after a gap preset drops history", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "incident.created",
        cursor: null,
      });
      await callTool("emit_event", { name: "incident.created" });
      await callTool("inject_event_failure", { preset: "gap" });
      const res = await result("events/poll", {
        name: "incident.created",
        cursor,
      });
      expect(res).toMatchObject({
        events: [],
        truncated: true,
        cursor: "cur_1",
      });
    });

    it("limits a gap scoped by name to that type", async () => {
      await start();
      const email = await result("events/poll", {
        name: "email.received",
        cursor: null,
      });
      await callTool("emit_event", { name: "email.received" });
      await callTool("emit_event", { name: "incident.created" });
      await callTool("inject_event_failure", {
        preset: "gap",
        name: "incident.created",
      });
      const res = await result("events/poll", {
        name: "email.received",
        cursor: email.cursor,
      });
      expect(res.truncated).toBe(false);
      expect((res.events as Json[]).map((e) => e.eventId)).toEqual(["evt_0"]);
    });

    it("rejects maxEvents: 0, which could never drain a backlog", async () => {
      await start();
      expect(
        (await errorOf("events/poll", { name: "email.received", maxEvents: 0 }))
          .code,
      ).toBe(-32602);
    });

    it("filters by arguments that name payload keys", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "incident.created",
        cursor: null,
      });
      await callTool("emit_event", { name: "incident.created" });
      await callTool("emit_event", {
        name: "incident.created",
        data: { incidentId: "X", title: "t", severity: "P2", service: "db" },
      });
      const res = await result("events/poll", {
        name: "incident.created",
        cursor,
        arguments: { severity: "P2" },
      });
      expect((res.events as Json[]).map((e) => e.eventId)).toEqual(["evt_1"]);
    });

    it("answers NotFound, Unsupported and InvalidParams", async () => {
      await start();
      expect(await errorOf("events/poll", { name: "no.such" })).toMatchObject({
        code: -32023,
        data: { kind: "event" },
      });
      expect(
        await errorOf("events/poll", { name: "build.finished" }),
      ).toMatchObject({
        code: -32026,
        data: { feature: "deliveryMode", value: "poll" },
      });
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            arguments: { severity: "P9" },
          })
        ).code,
      ).toBe(-32602);
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            arguments: { bogus: 1 },
          })
        ).code,
      ).toBe(-32602);
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            arguments: [],
          })
        ).code,
      ).toBe(-32602);
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            cursor: "garbage",
          })
        ).code,
      ).toBe(-32602);
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            cursor: "cur_999",
          })
        ).code,
      ).toBe(-32602);
      expect(
        (await errorOf("events/poll", { name: "incident.created", cursor: 5 }))
          .code,
      ).toBe(-32602);
      expect(
        (
          await errorOf("events/poll", {
            name: "incident.created",
            maxEvents: -1,
          })
        ).code,
      ).toBe(-32602);
    });
  });

  describe("routing headers", () => {
    it("rejects a missing or mismatched Mcp-Name with HTTP 400 HeaderMismatch", async () => {
      await start();
      const missing = await rpc(
        "events/poll",
        { name: "email.received" },
        {
          headers: {
            "mcp-protocol-version": MODERN_VERSION,
            "mcp-method": "events/poll",
          },
          auto: false,
        },
      );
      expect(missing.status).toBe(400);
      expect(missing.body.error!.code).toBe(-32020);
      const wrong = await rpc(
        "events/poll",
        { name: "email.received" },
        { headers: { "mcp-name": "other" } },
      );
      expect(wrong.status).toBe(400);
      const method = await rpc(
        "events/poll",
        { name: "email.received" },
        { headers: { "mcp-method": "events/list" } },
      );
      expect(method.body.error!.code).toBe(-32020);
    });

    it("accepts the Base64 sentinel form of Mcp-Name", async () => {
      await start();
      const encoded = `=?base64?${Buffer.from("email.received").toString("base64")}?=`;
      const reply = await rpc(
        "events/poll",
        { name: "email.received" },
        { headers: { "mcp-name": encoded } },
      );
      expect(reply.body.error).toBeUndefined();
    });

    it("requires Mcp-Param-Region for the annotated argument", async () => {
      await start();
      const params = {
        name: "deploy.completed",
        arguments: { region: "us-west1" },
      };
      expect((await rpc("events/poll", params)).body.error).toBeUndefined();
      const missing = await rpc("events/poll", params, {
        auto: false,
        headers: {
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-method": "events/poll",
          "mcp-name": "deploy.completed",
        },
      });
      expect(missing.status).toBe(400);
      expect(missing.body.error!.code).toBe(-32020);
      const wrong = await rpc("events/poll", params, {
        headers: { "mcp-param-region": "eu-west1" },
      });
      expect(wrong.body.error!.code).toBe(-32020);
    });
  });

  describe("events/stream", () => {
    it("confirms with active, then delivers events tagged with the subscription id", async () => {
      await start();
      const stream = await openStream({
        name: "incident.created",
        cursor: null,
        heartbeatMs: 5000,
      });
      const active = await stream.next();
      expect(active.method).toBe("notifications/events/active");
      expect(active.params).toMatchObject({
        cursor: "cur_0",
        truncated: false,
        heartbeatMs: 5000,
        _meta: { [SUB_KEY]: stream.id },
      });
      await callTool("emit_event", { name: "incident.created" });
      const event = await stream.next();
      expect(event).toMatchObject({
        method: "notifications/events/event",
        params: {
          eventId: "evt_0",
          name: "incident.created",
          cursor: "cur_1",
          _meta: { [SUB_KEY]: stream.id },
        },
      });
      stream.abort();
    });

    it("clamps the heartbeat and sends heartbeats carrying the cursor", async () => {
      await start();
      const stream = await openStream({
        name: "incident.created",
        heartbeatMs: 1,
      });
      const active = await stream.next();
      expect((active.params as Json).heartbeatMs).toBe(100);
      const beat = await stream.next();
      expect(beat).toMatchObject({
        method: "notifications/events/heartbeat",
        params: { cursor: "cur_0", _meta: { [SUB_KEY]: stream.id } },
      });
      stream.abort();
    });

    it("replays the backlog after the supplied cursor", async () => {
      await start();
      await callTool("emit_event", { name: "incident.created", count: 2 });
      const stream = await openStream({
        name: "incident.created",
        cursor: "cur_1",
      });
      expect((await stream.next()).method).toBe("notifications/events/active");
      expect(await stream.next()).toMatchObject({
        params: { eventId: "evt_1", cursor: "cur_2" },
      });
      stream.abort();
    });

    it("applies maxAgeMs to the replayed backlog and reports it on active", async () => {
      await start();
      await callTool("emit_event", { name: "incident.created" });
      await callTool("emit_event", { name: "incident.created", ageMs: 60_000 });
      const stream = await openStream({
        name: "incident.created",
        cursor: "cur_0",
        maxAgeMs: 10_000,
      });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/active",
        params: { truncated: true },
      });
      expect(await stream.next()).toMatchObject({
        params: { eventId: "evt_0" },
      });
      await callTool("emit_event", { name: "incident.created" });
      expect(await nextOf(stream, "notifications/events/event")).toMatchObject({
        params: { eventId: "evt_2" },
      });
      stream.abort();
    });

    it("omits every cursor for the emit-only push type", async () => {
      await start();
      const stream = await openStream({
        name: "build.finished",
        heartbeatMs: 100,
      });
      const active = await stream.next();
      expect(active.params).not.toHaveProperty("cursor");
      await callTool("emit_event", { name: "build.finished" });
      const event = await nextOf(stream, "notifications/events/event");
      expect(event.params).not.toHaveProperty("cursor");
      const beat = await nextOf(stream, "notifications/events/heartbeat");
      expect(beat.params).not.toHaveProperty("cursor");
      stream.abort();
    });

    it("releases the subscription when the client aborts", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      expect((await stats()).openStreams).toBe(1);
      stream.abort();
      await waitForStats((s) => s.openStreams === 0);
    });

    it("closes on notifications/cancelled for the stream's request id", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      const res = await fetch(server!.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: stream.id, _meta: ENVELOPE },
        }),
      });
      expect(res.status).toBe(202);
      await waitForStats((s) => s.openStreams === 0);
    });

    it("ignores notifications/cancelled for a request id two streams share", async () => {
      await start();
      const a = await openStream({ name: "incident.created" }, 9001);
      const b = await openStream({ name: "incident.created" }, 9001);
      await a.next();
      await b.next();
      await fetch(server!.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: 9001, _meta: ENVELOPE },
        }),
      });
      expect((await stats()).openStreams).toBe(2);
      a.abort();
      b.abort();
    });

    it("sends a transient error and keeps the stream open (stream_error)", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      await callTool("inject_event_failure", {
        preset: "stream_error",
        name: "incident.created",
      });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/error",
        params: { error: { code: -32603 }, _meta: { [SUB_KEY]: stream.id } },
      });
      await callTool("emit_event", { name: "incident.created" });
      expect((await stream.next()).method).toBe("notifications/events/event");
      stream.abort();
    });

    it("sends a fresh truncated active mid-stream on a gap", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      await callTool("inject_event_failure", {
        preset: "gap",
        name: "incident.created",
      });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/active",
        params: { truncated: true, cursor: "cur_0", heartbeatMs: 30_000 },
      });
      stream.abort();
    });

    it("terminates with Forbidden and a final result frame (terminate_forbidden)", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      await callTool("inject_event_failure", {
        preset: "terminate_forbidden",
        name: "incident.created",
      });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/terminated",
        params: { error: { code: -32024, data: { reason: "Access revoked" } } },
      });
      expect(await stream.next()).toMatchObject({
        id: stream.id,
        result: { resultType: "complete", _meta: { [SUB_KEY]: stream.id } },
      });
      // Poll's termination signal is the error on the next poll.
      expect(
        (await errorOf("events/poll", { name: "incident.created" })).code,
      ).toBe(-32024);
      // One-shot: the poll after that one succeeds.
      await result("events/poll", { name: "incident.created" });
    });

    it("terminates with Unsupported schema_changed (terminate_schema_changed)", async () => {
      await start();
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      await callTool("inject_event_failure", {
        preset: "terminate_schema_changed",
      });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/terminated",
        params: {
          error: {
            code: -32026,
            data: { feature: "payloadSchema", reason: "schema_changed" },
          },
        },
      });
      expect(
        await errorOf("events/poll", { name: "incident.created" }),
      ).toMatchObject({
        code: -32026,
        data: { reason: "schema_changed" },
      });
    });

    it("terminates with NotFound when the type is removed, and poll then answers NotFound", async () => {
      await start();
      const stream = await openStream({ name: "deploy.completed" });
      await stream.next();
      await callTool("remove_event_type", { name: "deploy.completed" });
      expect(await stream.next()).toMatchObject({
        method: "notifications/events/terminated",
        params: { error: { code: -32023, data: { kind: "event" } } },
      });
      expect(
        (await errorOf("events/poll", { name: "deploy.completed" })).code,
      ).toBe(-32023);
    });

    it("refuses to open on a poll-only type, before any stream starts", async () => {
      await start();
      const reply = await rpc("events/stream", { name: "email.received" });
      expect(reply.body.error).toMatchObject({
        code: -32026,
        data: { value: "push" },
      });
    });

    it("answers ResourceExhausted past maxStreams", async () => {
      await start(MODERN_CONFIG, { events: { maxStreams: 1 } });
      const stream = await openStream({ name: "incident.created" });
      await stream.next();
      const reply = await rpc("events/stream", { name: "incident.created" });
      expect(reply.body.error).toMatchObject({
        code: -32025,
        data: { limit: "subscriptions", max: 1 },
      });
      stream.abort();
    });
  });

  describe("list_changed on subscriptions/listen", () => {
    async function openListen(filter: Json): Promise<OpenStream> {
      const id = nextId++;
      const controller = new AbortController();
      const res = await fetch(server!.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MODERN_VERSION,
          "mcp-method": "subscriptions/listen",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "subscriptions/listen",
          params: { notifications: filter, _meta: ENVELOPE },
        }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const next = async (): Promise<Json> => {
        for (;;) {
          const separator = buffer.indexOf("\n\n");
          if (separator !== -1) {
            const raw = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const data = raw.split("\n").find((l) => l.startsWith("data: "));
            if (data) return JSON.parse(data.slice(6)) as Json;
            continue;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("stream ended");
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      };
      return { id, next, abort: () => controller.abort() };
    }

    it("echoes eventsListChanged and delivers list_changed on add and remove", async () => {
      await start();
      const listen = await openListen({
        eventsListChanged: true,
        toolsListChanged: true,
      });
      expect(await listen.next()).toMatchObject({
        method: "notifications/subscriptions/acknowledged",
        params: {
          notifications: { eventsListChanged: true, toolsListChanged: true },
          _meta: { [SUB_KEY]: listen.id },
        },
      });
      expect(await callTool("add_event_type", {})).toMatchObject({
        structuredContent: { name: EVENT_TYPE_NAMES.dynamic, outcome: "added" },
      });
      expect(await listen.next()).toMatchObject({
        method: "notifications/events/list_changed",
        params: { _meta: { [SUB_KEY]: listen.id } },
      });
      const names = [
        ...((await result("events/list", { cursor: "4" })).events as Json[]),
      ].map((e) => e.name);
      expect(names).toContain(EVENT_TYPE_NAMES.dynamic);
      expect(
        await callTool("add_event_type", { delivery: ["poll"] }),
      ).toMatchObject({
        structuredContent: { outcome: "replaced" },
      });
      expect((await listen.next()).method).toBe(
        "notifications/events/list_changed",
      );
      await callTool("remove_event_type", { name: EVENT_TYPE_NAMES.dynamic });
      expect((await listen.next()).method).toBe(
        "notifications/events/list_changed",
      );
      expect((await stats()).listenStreams).toBe(1);
      listen.abort();
      await waitForStats((s) => s.listenStreams === 0);
    });

    it("omits eventsListChanged from the ack when listChanged is not declared", async () => {
      await start(MODERN_CONFIG, { events: { listChanged: false } });
      const discovered = await result("server/discover");
      expect(
        ((discovered.capabilities as Json).extensions as Json)[
          EVENTS_EXTENSION_KEY
        ],
      ).toEqual({
        listChanged: false,
      });
      const listen = await openListen({ eventsListChanged: true });
      expect(await listen.next()).toMatchObject({
        params: { notifications: {} },
      });
      // Nothing honored: the graceful-close result follows the ack.
      expect(await listen.next()).toMatchObject({
        id: listen.id,
        result: { resultType: "complete" },
      });
    });

    it("leaves a listen without eventsListChanged to the SDK", async () => {
      await start();
      const listen = await openListen({ toolsListChanged: true });
      const ack = await listen.next();
      expect(ack.method).toBe("notifications/subscriptions/acknowledged");
      expect((ack.params as Json).notifications).toEqual({
        toolsListChanged: true,
      });
      expect((await stats()).listenStreams).toBe(0);
      listen.abort();
    });
  });

  describe("events/subscribe and events/unsubscribe (webhook management)", () => {
    const delivery = (url: string, secret = WHSEC) => ({
      mode: "webhook",
      url,
      secret,
    });

    it("grants a subscription, then reports deliveryStatus on refresh", async () => {
      await start();
      const params = {
        name: "incident.created",
        arguments: { severity: "P1" },
        delivery: delivery("https://hooks.example.com/in"),
        cursor: null,
      };
      const before = Date.now();
      const first = await result("events/subscribe", params);
      expect(first).toMatchObject({
        resultType: "complete",
        cursor: "cur_0",
        truncated: false,
      });
      expect(first.id).toMatch(/^sub_[0-9a-f]{16}$/);
      expect(first).not.toHaveProperty("deliveryStatus");
      const granted = Date.parse(first.refreshBefore as string) - before;
      expect(granted).toBeGreaterThanOrEqual(3_600_000 - 1000);
      expect(granted).toBeLessThanOrEqual(3_600_000 + 1000);
      const refresh = await result("events/subscribe", params);
      expect(refresh.id).toBe(first.id);
      expect(refresh.deliveryStatus).toMatchObject({
        active: true,
        lastError: null,
      });
      expect((await stats()).webhookSubscriptions).toBe(1);
    });

    it("clamps the TTL both ways and grants no expiry for ttlMs: null", async () => {
      await start();
      const base = {
        name: "incident.created",
        delivery: delivery("https://hooks.example.com/ttl"),
      };
      const now = Date.now();
      const short = await result("events/subscribe", { ...base, ttlMs: 10 });
      expect(
        Date.parse(short.refreshBefore as string) - now,
      ).toBeGreaterThanOrEqual(59_000);
      const long = await result("events/subscribe", {
        ...base,
        ttlMs: 10 ** 12,
      });
      expect(
        Date.parse(long.refreshBefore as string) - now,
      ).toBeLessThanOrEqual(86_400_000 + 1000);
      const forever = await result("events/subscribe", {
        ...base,
        ttlMs: null,
      });
      expect(forever.refreshBefore).toBeNull();
    });

    it("cans deliveryStatus from the URL path (/failing, /throttled)", async () => {
      await start();
      for (const [suffix, expected] of [
        ["failing", { active: false, lastError: "http_5xx" }],
        ["throttled", { active: true, throttled: true, retryAfterMs: 60_000 }],
      ] as const) {
        const params = {
          name: "incident.created",
          delivery: delivery(`https://hooks.example.com/${suffix}`),
        };
        await result("events/subscribe", params);
        expect(
          (await result("events/subscribe", params)).deliveryStatus,
        ).toMatchObject(expected);
      }
    });

    it("leaves no subscription behind when the cursor is rejected", async () => {
      await start();
      for (const cursor of ["garbage", "cur_99"]) {
        const error = await errorOf("events/subscribe", {
          name: "incident.created",
          delivery: delivery("https://hooks.example.com/c"),
          cursor,
        });
        expect(error.code).toBe(-32602);
      }
      expect((await stats()).webhookSubscriptions).toBe(0);
    });

    it("keys subscriptions by the caller's credential", async () => {
      await start();
      const params = {
        name: "incident.created",
        delivery: delivery("https://hooks.example.com/p"),
      };
      const ids: unknown[] = [];
      for (const token of ["Bearer one", "Bearer two"]) {
        const reply = await rpc("events/subscribe", params, {
          headers: { authorization: token },
        });
        ids.push(reply.body.result!.id);
      }
      expect(ids[0]).not.toBe(ids[1]);
      expect((await stats()).webhookSubscriptions).toBe(2);
    });

    it("validates url, secret, mode and TTL with InvalidParams", async () => {
      await start();
      const name = "incident.created";
      const bad = [
        { name, delivery: delivery("http://hooks.example.com/x") },
        { name, delivery: delivery("https://127.0.0.1/x") },
        { name, delivery: delivery("https://localhost/x") },
        { name, delivery: delivery("https://192.168.1.4/x") },
        { name, delivery: delivery("https://[::1]/x") },
        { name, delivery: delivery("not a url") },
        { name, delivery: delivery("https://hooks.example.com/x", "secret") },
        {
          name,
          delivery: delivery("https://hooks.example.com/x", "whsec_!!!!"),
        },
        {
          name,
          delivery: delivery(
            "https://hooks.example.com/x",
            `whsec_${Buffer.alloc(8).toString("base64")}`,
          ),
        },
        {
          name,
          delivery: {
            mode: "push",
            url: "https://hooks.example.com/x",
            secret: WHSEC,
          },
        },
        { name },
        { name, delivery: delivery("https://hooks.example.com/x"), ttlMs: -5 },
      ];
      for (const params of bad) {
        expect(
          (await errorOf("events/subscribe", params)).code,
          JSON.stringify(params),
        ).toBe(-32602);
      }
    });

    it("answers CallbackEndpointError for a reason-named host", async () => {
      await start();
      for (const reason of [
        "challenge_failed",
        "connection_refused",
        "timeout",
      ]) {
        const host = reason.replace(/_/g, "-");
        expect(
          await errorOf("events/subscribe", {
            name: "incident.created",
            delivery: delivery(`https://${host}.example.com/hook`),
          }),
        ).toMatchObject({ code: -32027, data: { reason } });
      }
    });

    it("refuses webhook on a type that does not offer it", async () => {
      await start();
      expect(
        await errorOf("events/subscribe", {
          name: "email.received",
          delivery: delivery("https://hooks.example.com/x"),
        }),
      ).toMatchObject({ code: -32026, data: { value: "webhook" } });
    });

    it("answers ResourceExhausted past maxWebhookSubscriptions", async () => {
      await start(MODERN_CONFIG, { events: { maxWebhookSubscriptions: 1 } });
      await result("events/subscribe", {
        name: "incident.created",
        delivery: delivery("https://a.example.com/x"),
      });
      expect(
        await errorOf("events/subscribe", {
          name: "incident.created",
          delivery: delivery("https://b.example.com/x"),
        }),
      ).toMatchObject({ code: -32025 });
    });

    it("unsubscribes by key, then answers NotFound for the same key", async () => {
      await start();
      const params = {
        name: "incident.created",
        arguments: { severity: "P1" },
      };
      await result("events/subscribe", {
        ...params,
        delivery: delivery("https://hooks.example.com/u"),
      });
      const unsub = {
        ...params,
        delivery: { url: "https://hooks.example.com/u" },
      };
      expect(await result("events/unsubscribe", unsub)).toEqual({
        resultType: "complete",
      });
      expect(await errorOf("events/unsubscribe", unsub)).toMatchObject({
        code: -32023,
        data: { kind: "subscription" },
      });
      expect(
        (await errorOf("events/unsubscribe", { name: "incident.created" }))
          .code,
      ).toBe(-32602);
    });

    it("drops a removed type's webhook subscriptions", async () => {
      await start();
      await result("events/subscribe", {
        name: "incident.created",
        delivery: delivery("https://hooks.example.com/r"),
      });
      await callTool("remove_event_type", { name: "incident.created" });
      expect((await stats()).webhookSubscriptions).toBe(0);
    });
  });

  describe("error_* failure presets", () => {
    const cases = [
      ["error_invalid_params", -32602],
      ["error_not_found", -32023],
      ["error_forbidden", -32024],
      ["error_resource_exhausted", -32025],
      ["error_unsupported", -32026],
      ["error_callback_endpoint", -32027],
    ] as const;
    for (const [preset, code] of cases) {
      it(`${preset} fails the next events/* request once with ${code}`, async () => {
        await start();
        await callTool("inject_event_failure", { preset });
        expect((await errorOf("events/list")).code).toBe(code);
        await result("events/list");
      });
    }

    it("limits an armed failure to one method and name", async () => {
      await start();
      await callTool("inject_event_failure", {
        preset: "error_forbidden",
        method: "events/poll",
        name: "email.received",
      });
      await result("events/list");
      await result("events/poll", { name: "incident.created" });
      expect(
        (await errorOf("events/poll", { name: "email.received" })).code,
      ).toBe(-32024);
    });
  });

  describe("control tools", () => {
    it("reports an unknown event type as a tool error", async () => {
      await start();
      expect(await callTool("emit_event", { name: "no.such" })).toMatchObject({
        isError: true,
      });
      expect(
        await callTool("remove_event_type", { name: "no.such" }),
      ).toMatchObject({ isError: true });
      expect(
        await callTool("inject_event_failure", {
          preset: "backlog",
          name: "no.such",
        }),
      ).toMatchObject({
        isError: true,
      });
    });

    it("honours an explicit eventId so a duplicate can be emitted", async () => {
      await start();
      const { cursor } = await result("events/poll", {
        name: "email.received",
        cursor: null,
      });
      await callTool("emit_event", { name: "email.received", eventId: "dup" });
      await callTool("emit_event", { name: "email.received", eventId: "dup" });
      const res = await result("events/poll", {
        name: "email.received",
        cursor,
      });
      expect((res.events as Json[]).map((e) => e.eventId)).toEqual([
        "dup",
        "dup",
      ]);
    });

    it("counts requests by method and errors", async () => {
      await start();
      await result("events/list");
      await errorOf("events/poll", { name: "no.such" });
      expect(await stats()).toMatchObject({
        requests: { "events/list": 1, "events/poll": 1 },
        legacyRequests: 0,
        errors: 1,
      });
    });
  });

  it("refuses and counts an events/* request without a modern envelope", async () => {
    await start();
    const reply = await rpc(
      "events/list",
      {},
      { envelope: false, auto: false },
    );
    expect(reply.body.error!.code).toBe(-32601);
    expect((await stats()).legacyRequests).toBe(1);
  });
});

describe("events-legacy-http.json (#3027)", () => {
  async function legacyRpc(
    method: string,
    params: Json,
    sessionId?: string,
  ): Promise<{ body: RpcReply["body"]; sessionId: string | null }> {
    const res = await fetch(server!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId
          ? {
              "mcp-session-id": sessionId,
              "mcp-protocol-version": "2025-11-25",
            }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    return {
      body: parseReply(await res.text()),
      sessionId: res.headers.get("mcp-session-id"),
    };
  }

  it("resolves as a legacy server that advertises on legacy", () => {
    const resolved = resolveConfig(loadConfig(LEGACY_CONFIG));
    expect(resolved.events).toEqual({ advertiseOnLegacy: true });
    expect(resolved.modern).toBeUndefined();
  });

  it("advertises the extension in initialize, yet refuses and counts events/*", async () => {
    await start(LEGACY_CONFIG);
    const init = await legacyRpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "events-fixture-test", version: "1.0.0" },
    });
    const caps = init.body.result!.capabilities as Json;
    expect((caps.extensions as Json)[EVENTS_EXTENSION_KEY]).toEqual({
      listChanged: true,
    });
    const sessionId = init.sessionId!;
    const listed = await legacyRpc("events/list", {}, sessionId);
    expect(listed.body.error!.code).toBe(-32601);
    const tool = await legacyRpc(
      "tools/call",
      { name: "get_event_stats", arguments: {} },
      sessionId,
    );
    expect(tool.body.result!.structuredContent).toMatchObject({
      legacyRequests: 1,
      requests: {},
    });
  });

  it("refuses events/* on the legacy leg even with a modern envelope", async () => {
    await start(LEGACY_CONFIG);
    const reply = await rpc("events/list");
    expect(reply.body.error!.code).toBe(-32601);
    const listen = await rpc("subscriptions/listen", {
      notifications: { eventsListChanged: true },
    });
    expect(listen.body.result).toBeUndefined();
    const init = await legacyRpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "events-fixture-test", version: "1.0.0" },
    });
    const tool = await legacyRpc(
      "tools/call",
      { name: "get_event_stats", arguments: {} },
      init.sessionId!,
    );
    expect(tool.body.result!.structuredContent).toMatchObject({
      legacyRequests: 1,
      listenStreams: 0,
    });
  });

  it("does not advertise on legacy by default", async () => {
    await start(LEGACY_CONFIG, { events: true });
    const init = await legacyRpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "events-fixture-test", version: "1.0.0" },
    });
    const caps = init.body.result!.capabilities as Json;
    expect(caps.extensions ?? {}).not.toHaveProperty(EVENTS_EXTENSION_KEY);
  });
});
