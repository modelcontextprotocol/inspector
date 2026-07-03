/**
 * Remote transport contract: HTTP ack + SSE payload, auth retry on send.
 */

import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { MessageTrackingTransport } from "@inspector/core/mcp/messageTrackingTransport.js";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";

const config = {
  type: "streamable-http" as const,
  url: "http://localhost/mcp",
};

/** SSE stream that can push MCP message events after /api/mcp/send accepts a request. */
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

describe("RemoteClientTransport send contract", () => {
  it("waits for SSE response after HTTP ok:true and completes within 1s", async () => {
    const sse = createPushableSseStream();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
          return new Response(JSON.stringify({ sessionId: "s1" }), {
            status: 200,
          });
        }
        if (url.includes("/api/mcp/events")) {
          return sse.response;
        }
        if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            message: { id?: string | number; method?: string };
          };
          sse.pushMessage({
            jsonrpc: "2.0",
            id: body.message.id,
            result: { tools: [] },
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const transport = new RemoteClientTransport(
      {
        baseUrl: "http://remote.test/",
        fetchFn: fetchFn as unknown as typeof fetch,
        sseResponseTimeoutMs: 2000,
      },
      config,
    );

    await transport.start();

    const started = Date.now();
    await transport.send({ jsonrpc: "2.0", id: 7, method: "tools/list" });
    expect(Date.now() - started).toBeLessThan(1000);

    await transport.close();
  });

  it("times out within 5s when HTTP ok:true but no SSE response arrives", async () => {
    const sse = createPushableSseStream();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
          return new Response(JSON.stringify({ sessionId: "s1" }), {
            status: 200,
          });
        }
        if (url.includes("/api/mcp/events")) {
          return sse.response;
        }
        if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const transport = new RemoteClientTransport(
      {
        baseUrl: "http://remote.test/",
        fetchFn: fetchFn as unknown as typeof fetch,
        sseResponseTimeoutMs: 500,
      },
      config,
    );

    await transport.start();

    const started = Date.now();
    await expect(
      transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ).rejects.toThrow(/Timed out waiting for MCP response on SSE/i);
    expect(Date.now() - started).toBeLessThan(5000);

    await transport.close();
  });

  it("retries send once after satisfied auth challenge and pushAuthState", async () => {
    const sse = createPushableSseStream();
    let sendCalls = 0;
    let connectCalls = 0;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
          connectCalls += 1;
          return new Response(
            JSON.stringify({ sessionId: `s${connectCalls}` }),
            { status: 200 },
          );
        }
        if (url.includes("/api/mcp/events")) {
          return sse.response;
        }
        if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
          sendCalls += 1;
          const body = JSON.parse(String(init.body)) as {
            message: { id?: string | number };
          };
          if (sendCalls === 1) {
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
            result: { tools: [{ name: "echo" }] },
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    const pushAuthState = vi.fn().mockResolvedValue(undefined);

    const transport = new RemoteClientTransport(
      {
        baseUrl: "http://remote.test/",
        fetchFn: fetchFn as unknown as typeof fetch,
        sseResponseTimeoutMs: 2000,
        authRecovery: {
          handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
          pushAuthState,
        },
      },
      config,
    );

    await transport.start();

    const started = Date.now();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(sendCalls).toBe(2);
    expect(connectCalls).toBe(1);
    expect(pushAuthState).toHaveBeenCalledTimes(1);

    await transport.close();
  });

  it("SDK listTools succeeds through full stack after auth retry", async () => {
    let sse = createPushableSseStream();
    let sendCalls = 0;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/mcp/connect") && init?.method === "POST") {
          return new Response(JSON.stringify({ sessionId: "s1" }), {
            status: 200,
          });
        }
        if (url.includes("/api/mcp/events")) {
          sse = createPushableSseStream();
          return sse.response;
        }
        if (url.endsWith("/api/mcp/auth-state") && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/api/mcp/send") && init?.method === "POST") {
          sendCalls += 1;
          const body = JSON.parse(String(init.body)) as {
            message: { method?: string; id?: string | number };
          };
          if (body.message.method === "initialize") {
            sse.pushMessage({
              jsonrpc: "2.0",
              id: body.message.id,
              result: {
                protocolVersion: LATEST_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "test", version: "1.0.0" },
              },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          if (body.message.method === "tools/list") {
            if (sendCalls === 2) {
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
              result: {
                tools: [{ name: "echo", inputSchema: { type: "object" } }],
              },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
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
        baseUrl: "http://remote.test/",
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
    const wrapped = new MessageTrackingTransport(transport, {});
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(wrapped);

    const started = Date.now();
    const result = await client.listTools();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.tools).toHaveLength(1);

    await transport.close();
  });
});
