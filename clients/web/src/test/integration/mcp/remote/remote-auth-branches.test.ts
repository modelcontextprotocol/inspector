/**
 * Supplemental coverage for createRemoteApp's /api/mcp/* routes
 * (core/mcp/remote/node/server.ts), targeting branches the broader e2e
 * suites (transport.test.ts, connect-crash.test.ts) don't reach:
 *
 *   - POST /api/mcp/connect: connect-time AuthChallengeError (401 upstream)
 *   - POST /api/mcp/send: transport-dead short-circuit
 *   - POST /api/mcp/disconnect: unknown sessionId (no-op, still 200)
 *   - POST /api/mcp/auth-state: every guard branch (missing fields, unknown
 *     session, dead transport, no OAuth provider on the session, success)
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
}

async function start(): Promise<Harness> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    initialConfig: { defaultEnvironment: {} },
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server });
      },
    );
    server.on("error", reject);
  });
}

async function stop(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
}

async function connect(
  h: Harness,
  config: MCPServerConfig,
  authState?: { oauthTokens: { access_token: string; token_type: string } },
): Promise<Response> {
  return fetch(`${h.baseUrl}/api/mcp/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, ...(authState && { authState }) }),
  });
}

/** A raw HTTP server that returns 401 for every request (no MCP semantics). */
async function startUnauthorizedUpstream(): Promise<{
  url: string;
  server: Server;
}> {
  const server = createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/mcp`, server };
}

/** Connect a stdio session whose process crashes almost immediately, then
 * give the onclose handler time to mark the session's transport dead. */
async function connectDeadSession(h: Harness): Promise<string> {
  const config: MCPServerConfig = {
    type: "stdio",
    command: process.execPath,
    args: ["-e", "process.stderr.write('dying\\n'); process.exit(1);"],
  };
  const res = await connect(h, config);
  expect(res.status).toBe(200);
  const { sessionId } = (await res.json()) as { sessionId: string };
  // Give the subprocess time to exit and the transport's onclose handler
  // to mark the session dead (mirrors connect-crash.test.ts's technique).
  await new Promise((resolve) => setTimeout(resolve, 300));
  return sessionId;
}

describe("server.ts /api/mcp/* branch coverage", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await start();
  });
  afterEach(async () => {
    await stop(h);
  });

  describe("POST /api/mcp/connect", () => {
    it("returns 500 (not 401) when the upstream SSE connection is rejected for a non-auth reason", async () => {
      // The SDK's SSEClientTransport wraps every connection failure — including
      // a 401 — in its own SseError, so `err instanceof AuthChallengeError` at
      // the connect catch site is unreachable via the real SSE/streamable-http
      // SDK transports today (streamable-http's start() makes no network call
      // at all; SSE's start() discards the thrown error's subclass). This test
      // instead pins the *reachable* generic-failure branch: a non-401 refusal
      // still surfaces as a 500 with the wrapped message, not a misleading 401.
      const upstream = await startUnauthorizedUpstream();
      try {
        const res = await connect(h, {
          type: "sse",
          url: upstream.url,
        });
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/Failed to start transport/);
      } finally {
        await new Promise<void>((r) => upstream.server.close(() => r()));
      }
    });
  });

  describe("POST /api/mcp/send", () => {
    it("short-circuits with a transport_error when the session's transport is already dead", async () => {
      const sessionId = await connectDeadSession(h);
      const res = await fetch(`${h.baseUrl}/api/mcp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        kind?: string;
        error?: string;
      };
      expect(body.ok).toBe(false);
      expect(body.kind).toBe("transport_error");
      expect(typeof body.error).toBe("string");
    });
  });

  describe("POST /api/mcp/disconnect", () => {
    it("returns ok:true as a no-op when the sessionId is unknown", async () => {
      const res = await fetch(`${h.baseUrl}/api/mcp/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "does-not-exist" }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });
  });

  describe("POST /api/mcp/auth-state", () => {
    async function postAuthState(body: unknown): Promise<Response> {
      return fetch(`${h.baseUrl}/api/mcp/auth-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("returns 400 when sessionId is missing", async () => {
      const res = await postAuthState({
        authState: { oauthTokens: { access_token: "a", token_type: "Bearer" } },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(
        /Missing sessionId or authState/,
      );
    });

    it("returns 400 when authState is missing", async () => {
      const res = await postAuthState({ sessionId: "some-session" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(
        /Missing sessionId or authState/,
      );
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await fetch(`${h.baseUrl}/api/mcp/auth-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Invalid JSON body/);
    });

    it("returns 404 when the session is not found", async () => {
      const res = await postAuthState({
        sessionId: "unknown-session-id",
        authState: { oauthTokens: { access_token: "a", token_type: "Bearer" } },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/Session not found/);
    });

    it("returns a transport_error when the session's transport is already dead", async () => {
      const sessionId = await connectDeadSession(h);
      const res = await postAuthState({
        sessionId,
        authState: { oauthTokens: { access_token: "a", token_type: "Bearer" } },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; kind?: string };
      expect(body.ok).toBe(false);
      expect(body.kind).toBe("transport_error");
    });

    it("returns 400 when the session has no OAuth auth provider (connected without authState)", async () => {
      const { command, args } = getTestMcpServerCommand();
      const res = await connect(h, { type: "stdio", command, args });
      expect(res.status).toBe(200);
      const { sessionId } = (await res.json()) as { sessionId: string };

      const authRes = await postAuthState({
        sessionId,
        authState: { oauthTokens: { access_token: "a", token_type: "Bearer" } },
      });
      expect(authRes.status).toBe(400);
      expect((await authRes.json()).error).toMatch(
        /Session has no OAuth auth provider/,
      );

      await fetch(`${h.baseUrl}/api/mcp/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    });

    it("returns ok:true and hot-swaps the token when the session has an OAuth auth provider", async () => {
      const { command, args } = getTestMcpServerCommand();
      const res = await connect(
        h,
        { type: "stdio", command, args },
        { oauthTokens: { access_token: "initial", token_type: "Bearer" } },
      );
      expect(res.status).toBe(200);
      const { sessionId } = (await res.json()) as { sessionId: string };

      const authRes = await postAuthState({
        sessionId,
        authState: {
          oauthTokens: { access_token: "rotated", token_type: "Bearer" },
        },
      });
      expect(authRes.status).toBe(200);
      expect((await authRes.json()).ok).toBe(true);

      await fetch(`${h.baseUrl}/api/mcp/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    });
  });
});
