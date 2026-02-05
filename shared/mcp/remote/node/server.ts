/**
 * Hono-based remote server for MCP transports.
 * Hosts /api/mcp/connect, send, events, disconnect, /api/fetch, /api/log.
 */

import { timingSafeEqual } from "node:crypto";
import type pino from "pino";
import type { LogEvent } from "pino";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createTransportNode } from "../../node/transport.js";
import type { RemoteConnectRequest, RemoteSendRequest } from "../types.js";
import type { MCPServerConfig } from "../../types.js";
import { RemoteSession } from "./remote-session.js";

export interface RemoteServerOptions {
  /** Optional auth token. If set, all requests require x-mcp-remote-auth header. */
  authToken?: string;

  /** Optional: validate Origin header against allowed origins (for CORS) */
  allowedOrigins?: string[];

  /** Optional pino file logger. When set, /api/log forwards received events to it. */
  logger?: pino.Logger;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Returns a 401 Response if auth fails; otherwise null (caller may proceed). */
function requireAuth(
  c: {
    req: { header: (n: string) => string | undefined };
    json: (body: unknown, status?: number) => Response;
  },
  authToken: string | undefined,
): Response | null {
  if (!authToken) return null;
  const provided = c.req.header("x-mcp-remote-auth");
  if (!provided) {
    return c.json({ error: "Missing x-mcp-remote-auth header" }, 401);
  }
  if (!safeCompare(provided, authToken)) {
    return c.json({ error: "Invalid x-mcp-remote-auth" }, 401);
  }
  return null;
}

function forwardLogEvent(
  logger: pino.Logger,
  logEvent: Partial<LogEvent>,
): void {
  const levelLabel = (logEvent?.level?.label ?? "info").toLowerCase();
  const method = (logger as unknown as Record<string, unknown>)[levelLabel];
  if (typeof method !== "function") return;

  const bindings = Object.assign(
    {},
    ...(Array.isArray(logEvent.bindings) ? logEvent.bindings : []),
  );
  const messages = Array.isArray(logEvent.messages) ? logEvent.messages : [];

  if (messages.length === 0) {
    (method as (obj: object) => void).call(logger, bindings);
    return;
  }

  const first = messages[0];
  if (typeof first === "object" && first !== null && !Array.isArray(first)) {
    const obj = { ...bindings, ...(first as Record<string, unknown>) };
    const msg = messages[1];
    const args = messages.slice(2);
    (method as (obj: object, msg?: unknown, ...args: unknown[]) => void).call(
      logger,
      obj,
      msg,
      ...args,
    );
  } else {
    const msg = messages[0];
    const args = messages.slice(1);
    (method as (obj: object, msg?: unknown, ...args: unknown[]) => void).call(
      logger,
      bindings,
      msg,
      ...args,
    );
  }
}

export function createRemoteApp(options: RemoteServerOptions = {}): Hono {
  const app = new Hono();
  const sessions = new Map<string, RemoteSession>();
  const { authToken, logger: fileLogger } = options;

  app.post("/api/mcp/connect", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    let body: RemoteConnectRequest;
    try {
      body = (await c.req.json()) as RemoteConnectRequest;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const config = body.config as MCPServerConfig;
    if (!config) {
      return c.json({ error: "Missing config" }, 400);
    }

    const sessionId = crypto.randomUUID();
    const session = new RemoteSession(sessionId);

    let transport: Awaited<ReturnType<typeof createTransportNode>>["transport"];
    try {
      const result = createTransportNode(config, {
        pipeStderr: true,
        onStderr: (entry) => session.onStderr(entry),
        onFetchRequest: (entry) => session.onFetchRequest(entry),
      });
      transport = result.transport;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to create transport: ${msg}` }, 500);
    }

    session.setTransport(transport);
    transport.onmessage = (msg) => session.onMessage(msg);
    transport.onclose = () => {
      sessions.delete(sessionId);
    };

    try {
      await transport.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to start transport: ${msg}` }, 500);
    }
    sessions.set(sessionId, session);

    return c.json({ sessionId });
  });

  app.post("/api/mcp/send", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    let body: RemoteSendRequest & { sessionId?: string };
    try {
      body = (await c.req.json()) as RemoteSendRequest & { sessionId?: string };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { sessionId, message, relatedRequestId } = body;
    if (!sessionId || !message) {
      return c.json({ error: "Missing sessionId or message" }, 400);
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      await session.transport.send(message, {
        relatedRequestId: relatedRequestId as string | number | undefined,
      });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/api/mcp/events", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    const sessionId = c.req.query("sessionId");
    if (!sessionId) {
      return c.json({ error: "Missing sessionId query" }, 400);
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      session.setEventConsumer((event) => {
        const data = JSON.stringify(event);
        void stream.writeSSE({
          event: event.type,
          data,
        });
      });

      stream.onAbort(() => {
        session.clearEventConsumer();
        stream.close();
      });

      // Keep the stream open until the client disconnects. Hono's streamSSE
      // closes the stream when this callback returns, so we must not return
      // until the connection is aborted.
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  app.post("/api/mcp/disconnect", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    let body: { sessionId?: string };
    try {
      body = (await c.req.json()) as { sessionId?: string };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const sessionId = body.sessionId;
    if (!sessionId) {
      return c.json({ error: "Missing sessionId" }, 400);
    }

    const session = sessions.get(sessionId);
    if (session) {
      session.clearEventConsumer();
      await session.transport.close();
      sessions.delete(sessionId);
    }

    return c.json({ ok: true });
  });

  app.post("/api/fetch", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    let body: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { url, method = "GET", headers = {}, body: reqBody } = body;
    if (!url) {
      return c.json({ error: "Missing url" }, 400);
    }

    try {
      const res = await fetch(url, {
        method,
        headers: new Headers(headers),
        body: reqBody,
      });

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });

      const contentType = res.headers.get("content-type");
      const isStream =
        contentType?.includes("text/event-stream") ||
        contentType?.includes("application/x-ndjson");
      let resBody: string | undefined;
      if (!isStream && res.body) {
        resBody = await res.text();
      }

      return c.json({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: resBody,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/api/log", async (c) => {
    const authErr = requireAuth(c, authToken);
    if (authErr) return authErr;

    const body = (await c.req.json().catch(() => ({}))) as Partial<LogEvent>;
    if (fileLogger) {
      forwardLogEvent(fileLogger, body);
    } else {
      console.log("[remote-log]", body);
    }
    return c.json({ ok: true });
  });

  return app;
}
