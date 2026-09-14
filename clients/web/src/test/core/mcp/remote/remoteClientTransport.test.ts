import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

function sseFromString(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

function sseResponse(payload: string): Response {
  return new Response(sseFromString(payload), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const config: MCPServerConfig = {
  type: "stdio",
  command: "echo",
  args: ["hello"],
};

const baseUrl = "http://remote.example/";

function sseStreamResponse(): Response {
  const encoder = new TextEncoder();
  // Stream stays open with no events — we'll abort it when the transport closes.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createPushableSseStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(": keepalive\n\n"));
    },
  });
  const pushMessage = (message: unknown) => {
    const payload = JSON.stringify({ type: "message", data: message });
    controller?.enqueue(encoder.encode(`data: ${payload}\n\n`));
  };
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    pushMessage,
  };
}

describe("RemoteClientTransport", () => {
  it("send() throws when called before start()", async () => {
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: vi.fn() as unknown as typeof fetch },
      config,
    );
    await expect(
      transport.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
    ).rejects.toThrow(/Transport not started/);
  });

  it("send() throws Transport is closed after a transport_error SSE event sets closed", async () => {
    // After the SSE consumer processes a transport_error event the transport
    // marks itself closed (closed=true) without unsetting _sessionId — so a
    // subsequent send() must hit the "Transport is closed" branch rather than
    // the "Transport not started" branch.
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse(
          'data: {"type":"transport_error","data":{"error":"upstream died"}}\n\n',
        ),
      );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    const onclose = vi.fn();
    transport.onclose = onclose;
    await transport.start();
    // Wait for the SSE consumer to observe the transport_error event and
    // fire onclose — at that point `closed` is true but `_sessionId` is still
    // set, which is exactly the precondition we need for the send() branch.
    await vi.waitFor(() => expect(onclose).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 10,
    });
    await expect(
      transport.send({ jsonrpc: "2.0", id: 1, method: "ping" }),
    ).rejects.toThrow(/Transport is closed/);
  });

  it("send() throws a tagged error on non-ok response", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(sseStreamResponse())
      .mockResolvedValueOnce(new Response("upstream blew up", { status: 502 }));
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    await transport.start();
    try {
      await transport.send({ jsonrpc: "2.0", id: 7, method: "ping" });
      throw new Error("expected send() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Remote send failed \(502\)/);
      expect((err as { status?: number }).status).toBe(502);
    }
    await transport.close();
  });

  it("start() throws when remote returns no sessionId", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    await expect(transport.start()).rejects.toThrow(/did not return sessionId/);
  });

  it("calls onclose when the SSE stream ends without an explicit close", async () => {
    // Stream that closes immediately — covers the finally branch that sets
    // closed=true and fires onclose when the consumer exits cleanly.
    const closedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(closedStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    const onclose = vi.fn();
    transport.onclose = onclose;
    await transport.start();
    // The consumer runs as a fire-and-forget promise — wait for it to settle.
    await vi.waitFor(() => expect(onclose).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 10,
    });
    expect((transport as unknown as { closed: boolean }).closed).toBe(true);
  });

  it("forwards a non-AbortError stream failure to onerror", async () => {
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("network gone"));
      },
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(failingStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    const onerror = vi.fn();
    const onclose = vi.fn();
    transport.onerror = onerror;
    transport.onclose = onclose;
    await transport.start();
    await vi.waitFor(() => expect(onerror).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 10,
    });
    expect(onerror.mock.calls[0]?.[0]?.message).toMatch(/network gone/);
    expect(onclose).toHaveBeenCalled();
  });

  it("dispatches transport_error events to onerror and triggers onclose", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse(
          'data: {"type":"transport_error","data":{"error":"upstream died","code":42}}\n\n',
        ),
      );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    const onerror = vi.fn();
    const onclose = vi.fn();
    transport.onerror = onerror;
    transport.onclose = onclose;
    await transport.start();
    await vi.waitFor(() => expect(onerror).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 10,
    });
    const err = onerror.mock.calls[0]?.[0];
    expect(err?.message).toBe("upstream died");
    expect((err as { code?: number }).code).toBe(42);
    expect(onclose).toHaveBeenCalled();
  });

  it("forwards fetch_request and stdio_log SSE events to user callbacks", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse(
          'data: {"type":"fetch_request","data":{"id":"f1","timestamp":"2026-01-01T00:00:00.000Z","method":"GET","url":"http://x","requestHeaders":{}}}\n\n' +
            'data: {"type":"stdio_log","data":{"timestamp":"2026-01-01T00:00:00.000Z","message":"hello stderr"}}\n\n',
        ),
      );
    const fetchCalls: unknown[] = [];
    const stderrCalls: unknown[] = [];
    const transport = new RemoteClientTransport(
      {
        baseUrl,
        fetchFn: fetchFn as unknown as typeof fetch,
        onFetchRequest: (e) => fetchCalls.push(e),
        onStderr: (e) => stderrCalls.push(e),
      },
      config,
    );
    await transport.start();
    await vi.waitFor(
      () => {
        expect(fetchCalls.length).toBeGreaterThan(0);
        expect(stderrCalls.length).toBeGreaterThan(0);
      },
      { timeout: 1000, interval: 10 },
    );
    const fr = fetchCalls[0] as { timestamp: Date };
    expect(fr.timestamp).toBeInstanceOf(Date);
    const log = stderrCalls[0] as { message: string };
    expect(log.message).toBe("hello stderr");
  });

  it("forwards JSON parse errors from SSE data to onerror but keeps the loop alive", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse(
          "data: this is not json\n\n" +
            'data: {"type":"message","data":{"jsonrpc":"2.0","id":1,"result":{}}}\n\n',
        ),
      );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    const onerror = vi.fn();
    const onmessage = vi.fn();
    transport.onerror = onerror;
    transport.onmessage = onmessage;
    await transport.start();
    await vi.waitFor(
      () => {
        expect(onerror).toHaveBeenCalled();
        expect(onmessage).toHaveBeenCalled();
      },
      { timeout: 1000, interval: 10 },
    );
  });

  it("throws when start() receives an SSE response with no body", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    await expect(transport.start()).rejects.toThrow(/has no body/);
  });

  it("start() preserves status code on connect failure", async () => {
    const fetchFn = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    try {
      await transport.start();
      throw new Error("expected start() to throw");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(401);
      expect((err as Error).message).toMatch(/Remote connect failed \(401\)/);
    }
  });

  it("start() includes settings on the /api/mcp/connect body when provided", async () => {
    const seenBodies: string[] = [];
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        if (init?.method === "POST") {
          seenBodies.push(init.body as string);
          return new Response(JSON.stringify({ sessionId: "abc" }), {
            status: 200,
          });
        }
        return sseStreamResponse();
      });
    const settings = {
      headers: [{ key: "X-Tenant", value: "acme" }],
      env: [],
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 0,
      maxFetchRequests: 1000,
      roots: [],
    };
    const transport = new RemoteClientTransport(
      {
        baseUrl,
        fetchFn: fetchFn as unknown as typeof fetch,
        settings,
      },
      config,
    );
    await transport.start();
    await transport.close();

    expect(seenBodies.length).toBeGreaterThan(0);
    const parsed = JSON.parse(seenBodies[0]!) as { settings?: unknown };
    expect(parsed.settings).toEqual(settings);
  });

  it("start() omits the settings field when no settings are provided", async () => {
    const seenBodies: string[] = [];
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_input, init) => {
        if (init?.method === "POST") {
          seenBodies.push(init.body as string);
          return new Response(JSON.stringify({ sessionId: "abc" }), {
            status: 200,
          });
        }
        return sseStreamResponse();
      });
    const transport = new RemoteClientTransport(
      { baseUrl, fetchFn: fetchFn as unknown as typeof fetch },
      config,
    );
    await transport.start();
    await transport.close();
    const parsed = JSON.parse(seenBodies[0]!) as Record<string, unknown>;
    expect("settings" in parsed).toBe(false);
  });

  it("retries send once after satisfied auth challenge and pushAuthState", async () => {
    let sessionCounter = 0;
    let sendAttempts = 0;
    let authStateUpdates = 0;
    let sse = createPushableSseStream();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
          sessionCounter += 1;
          return new Response(
            JSON.stringify({ sessionId: `session-${sessionCounter}` }),
            { status: 200 },
          );
        }
        if (url.includes("/api/mcp/events")) {
          sse = createPushableSseStream();
          return sse.response;
        }
        if (url.endsWith("/api/mcp/auth-state") && init?.method === "POST") {
          authStateUpdates += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
          sendAttempts += 1;
          const body = JSON.parse(String(init.body)) as {
            message: { id?: string | number };
          };
          if (sendAttempts === 1) {
            return new Response(
              JSON.stringify({
                ok: false,
                kind: "auth_challenge",
                authChallenge: { reason: "token_expired" },
              }),
              { status: 200 },
            );
          }
          sse.pushMessage({
            jsonrpc: "2.0",
            id: body.message.id,
            result: { tools: [] },
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const authProvider = {
      tokens: vi.fn().mockResolvedValue({
        access_token: "refreshed",
        token_type: "Bearer",
      }),
    };

    const transport = new RemoteClientTransport(
      {
        baseUrl,
        fetchFn: fetchFn as unknown as typeof fetch,
        sseResponseTimeoutMs: 2000,
        authProvider: authProvider as never,
      },
      config,
    );
    transport.setAuthRecovery({
      handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      pushAuthState: () => transport.pushAuthState(),
    });

    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(sendAttempts).toBe(2);
    expect(sessionCounter).toBe(1);
    expect(authStateUpdates).toBe(1);
    await transport.close();
  });

  it("forwards ambient auth_challenge SSE events to onAuthChallenge", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: "abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse(
          'data: {"type":"auth_challenge","data":{"reason":"token_expired"}}\n\n',
        ),
      );
    const onAuthChallenge = vi.fn();
    const transport = new RemoteClientTransport(
      {
        baseUrl,
        fetchFn: fetchFn as unknown as typeof fetch,
        onAuthChallenge,
      },
      config,
    );
    await transport.start();
    await vi.waitFor(() => expect(onAuthChallenge).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 10,
    });
    expect(onAuthChallenge.mock.calls[0]?.[0]).toEqual({
      reason: "token_expired",
    });
  });

  // #1935: the SDK Client calls setProtocolVersion() on this transport, but the
  // real HTTP transport lives on the backend — so the version has to ride the
  // send envelope or the backend drops `Mcp-Protocol-Version` upstream.
  it("forwards the negotiated protocol version on every send after setProtocolVersion", async () => {
    const seenBodies: string[] = [];
    let sse = createPushableSseStream();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect")) {
          return new Response(JSON.stringify({ sessionId: "abc" }), {
            status: 200,
          });
        }
        if (url.includes("/api/mcp/events")) {
          sse = createPushableSseStream();
          return sse.response;
        }
        if (url.endsWith("/api/mcp/send")) {
          seenBodies.push(String(init?.body));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const transport = new RemoteClientTransport({ baseUrl, fetchFn }, config);
    await transport.start();

    // Pre-initialize sends carry no version (none negotiated yet).
    await transport.send({ jsonrpc: "2.0", method: "notifications/cancelled" });
    expect(JSON.parse(seenBodies[0]!)).not.toHaveProperty("protocolVersion");

    transport.setProtocolVersion("2025-11-25");

    // The first post-initialize send is `notifications/initialized` — the one
    // the reporting server rejected for a missing header.
    await transport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await transport.send({ jsonrpc: "2.0", method: "notifications/cancelled" });

    expect(JSON.parse(seenBodies[1]!)).toMatchObject({
      protocolVersion: "2025-11-25",
      message: { method: "notifications/initialized" },
    });
    expect(JSON.parse(seenBodies[2]!)).toMatchObject({
      protocolVersion: "2025-11-25",
    });

    await transport.close();
  });

  // #2140: the Cancel button's wire signal is chosen by the SDK from the
  // transport's `hasPerRequestStream`. The real upstream transport lives on the
  // backend, so this transport answers for it — and must answer per server
  // type, since only Streamable HTTP gives a request a stream of its own to
  // close.
  describe("per-request-stream cancellation (#2140)", () => {
    it("advertises hasPerRequestStream only for streamable-http", () => {
      const forType = (c: MCPServerConfig) =>
        new RemoteClientTransport(
          { baseUrl, fetchFn: vi.fn<typeof fetch>() },
          c,
        ).hasPerRequestStream;

      expect(
        forType({ type: "streamable-http", url: "http://server.example/mcp" }),
      ).toBe(true);
      // stdio and SSE multiplex every request over one shared channel, so
      // aborting anything would cancel the whole session rather than the call.
      // The SDK must keep sending `notifications/cancelled` for them.
      expect(forType(config)).toBe(false);
      expect(forType({ type: "sse", url: "http://server.example/sse" })).toBe(
        false,
      );
    });

    it("applies the SDK's requestSignal to the browser-to-backend send fetch", async () => {
      const seenInits: (RequestInit | undefined)[] = [];
      let sse = createPushableSseStream();
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/api/mcp/connect")) {
            return new Response(JSON.stringify({ sessionId: "abc" }), {
              status: 200,
            });
          }
          if (url.includes("/api/mcp/events")) {
            sse = createPushableSseStream();
            return sse.response;
          }
          if (url.endsWith("/api/mcp/send")) {
            seenInits.push(init);
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        });

      const transport = new RemoteClientTransport({ baseUrl, fetchFn }, config);
      await transport.start();

      const controller = new AbortController();
      await transport.send(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { requestSignal: controller.signal },
      );
      expect(seenInits[0]?.signal).toBe(controller.signal);

      // No signal supplied (stdio/SSE, where the SDK never creates one) must
      // leave the fetch unaborted rather than passing `undefined` through as a
      // deliberate value.
      await transport.send({
        jsonrpc: "2.0",
        method: "notifications/roots/list_changed",
      });
      expect(seenInits[1]).not.toHaveProperty("signal");

      await transport.close();
    });

    it("aborting the requestSignal rejects the in-flight send", async () => {
      let sse = createPushableSseStream();
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/api/mcp/connect")) {
            return new Response(JSON.stringify({ sessionId: "abc" }), {
              status: 200,
            });
          }
          if (url.includes("/api/mcp/events")) {
            sse = createPushableSseStream();
            return sse.response;
          }
          if (url.endsWith("/api/mcp/send")) {
            // The backend holds this route open for the whole call, so model it
            // as a fetch that only settles when the caller aborts.
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            });
          }
          return new Response("not found", { status: 404 });
        });

      const transport = new RemoteClientTransport({ baseUrl, fetchFn }, config);
      await transport.start();

      const controller = new AbortController();
      const sent = transport.send(
        { jsonrpc: "2.0", id: 7, method: "tools/call" },
        { requestSignal: controller.signal },
      );

      controller.abort();
      // The backend never answers an aborted send, so the rejection has to come
      // from the fetch itself. `postSend` already cancels the SSE response wait
      // it registered for this id on that path (its catch does, unchanged by
      // #2140) — so the send surfaces the abort rather than the wait's timeout.
      await expect(sent).rejects.toThrow(/Aborted/);

      await transport.close();
    });
  });

  describe("progress notifications keep the SSE response wait alive (#2028)", () => {
    // A remote backend holds POST /api/mcp/send open until the JSON-RPC
    // response, and the browser bounds that wait with `sseResponseTimeoutMs`.
    // For a long tool that reports progress, that wait must re-arm on each
    // `notifications/progress` — mirroring the SDK client's
    // `resetTimeoutOnProgress` — or the web client alone times out a call that
    // every other transport rides out. Log messages must NOT re-arm it.
    function backendHoldingSend(): {
      fetchFn: typeof fetch;
      getSse: () => ReturnType<typeof createPushableSseStream>;
      getSentId: () => string | number | undefined;
    } {
      let sse!: ReturnType<typeof createPushableSseStream>;
      let sentId: string | number | undefined;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
            return new Response(JSON.stringify({ sessionId: "s-progress" }), {
              status: 200,
            });
          }
          if (url.includes("/api/mcp/events")) {
            sse = createPushableSseStream();
            return sse.response;
          }
          if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
            const body = JSON.parse(String(init.body)) as {
              message: { id?: string | number };
            };
            sentId = body.message.id;
            // Backend accepted the request; the response arrives later over SSE.
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        });
      return { fetchFn, getSse: () => sse, getSentId: () => sentId };
    }

    // Fake timers so the deadline is driven deterministically rather than
    // raced against a real `setTimeout` — a real-sleep test can let the timeout
    // fire before a loaded runner processes the enqueued SSE frame (#1596: a
    // race is fixed with fake timers, never with headroom). Each push is
    // followed by a 0ms async advance to flush the SSE consumer's stream read
    // so the frame is parsed before time moves.
    const TIMEOUT_MS = 1000;
    const flushSse = () => vi.advanceTimersByTimeAsync(0);

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("re-arms the wait on each progress note, so a call outliving the timeout still resolves", async () => {
      const { fetchFn, getSse, getSentId } = backendHoldingSend();
      const transport = new RemoteClientTransport(
        { baseUrl, fetchFn, sseResponseTimeoutMs: TIMEOUT_MS },
        config,
      );
      await transport.start();

      const sent = transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
      });
      await flushSse();

      // Three progress notes, each after 900ms (< the 1000ms window): without
      // the re-arm the wait dies at 1000ms, well before the third lands.
      for (let i = 0; i < 3; i++) {
        getSse().pushMessage({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: getSentId(), progress: i, total: 3 },
        });
        await flushSse();
        await vi.advanceTimersByTimeAsync(900);
      }
      getSse().pushMessage({
        jsonrpc: "2.0",
        id: getSentId(),
        result: { ok: true },
      });
      await flushSse();

      await expect(sent).resolves.toBeUndefined();
      await transport.close();
    });

    it("does not re-arm on notifications/message, so a log-only call still times out", async () => {
      const { fetchFn, getSse, getSentId } = backendHoldingSend();
      const transport = new RemoteClientTransport(
        { baseUrl, fetchFn, sseResponseTimeoutMs: TIMEOUT_MS },
        config,
      );
      await transport.start();

      const sent = transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
      });
      // Hold the expected rejection now (as the RemoteSession timeout tests do)
      // so it is asserted rather than suppressed by an empty catch.
      const rejection = expect(sent).rejects.toThrow(
        /Timed out waiting for MCP response on SSE/,
      );
      await flushSse();

      // A log message before the deadline must not extend it.
      getSse().pushMessage({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: { msg: "tick", token: getSentId() } },
      });
      await flushSse();
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

      await rejection;
      await transport.close();
    });
  });
});
