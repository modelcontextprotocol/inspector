import { describe, it, expect, vi } from "vitest";
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
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
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
});
