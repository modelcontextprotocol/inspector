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
import {
  AuthChallengeError,
  AuthRecoveryRequiredError,
  EMA_STEP_UP_PENDING_URL,
} from "@inspector/core/auth/challenge.js";

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
  authState?: (
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
      if (url.includes("/api/mcp/auth-state")) {
        return plan.authState
          ? plan.authState(input, init)
          : jsonResponse({ ok: true });
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

/** Push arbitrary RemoteEvent frames onto a controllable SSE stream. */
function createPushableEventStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(": keepalive\n\n"));
    },
  });
  const push = (event: RemoteEvent) => {
    controller?.enqueue(encoder.encode(sseFrame(event)));
  };
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push,
  };
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

/**
 * An SSE response whose stream stays open (never closes on its own) until the
 * transport cancels it. Use for tests that need the transport to remain
 * started/open past the initial start() call — the plan's default `events()`
 * handler returns an already-closed empty stream, which auto-closes the
 * transport shortly after start() resolves.
 */
function openEventsResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
    status: 200,
  });
}

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

  describe("start() connect-time auth challenge and error branches", () => {
    it("accepts the ok:true connect response shape (ok-wrapped sessionId)", async () => {
      const t = makeTransport({
        connect: () => jsonResponse({ ok: true, sessionId: "sess-ok" }),
      });
      await t.start();
      expect(t.getRemoteBackendSessionId()).toBe("sess-ok");
      await t.close();
    });

    it("throws a formatted error when connect returns a transport_error", async () => {
      const t = makeTransport({
        connect: () =>
          jsonResponse({
            ok: false,
            kind: "transport_error",
            error: "upstream unreachable",
          }),
      });
      await expect(t.start()).rejects.toThrow(
        /Remote connect failed: upstream unreachable/,
      );
    });

    it("throws AuthChallengeError immediately when connect returns an auth_challenge and no authRecovery is configured", async () => {
      const t = makeTransport({
        connect: () =>
          jsonResponse({
            ok: false,
            kind: "auth_challenge",
            authChallenge: { reason: "token_expired" },
          }),
      });
      try {
        await t.start();
        throw new Error("expected start() to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(AuthChallengeError);
        expect((e as AuthChallengeError).status).toBe(401);
      }
    });

    it("preserves the raw httpStatus on the AuthChallengeError when no authRecovery is configured", async () => {
      const t = makeTransport({
        connect: () =>
          jsonResponse({
            ok: false,
            kind: "auth_challenge",
            authChallenge: {
              reason: "invalid_token",
              raw: { httpStatus: 403 },
            },
          }),
      });
      try {
        await t.start();
        throw new Error("expected start() to throw");
      } catch (e) {
        expect((e as AuthChallengeError).status).toBe(403);
      }
    });

    it("throws AuthRecoveryRequiredError with the EMA pending URL for a step_up_confirm outcome", async () => {
      const t = makeTransport(
        {
          connect: () =>
            jsonResponse({
              ok: false,
              kind: "auth_challenge",
              authChallenge: { reason: "insufficient_scope" },
            }),
        },
        {
          authRecovery: {
            handleAuthChallenge: vi.fn().mockResolvedValue({
              kind: "step_up_confirm",
              challenge: { reason: "insufficient_scope" },
            }),
          },
        },
      );
      try {
        await t.start();
        throw new Error("expected start() to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(AuthRecoveryRequiredError);
        const err = e as AuthRecoveryRequiredError;
        expect(err.authorizationUrl).toBe(EMA_STEP_UP_PENDING_URL);
        expect(err.emaStepUpConfirm).toBe(true);
      }
    });

    it("throws AuthRecoveryRequiredError with the authorization URL for an interactive outcome", async () => {
      const authorizationUrl = new URL("https://idp.example/authorize");
      const t = makeTransport(
        {
          connect: () =>
            jsonResponse({
              ok: false,
              kind: "auth_challenge",
              authChallenge: { reason: "unauthorized" },
            }),
        },
        {
          authRecovery: {
            handleAuthChallenge: vi.fn().mockResolvedValue({
              kind: "interactive",
              authorizationUrl,
              challenge: { reason: "unauthorized" },
            }),
          },
        },
      );
      try {
        await t.start();
        throw new Error("expected start() to throw");
      } catch (e) {
        const err = e as AuthRecoveryRequiredError;
        expect(err.authorizationUrl).toBe(authorizationUrl);
        expect(err.emaStepUpConfirm).toBeUndefined();
      }
    });

    it("rethrows the recovery error for a failed outcome", async () => {
      const recoveryError = new Error("recovery failed");
      const t = makeTransport(
        {
          connect: () =>
            jsonResponse({
              ok: false,
              kind: "auth_challenge",
              authChallenge: { reason: "unauthorized" },
            }),
        },
        {
          authRecovery: {
            handleAuthChallenge: vi
              .fn()
              .mockResolvedValue({ kind: "failed", error: recoveryError }),
          },
        },
      );
      await expect(t.start()).rejects.toBe(recoveryError);
    });

    it("succeeds after a satisfied outcome retries connect and receives a session", async () => {
      let connectAttempt = 0;
      const t = makeTransport(
        {
          connect: () => {
            connectAttempt += 1;
            if (connectAttempt === 1) {
              return jsonResponse({
                ok: false,
                kind: "auth_challenge",
                authChallenge: { reason: "token_expired" },
              });
            }
            return jsonResponse({ sessionId: "recovered-session" });
          },
          events: () => openEventsResponse(),
        },
        {
          authRecovery: {
            handleAuthChallenge: vi
              .fn()
              .mockResolvedValue({ kind: "satisfied" }),
          },
        },
      );
      await t.start();
      expect(connectAttempt).toBe(2);
      expect(t.getRemoteBackendSessionId()).toBe("recovered-session");
      await t.close();
    });

    it("throws AuthChallengeError when a retried connect still returns an auth_challenge", async () => {
      const t = makeTransport(
        {
          connect: () =>
            jsonResponse({
              ok: false,
              kind: "auth_challenge",
              authChallenge: { reason: "token_expired" },
            }),
        },
        {
          authRecovery: {
            handleAuthChallenge: vi
              .fn()
              .mockResolvedValue({ kind: "satisfied" }),
          },
        },
      );
      await expect(t.start()).rejects.toBeInstanceOf(AuthChallengeError);
    });
  });

  describe("attachToSession while closed", () => {
    it("un-closes a previously closed transport before reattaching", async () => {
      const events = vi.fn(() => openEventsResponse());
      const t = makeTransport({ events });
      await t.close(); // never started; closed=true, no sessionId so disconnect is skipped
      expect((t as unknown as { closed: boolean }).closed).toBe(true);
      await t.attachToSession("resumed-session");
      expect((t as unknown as { closed: boolean }).closed).toBe(false);
      expect(t.getRemoteBackendSessionId()).toBe("resumed-session");
      await t.close();
    });
  });

  describe("fetchFn default", () => {
    it("falls back to globalThis.fetch when no fetchFn option is configured", () => {
      const t = new RemoteClientTransport(
        { baseUrl: "http://remote.test" },
        CONFIG,
      );
      expect((t as unknown as { fetchFn: typeof fetch }).fetchFn).toBe(
        globalThis.fetch,
      );
    });
  });

  describe("parseSSE trailing buffer", () => {
    it("ignores a trailing buffer line that is neither an event: nor a data: field", async () => {
      const onmessage = vi.fn();
      const t = makeTransport({
        events: () => sseResponse([": trailing comment with no newline"]),
      });
      t.onmessage = onmessage;
      await t.start();
      await tick();
      expect(onmessage).not.toHaveBeenCalled();
    });
  });

  describe("consumeEventStream stops after transport_error closes it", () => {
    it("does not process a message frame that follows a transport_error frame in the same batch", async () => {
      const m: JSONRPCMessage = { jsonrpc: "2.0", id: 99, result: {} };
      const onmessage = vi.fn();
      const onerror = vi.fn();
      const onclose = vi.fn();
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({ type: "transport_error", data: { error: "died" } }),
            sseFrame({ type: "message", data: m }),
          ]),
      });
      t.onmessage = onmessage;
      t.onerror = onerror;
      t.onclose = onclose;
      await t.start();
      await tick();
      expect(onerror).toHaveBeenCalledTimes(1);
      expect(onclose).toHaveBeenCalledTimes(1);
      expect(onmessage).not.toHaveBeenCalled();
    });
  });

  describe("consumeEventStream restart / re-entrancy suppression", () => {
    it("suppresses transport_error handling entirely while a reconnect is in flight", async () => {
      const sse = createPushableEventStream();
      const onerror = vi.fn();
      const onclose = vi.fn();
      const t = makeTransport({ events: () => sse.response });
      t.onerror = onerror;
      t.onclose = onclose;
      await t.start();
      await tick();
      // Simulate a reconnect (attachToSession/close) already in flight on this
      // transport when a stale transport_error frame from the old stream lands.
      (
        t as unknown as { restartingEventStream: boolean }
      ).restartingEventStream = true;
      sse.push({ type: "transport_error", data: { error: "stale" } });
      await tick();
      expect(onerror).not.toHaveBeenCalled();
      expect(onclose).not.toHaveBeenCalled();
      (
        t as unknown as { restartingEventStream: boolean }
      ).restartingEventStream = false;
      await t.close();
    });

    it("does not double-fire onclose when the onerror handler synchronously closes the transport", async () => {
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({ type: "transport_error", data: { error: "boom" } }),
          ]),
      });
      const onclose = vi.fn();
      let closePromise: Promise<void> | undefined;
      t.onerror = () => {
        closePromise = t.close();
      };
      t.onclose = onclose;
      await t.start();
      await tick();
      await closePromise;
      expect(onclose).toHaveBeenCalledTimes(1);
    });
  });

  describe("settleSseResponseWait guard", () => {
    it("ignores a message-type SSE event with no id (notification)", async () => {
      const onmessage = vi.fn();
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({
              type: "message",
              data: {
                jsonrpc: "2.0",
                method: "notifications/progress",
                params: {},
              },
            }),
          ]),
      });
      t.onmessage = onmessage;
      await t.start();
      await tick();
      expect(onmessage).toHaveBeenCalledTimes(1);
    });

    it("ignores a message-type SSE event that has an id but neither result nor error", async () => {
      const onmessage = vi.fn();
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({
              type: "message",
              data: { jsonrpc: "2.0", id: 3, method: "sampling/createMessage" },
            }),
          ]),
      });
      t.onmessage = onmessage;
      await t.start();
      await tick();
      expect(onmessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancelSseResponseWait no-op when already settled", () => {
    it("no-ops when the SSE response for the id already settled before the auth_challenge HTTP reply arrives", async () => {
      const sse = createPushableEventStream();
      const t = makeTransport({
        events: () => sse.response,
        send: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as {
            message: { id?: string | number };
          };
          // Simulate the SSE response for this id landing first...
          sse.push({
            type: "message",
            data: { jsonrpc: "2.0", id: body.message.id, result: {} },
          });
          // ...and let the independent SSE consumer settle it before the
          // HTTP reply (an auth_challenge for the same id) comes back.
          await tick();
          return jsonResponse({
            ok: false,
            kind: "auth_challenge",
            authChallenge: { reason: "token_expired" },
          });
        },
      });
      await t.start();
      await expect(
        t.send({ jsonrpc: "2.0", id: 11, method: "tools/list" }),
      ).rejects.toBeInstanceOf(AuthChallengeError);
      await t.close();
    });
  });

  describe("postSend catch skips cancel for requestId-less messages", () => {
    it("does not attempt to cancel an SSE wait for a notification when requestSend throws", async () => {
      const notif: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
      };
      const t = makeTransport({
        events: () => openEventsResponse(),
        send: () => {
          throw new Error("network down");
        },
      });
      await t.start();
      await expect(t.send(notif)).rejects.toThrow(/network down/);
      await t.close();
    });
  });

  describe("send() generic transport_error and notification failure paths", () => {
    it("throws the raw error message when send returns a non-auth_challenge failure kind", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        send: () =>
          jsonResponse({
            ok: false,
            kind: "transport_error",
            error: "upstream 503",
          }),
      });
      await t.start();
      await expect(
        t.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ).rejects.toThrow(/upstream 503/);
      await t.close();
    });

    it("skips cancelSseResponseWait for a notification whose send fails", async () => {
      const notif: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
      };
      const t = makeTransport({
        events: () => openEventsResponse(),
        send: () =>
          jsonResponse({ ok: false, kind: "transport_error", error: "boom" }),
      });
      await t.start();
      await expect(t.send(notif)).rejects.toThrow(/boom/);
      await t.close();
    });
  });

  describe("send() auth_challenge without recovery configured", () => {
    it("throws immediately when no authRecovery is configured", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        send: () =>
          jsonResponse({
            ok: false,
            kind: "auth_challenge",
            authChallenge: { reason: "token_expired" },
          }),
      });
      await t.start();
      await expect(
        t.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ).rejects.toBeInstanceOf(AuthChallengeError);
      await t.close();
    });

    it("throws immediately with the raw httpStatus when authRecovery has no pushAuthState handler", async () => {
      const t = makeTransport(
        {
          events: () => openEventsResponse(),
          send: () =>
            jsonResponse({
              ok: false,
              kind: "auth_challenge",
              authChallenge: {
                reason: "token_expired",
                raw: { httpStatus: 403 },
              },
            }),
        },
        { authRecovery: { handleAuthChallenge: vi.fn() } },
      );
      await t.start();
      try {
        await t.send({ jsonrpc: "2.0", id: 1, method: "ping" });
        throw new Error("expected send() to throw");
      } catch (e) {
        expect((e as AuthChallengeError).status).toBe(403);
      }
      await t.close();
    });
  });

  describe("pushAuthState guards", () => {
    it("throws Transport not started when called before start()", async () => {
      const t = makeTransport({});
      await expect(
        t.pushAuthState({
          oauthTokens: { access_token: "a", token_type: "Bearer" },
        }),
      ).rejects.toThrow(/Transport not started/);
    });

    it("throws Transport is closed after close()", async () => {
      const t = makeTransport({});
      await t.start();
      await t.close();
      await expect(
        t.pushAuthState({
          oauthTokens: { access_token: "a", token_type: "Bearer" },
        }),
      ).rejects.toThrow(/Transport is closed/);
    });

    it("throws when the resolved auth state has neither oauthTokens nor oauthClient", async () => {
      const t = makeTransport({ events: () => openEventsResponse() });
      await t.start();
      await expect(t.pushAuthState({})).rejects.toThrow(
        /No auth state to push/,
      );
      await t.close();
    });

    it("throws No auth provider configured when called with no explicit state and no authProvider", async () => {
      const t = makeTransport({ events: () => openEventsResponse() });
      await t.start();
      await expect(t.pushAuthState()).rejects.toThrow(
        /No auth provider configured/,
      );
      await t.close();
    });

    it("throws No OAuth tokens available when the configured authProvider has no tokens", async () => {
      const authProvider = {
        tokens: async () => undefined,
      } as unknown as NonNullable<RemoteTransportOptions["authProvider"]>;
      const t = makeTransport(
        { events: () => openEventsResponse() },
        { authProvider },
      );
      await t.start();
      await expect(t.pushAuthState()).rejects.toThrow(
        /No OAuth tokens available/,
      );
      await t.close();
    });

    it("throws a formatted error when the auth-state POST responds non-OK", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        authState: () => new Response("nope", { status: 500 }),
      });
      await t.start();
      await expect(
        t.pushAuthState({
          oauthTokens: { access_token: "a", token_type: "Bearer" },
        }),
      ).rejects.toThrow(/Remote auth-state update failed \(500\)/);
      await t.close();
    });

    it("throws the server-provided error message when the auth-state POST reports ok:false", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        authState: () => jsonResponse({ ok: false, error: "session gone" }),
      });
      await t.start();
      await expect(
        t.pushAuthState({
          oauthTokens: { access_token: "a", token_type: "Bearer" },
        }),
      ).rejects.toThrow(/session gone/);
      await t.close();
    });

    it("throws a default error message when the auth-state POST reports ok:false with no error field", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        authState: () => jsonResponse({ ok: false }),
      });
      await t.start();
      await expect(
        t.pushAuthState({
          oauthTokens: { access_token: "a", token_type: "Bearer" },
        }),
      ).rejects.toThrow(/Remote auth-state update failed/);
      await t.close();
    });

    it("accepts an explicit authState argument without consulting authProvider", async () => {
      const authProvider = {
        tokens: vi.fn(),
      } as unknown as NonNullable<RemoteTransportOptions["authProvider"]>;
      const authStateCalls: unknown[] = [];
      const t = makeTransport(
        {
          events: () => openEventsResponse(),
          authState: (_input, init) => {
            authStateCalls.push(JSON.parse(String(init?.body)));
            return jsonResponse({ ok: true });
          },
        },
        { authProvider },
      );
      await t.start();
      await t.pushAuthState({
        oauthTokens: { access_token: "explicit", token_type: "Bearer" },
      });
      expect(authStateCalls).toHaveLength(1);
      await t.close();
    });
  });

  describe("misc coverage", () => {
    it("setOnAuthChallenge updates the ambient auth challenge handler", async () => {
      const t = makeTransport({
        events: () =>
          sseResponse([
            sseFrame({
              type: "auth_challenge",
              data: { reason: "token_expired" },
            }),
          ]),
      });
      const onAuthChallenge = vi.fn();
      t.setOnAuthChallenge(onAuthChallenge);
      await t.start();
      await tick();
      expect(onAuthChallenge).toHaveBeenCalledWith({ reason: "token_expired" });
    });

    it("is a no-op when start() is called again while already connected", async () => {
      const connect = vi.fn(() => jsonResponse({ sessionId: "s" }));
      const t = makeTransport({ connect, events: () => openEventsResponse() });
      await t.start();
      await t.start();
      expect(connect).toHaveBeenCalledTimes(1);
      await t.close();
    });

    it("rejects a pending SSE response wait when close() runs mid-send", async () => {
      const t = makeTransport({
        events: () => openEventsResponse(),
        send: () => jsonResponse({ ok: true }),
      });
      await t.start();
      const sendPromise = t.send({ jsonrpc: "2.0", id: 1, method: "ping" });
      const rejection = expect(sendPromise).rejects.toThrow(/Transport closed/);
      await t.close();
      await rejection;
    });
  });
});
