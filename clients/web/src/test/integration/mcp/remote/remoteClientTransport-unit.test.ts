/**
 * Focused unit tests for RemoteClientTransport that drive the error and
 * SSE-parsing branches that the full e2e remote-server harness does not
 * reliably reach (connect/events/send non-OK responses, missing sessionId,
 * missing event-stream body, transport_error events, malformed SSE JSON,
 * stream read errors, and the SSE final-buffer flush path).
 *
 * These use a hand-built mock `fetchFn` plus a controllable SSE
 * ReadableStream rather than a real Hono backend so each branch can be
 * exercised deterministically.
 */

import { describe, it, expect, vi } from "vitest";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";
import type { RemoteTransportOptions } from "@inspector/core/mcp/remote/remoteClientTransport.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import type { RemoteEvent } from "@inspector/core/mcp/remote/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const CONFIG: MCPServerConfig = {
  type: "sse",
  url: "http://upstream.test/sse",
};

/** Build a JSON Response. */
function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/**
 * Build an SSE Response whose body streams the supplied chunks (raw strings).
 * The returned `pushDone` flag is implicit: chunks are enqueued immediately
 * and the stream then closes.
 */
function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/** Encode a RemoteEvent as a single SSE `data:` frame. */
function sseFrame(event: RemoteEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

interface MockFetchPlan {
  connect?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  events?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  send?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  disconnect?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>;
}

/**
 * Returns a fetch implementation that dispatches by URL path to the plan's
 * handlers, defaulting to sensible success responses when a handler is omitted.
 */
function mockFetch(plan: MockFetchPlan): typeof fetch {
  const fn = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/mcp/connect")) {
        return plan.connect
          ? plan.connect(input, init)
          : jsonResponse({ sessionId: "sess-1" });
      }
      if (url.includes("/api/mcp/events")) {
        return plan.events ? plan.events(input, init) : sseResponse([]);
      }
      if (url.includes("/api/mcp/send")) {
        return plan.send ? plan.send(input, init) : jsonResponse({ ok: true });
      }
      if (url.includes("/api/mcp/disconnect")) {
        return plan.disconnect
          ? plan.disconnect(input, init)
          : jsonResponse({ ok: true });
      }
      throw new Error(`unexpected fetch to ${url}`);
    },
  );
  return fn as unknown as typeof fetch;
}

function makeTransport(
  plan: MockFetchPlan,
  extra: Partial<RemoteTransportOptions> = {},
): RemoteClientTransport {
  return new RemoteClientTransport(
    {
      baseUrl: "http://remote.test/", // trailing slash exercises baseUrl trim
      authToken: "tok",
      fetchFn: mockFetch(plan),
      ...extra,
    },
    CONFIG,
  );
}

/** Wait a tick so the detached consumeEventStream loop can advance. */
const tick = () => new Promise<void>((r) => setTimeout(r, 10));

describe("RemoteClientTransport (focused branch coverage)", () => {
  describe("start()", () => {
    it("throws Remote connect failed with status on non-OK connect", async () => {
      const t = makeTransport({
        connect: () =>
          new Response("nope", { status: 401, statusText: "Unauthorized" }),
      });
      await expect(t.start()).rejects.toThrow(/Remote connect failed \(401\)/);
      try {
        await t.start();
      } catch (e) {
        expect((e as { status?: number }).status).toBe(401);
      }
    });

    it("throws when the remote returns no sessionId", async () => {
      const t = makeTransport({
        connect: () => jsonResponse({ sessionId: "" }),
      });
      await expect(t.start()).rejects.toThrow(/did not return sessionId/);
    });

    it("throws Remote events stream failed on non-OK events response", async () => {
      const t = makeTransport({
        events: () => new Response("bad", { status: 500 }),
      });
      await expect(t.start()).rejects.toThrow(
        /Remote events stream failed \(500\)/,
      );
    });

    it("throws when the events stream has no body", async () => {
      const t = makeTransport({
        // A 204 No Content has a null body.
        events: () => new Response(null, { status: 200 }),
      });
      await expect(t.start()).rejects.toThrow(/no body/);
    });

    it("forwards OAuth tokens from authProvider into the connect body", async () => {
      let connectBody: unknown;
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/connect")) {
            connectBody = JSON.parse(init!.body as string);
            return jsonResponse({ sessionId: "s" });
          }
          return sseResponse([]);
        },
      );
      const authProvider = {
        tokens: async () => ({
          access_token: "AT",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "RT",
        }),
      } as unknown as NonNullable<RemoteTransportOptions["authProvider"]>;
      const t = new RemoteClientTransport(
        {
          baseUrl: "http://remote.test",
          fetchFn: fetchFn as unknown as typeof fetch,
          authProvider,
        },
        CONFIG,
      );
      await t.start();
      expect(connectBody).toMatchObject({
        authState: {
          oauthTokens: { access_token: "AT", refresh_token: "RT" },
        },
      });
      await t.close();
    });

    it("handles an authProvider that has no tokens", async () => {
      const authProvider = {
        tokens: async () => undefined,
      } as unknown as NonNullable<RemoteTransportOptions["authProvider"]>;
      const t = makeTransport({}, { authProvider });
      await t.start();
      await t.close();
    });

    it("start() is a no-op when already closed throws closed", async () => {
      const t = makeTransport({});
      await t.close();
      await expect(t.start()).rejects.toThrow(/Transport is closed/);
    });
  });

  describe("consumeEventStream() event handling", () => {
    it("delivers message events to onmessage", async () => {
      const msg: JSONRPCMessage = { jsonrpc: "2.0", id: 1, result: {} };
      const t = makeTransport({
        events: () => sseResponse([sseFrame({ type: "message", data: msg })]),
      });
      const received: JSONRPCMessage[] = [];
      t.onmessage = (m) => received.push(m);
      await t.start();
      await tick();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: 1 });
    });

    it("delivers fetch_request events (string timestamp coerced to Date)", async () => {
      const ts = new Date().toISOString();
      const entry = {
        id: "f1",
        url: "http://x",
        method: "GET",
        timestamp: ts,
      };
      const onFetchRequest = vi.fn();
      const t = makeTransport(
        {
          events: () =>
            sseResponse([
              sseFrame({
                type: "fetch_request",
                data: entry as never,
              }),
            ]),
        },
        { onFetchRequest },
      );
      await t.start();
      await tick();
      expect(onFetchRequest).toHaveBeenCalledTimes(1);
      const arg = onFetchRequest.mock.calls[0]![0] as { timestamp: Date };
      expect(arg.timestamp).toBeInstanceOf(Date);
    });

    it("delivers fetch_request events keeping a Date timestamp as-is", async () => {
      const onFetchRequest = vi.fn();
      // A numeric/Date timestamp triggers the non-string branch.
      const entry = { id: "f2", url: "u", method: "POST", timestamp: 123 };
      const t = makeTransport(
        {
          events: () =>
            sseResponse([
              sseFrame({ type: "fetch_request", data: entry as never }),
            ]),
        },
        { onFetchRequest },
      );
      await t.start();
      await tick();
      const arg = onFetchRequest.mock.calls[0]![0] as { timestamp: unknown };
      expect(arg.timestamp).toBe(123);
    });

    it("delivers fetch_request_body_update events", async () => {
      const onFetchResponseBody = vi.fn();
      const t = makeTransport(
        {
          events: () =>
            sseResponse([
              sseFrame({
                type: "fetch_request_body_update",
                data: { id: "f1", responseBody: "BODY" },
              }),
            ]),
        },
        { onFetchResponseBody },
      );
      await t.start();
      await tick();
      expect(onFetchResponseBody).toHaveBeenCalledWith("f1", "BODY");
    });

    it("delivers stdio_log events to onStderr", async () => {
      const onStderr = vi.fn();
      const t = makeTransport(
        {
          events: () =>
            sseResponse([
              sseFrame({
                type: "stdio_log",
                data: {
                  timestamp: new Date().toISOString(),
                  message: "stderr line",
                },
              }),
            ]),
        },
        { onStderr },
      );
      await t.start();
      await tick();
      expect(onStderr).toHaveBeenCalledTimes(1);
      expect(onStderr.mock.calls[0]![0].message).toBe("stderr line");
    });

    it("handles transport_error events: onerror + onclose, with code", async () => {
      const onerror = vi.fn();
      const onclose = vi.fn();
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({
              type: "transport_error",
              data: { error: "boom", code: 1006 },
            }),
          ]),
      });
      t.onerror = onerror;
      t.onclose = onclose;
      await t.start();
      await tick();
      expect(onerror).toHaveBeenCalledTimes(1);
      const err = onerror.mock.calls[0]![0] as {
        message: string;
        code?: number;
      };
      expect(err.message).toBe("boom");
      expect(err.code).toBe(1006);
      expect(onclose).toHaveBeenCalledTimes(1);
    });

    it("handles transport_error events without a code", async () => {
      const onerror = vi.fn();
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({ type: "transport_error", data: { error: "no-code" } }),
          ]),
      });
      t.onerror = onerror;
      await t.start();
      await tick();
      const err = onerror.mock.calls[0]![0] as { code?: number };
      expect(err.code).toBeUndefined();
    });

    it("reports malformed SSE JSON via onerror but keeps consuming", async () => {
      const onerror = vi.fn();
      const msg: JSONRPCMessage = { jsonrpc: "2.0", id: 7, result: {} };
      const t = makeTransport({
        events: () =>
          // First frame is invalid JSON (parse error), second is a valid message.
          sseResponse([
            `data: {not json}\n\n`,
            sseFrame({ type: "message", data: msg }),
          ]),
      });
      const received: JSONRPCMessage[] = [];
      t.onerror = onerror;
      t.onmessage = (m) => received.push(m);
      await t.start();
      await tick();
      expect(onerror).toHaveBeenCalled();
      // Consumption continued: the valid message after the bad frame arrived.
      expect(received).toHaveLength(1);
    });

    it("flushes a trailing SSE frame with no terminating blank line", async () => {
      const msg: JSONRPCMessage = { jsonrpc: "2.0", id: 9, result: {} };
      // No trailing \n\n — exercises the post-loop buffer-flush path in parseSSE.
      const frame = `event: message\ndata: ${JSON.stringify({
        type: "message",
        data: msg,
      })}`;
      const t = makeTransport({
        events: () => sseResponse([frame]),
      });
      const received: JSONRPCMessage[] = [];
      t.onmessage = (m) => received.push(m);
      await t.start();
      await tick();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: 9 });
    });

    it("handles a trailing buffer whose final unterminated line is an event:", async () => {
      // The stream ends mid-frame on an `event:` line (no terminating blank
      // line and no data), exercising the event-line branch of parseSSE's
      // post-loop buffer flush. Nothing is yielded (no data), but the branch
      // runs without error.
      const onmessage = vi.fn();
      const t = makeTransport({
        events: () => sseResponse([`data: ignored\n\nevent: trailing`]),
      });
      t.onmessage = onmessage;
      await t.start();
      await tick();
      // event-only trailing frame yields nothing
      expect(onmessage).not.toHaveBeenCalled();
    });

    it("stops delivering once the transport is closed mid-stream", async () => {
      // Two frames arrive; closing the transport from the first onmessage
      // handler makes the `if (this.closed) break` guard fire before the
      // second frame is delivered.
      const m1: JSONRPCMessage = { jsonrpc: "2.0", id: 1, result: {} };
      const m2: JSONRPCMessage = { jsonrpc: "2.0", id: 2, result: {} };
      const received: JSONRPCMessage[] = [];
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({ type: "message", data: m1 }),
            sseFrame({ type: "message", data: m2 }),
          ]),
      });
      t.onmessage = (m) => {
        received.push(m);
        // Close after the first message; the loop's closed-check breaks before
        // the second frame is processed.
        void t.close();
      };
      await t.start();
      await tick();
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: 1 });
    });

    it("coerces a non-Error thrown during event processing into an Error", async () => {
      // onmessage throws a string (not an Error); the per-frame catch coerces
      // it via `err instanceof Error ? err : new Error(String(err))`.
      const onerror = vi.fn();
      const m: JSONRPCMessage = { jsonrpc: "2.0", id: 3, result: {} };
      const t = makeTransport({
        events: () => sseResponse([sseFrame({ type: "message", data: m })]),
      });
      t.onmessage = () => {
        throw "string failure";
      };
      t.onerror = onerror;
      await t.start();
      await tick();
      expect(onerror).toHaveBeenCalled();
      const err = onerror.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("string failure");
    });

    it("reports a stream read error via onerror (non-abort)", async () => {
      const onerror = vi.fn();
      const onclose = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("stream blew up"));
        },
      });
      const t = makeTransport({
        events: () => new Response(stream, { status: 200 }),
      });
      t.onerror = onerror;
      t.onclose = onclose;
      await t.start();
      await tick();
      expect(onerror).toHaveBeenCalled();
      expect(onerror.mock.calls[0]![0].message).toMatch(/stream blew up/);
      // finally{} closes the transport.
      expect(onclose).toHaveBeenCalledTimes(1);
    });

    it("closes via finally when the stream ends without error", async () => {
      const onclose = vi.fn();
      const t = makeTransport({ events: () => sseResponse([]) });
      t.onclose = onclose;
      await t.start();
      await tick();
      expect(onclose).toHaveBeenCalledTimes(1);
    });
  });

  describe("send()", () => {
    it("throws when not started", async () => {
      const t = makeTransport({});
      await expect(
        t.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ).rejects.toThrow(/not started/);
    });

    it("throws closed when send() runs after a transport_error closed it", async () => {
      // close() clears _sessionId so send() would hit the "not started" guard
      // first. The transport_error event path sets closed=true while LEAVING
      // _sessionId populated, which is the only way to reach send()'s
      // "Transport is closed" guard.
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({ type: "transport_error", data: { error: "died" } }),
          ]),
      });
      await t.start();
      await tick();
      await expect(
        t.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ).rejects.toThrow(/Transport is closed/);
    });

    it("posts a message including relatedRequestId and succeeds", async () => {
      let sentBody: { relatedRequestId?: unknown } | undefined;
      const encoder = new TextEncoder();
      let sseController: ReadableStreamDefaultController<Uint8Array> | null =
        null;
      const pushSseMessage = (message: JSONRPCMessage) => {
        const payload = JSON.stringify({ type: "message", data: message });
        sseController?.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/connect")) return jsonResponse({ sessionId: "s" });
          if (url.includes("/events")) {
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  sseController = controller;
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                },
              }),
              { status: 200 },
            );
          }
          if (url.includes("/send")) {
            sentBody = JSON.parse(init!.body as string);
            const requestId = (
              sentBody as { message: { id?: string | number } }
            ).message.id;
            pushSseMessage({
              jsonrpc: "2.0",
              id: requestId!,
              result: {},
            });
            return jsonResponse({ ok: true });
          }
          return jsonResponse({ ok: true });
        },
      );
      const t = new RemoteClientTransport(
        {
          baseUrl: "http://remote.test",
          fetchFn: fetchFn as unknown as typeof fetch,
          sseResponseTimeoutMs: 2000,
        },
        CONFIG,
      );
      await t.start();
      await t.send(
        { jsonrpc: "2.0", id: 5, method: "ping" },
        { relatedRequestId: 42 },
      );
      expect(sentBody?.relatedRequestId).toBe(42);
      await t.close();
    });

    it("throws Remote send failed with status on non-OK send", async () => {
      const t = makeTransport({
        events: () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
          }),
        send: () => new Response("err", { status: 503 }),
      });
      await t.start();
      try {
        await t.send({ jsonrpc: "2.0", id: 1, method: "ping" });
        throw new Error("expected send to throw");
      } catch (e) {
        expect((e as Error).message).toMatch(/Remote send failed \(503\)/);
        expect((e as { status?: number }).status).toBe(503);
      }
      await t.close();
    });
  });

  describe("close()", () => {
    it("is idempotent and swallows disconnect errors", async () => {
      const onclose = vi.fn();
      const t = makeTransport({
        events: () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
          }),
        disconnect: () => {
          throw new Error("disconnect failed");
        },
      });
      t.onclose = onclose;
      await t.start();
      await t.close(); // disconnect throws but is swallowed; onclose fires
      await t.close(); // second close is a no-op (early return)
      expect(onclose).toHaveBeenCalledTimes(1);
    });

    it("close() before start() returns early without calling disconnect", async () => {
      const disconnect = vi.fn(() => jsonResponse({ ok: true }));
      const t = makeTransport({ disconnect });
      await t.close();
      // No sessionId yet → disconnect branch is skipped, but onclose still fires.
      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  describe("attachToSession", () => {
    it("opens SSE for an existing session without POST /connect", async () => {
      const connect = vi.fn(() => jsonResponse({ sessionId: "new" }));
      const events = vi.fn(() => sseResponse([]));
      const t = makeTransport({ connect, events });
      await t.attachToSession("existing-sess");
      expect(connect).not.toHaveBeenCalled();
      expect(events).toHaveBeenCalledWith(
        expect.stringContaining("sessionId=existing-sess"),
        expect.anything(),
      );
      expect(t.getRemoteBackendSessionId()).toBe("existing-sess");
      await t.close();
    });
  });

  describe("sessionId getter", () => {
    it("always returns undefined (intentional)", () => {
      const t = makeTransport({});
      expect(t.sessionId).toBeUndefined();
    });
  });

  describe("headers/fetchFn defaults", () => {
    it("omits auth header when no authToken is configured", async () => {
      const seen: Array<Record<string, string>> = [];
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          seen.push((init?.headers as Record<string, string>) ?? {});
          if (url.includes("/connect")) return jsonResponse({ sessionId: "s" });
          return sseResponse([]);
        },
      );
      const t = new RemoteClientTransport(
        {
          baseUrl: "http://remote.test",
          fetchFn: fetchFn as unknown as typeof fetch,
        },
        CONFIG,
      );
      await t.start();
      await t.close();
      // connect headers should not include the auth header
      expect(seen[0]!["x-mcp-remote-auth"]).toBeUndefined();
    });
  });
});
