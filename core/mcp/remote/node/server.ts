/**
 * Hono-based remote server for MCP transports.
 * Hosts /api/config, /api/mcp/connect, send, events, disconnect, /api/fetch, /api/log,
 * /api/storage/:storeId, /api/servers (+ /api/servers/:id).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type pino from "pino";
import {
  getDefaultStorageDir,
  getDefaultMcpConfigPath,
  getStoreFilePath,
  validateStoreId,
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
  parseStore,
  serializeStore,
} from "../../../storage/store-io.js";
import type { LogEvent } from "pino";
import { Hono } from "hono";
import type { Context, Env, Next } from "hono";
import { streamSSE } from "hono/streaming";
import { createTransportNode } from "../../node/transport.js";
import type { RemoteConnectRequest, RemoteSendRequest } from "../types.js";
import type { MCPConfig, MCPServerConfig } from "../../types.js";
import {
  DEFAULT_SEED_CONFIG,
  normalizeServerType,
} from "../../serverList.js";
import { RemoteSession } from "./remote-session.js";
import { createTokenAuthProvider } from "./tokenAuthProvider.js";
import { API_SERVER_ENV_VARS } from "../constants.js";

/**
 * Shape of the initial config returned by GET /api/config (defaults for client).
 */
export interface InitialConfigPayload {
  defaultCommand?: string;
  defaultArgs?: string[];
  defaultTransport?: string;
  defaultServerUrl?: string;
  defaultHeaders?: Record<string, string>;
  defaultCwd?: string;
  defaultEnvironment: Record<string, string>;
}

export interface RemoteServerOptions {
  /** Optional auth token. If not provided, uses API_SERVER_ENV_VARS.AUTH_TOKEN env var or generates one. Ignored when dangerouslyOmitAuth is true. */
  authToken?: string;

  /**
   * When true, do not require x-mcp-remote-auth on API routes.
   * Origin validation (allowedOrigins) still applies.
   * Set via DANGEROUSLY_OMIT_AUTH env var; not recommended for any exposed deployment.
   */
  dangerouslyOmitAuth?: boolean;

  /** Optional: validate Origin header against allowed origins (for CORS) */
  allowedOrigins?: string[];

  /** Optional pino file logger. When set, /api/log forwards received events to it. */
  logger?: pino.Logger;

  /** Optional storage directory for /api/storage/:storeId. Default: ~/.mcp-inspector/storage */
  storageDir?: string;

  /** Optional path for the user's server list file (/api/servers). Default: ~/.mcp-inspector/mcp.json */
  mcpConfigPath?: string;

  /** Optional sandbox URL for MCP Apps tab. When set, GET /api/config includes sandboxUrl. */
  sandboxUrl?: string;

  /** Initial config for GET /api/config. Caller must pass this (e.g. from webServerConfigToInitialPayload(config)). */
  initialConfig: InitialConfigPayload;
}

export interface CreateRemoteAppResult {
  /** The Hono app */
  app: Hono;
  /** The auth token (from options, env var, or generated). Returned so caller can embed in client. */
  authToken: string;
}

/**
 * Hono middleware for origin validation (CORS and DNS rebinding protection).
 * Validates Origin header against allowedOrigins if provided.
 */
function createOriginMiddleware(allowedOrigins?: string[]) {
  return async (c: Context, next: Next) => {
    // If no allowedOrigins configured, skip validation (allow all)
    if (!allowedOrigins || allowedOrigins.length === 0) {
      await next();
      return;
    }

    const origin = c.req.header("origin");

    // Handle CORS preflight requests
    if (c.req.method === "OPTIONS") {
      if (origin && allowedOrigins.includes(origin)) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        c.header(
          "Access-Control-Allow-Headers",
          "Content-Type, x-mcp-remote-auth",
        );
        c.header("Access-Control-Max-Age", "86400"); // 24 hours
        return c.body(null, 204);
      }
      // Invalid origin for preflight - return 403
      return c.json(
        {
          error: "Forbidden",
          message:
            "Invalid origin. Request blocked to prevent DNS rebinding attacks.",
        },
        403,
      );
    }

    // For actual requests, validate origin if present
    if (origin) {
      if (!allowedOrigins.includes(origin)) {
        return c.json(
          {
            error: "Forbidden",
            message:
              "Invalid origin. Request blocked to prevent DNS rebinding attacks. Configure allowed origins via allowedOrigins option.",
          },
          403,
        );
      }
      // Set CORS header for allowed origin
      c.header("Access-Control-Allow-Origin", origin);
    }
    // If no origin header (same-origin or non-browser client), allow request

    await next();
  };
}

/**
 * Hono middleware for auth token validation.
 * Expects Bearer token format: x-mcp-remote-auth: Bearer <token>
 */
function createAuthMiddleware(authToken: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("x-mcp-remote-auth");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: "Unauthorized",
          message:
            "Authentication required. Use the x-mcp-remote-auth header with Bearer token.",
        },
        401,
      );
    }

    const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    const expectedToken = authToken;

    // Convert to buffers for timing-safe comparison
    const providedBuffer = Buffer.from(providedToken);
    const expectedBuffer = Buffer.from(expectedToken);

    // Check length first to prevent timing attacks
    if (providedBuffer.length !== expectedBuffer.length) {
      return c.json(
        {
          error: "Unauthorized",
          message:
            "Authentication required. Use the x-mcp-remote-auth header with Bearer token.",
        },
        401,
      );
    }

    // Perform timing-safe comparison
    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      return c.json(
        {
          error: "Unauthorized",
          message:
            "Authentication required. Use the x-mcp-remote-auth header with Bearer token.",
        },
        401,
      );
    }

    await next();
  };
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

export function createRemoteApp(
  options: RemoteServerOptions,
): CreateRemoteAppResult {
  const dangerouslyOmitAuth = !!options.dangerouslyOmitAuth;

  // Determine auth token when auth is enabled: options > env var > generate
  const authToken = dangerouslyOmitAuth
    ? ""
    : options.authToken ||
      process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ||
      randomBytes(32).toString("hex");

  const app = new Hono<Env>();
  const sessions = new Map<string, RemoteSession>();
  const { logger: fileLogger, allowedOrigins } = options;
  const storageDir = options.storageDir ?? getDefaultStorageDir();
  const mcpConfigPath = options.mcpConfigPath ?? getDefaultMcpConfigPath();

  // Apply origin validation middleware first (before auth)
  // This prevents DNS rebinding attacks by validating Origin header
  app.use("*", createOriginMiddleware(allowedOrigins));

  // Apply auth middleware unless dangerously omitted
  if (!dangerouslyOmitAuth) {
    app.use("*", createAuthMiddleware(authToken));
  }

  app.get("/api/config", (c) => {
    const payload = options.sandboxUrl
      ? { ...options.initialConfig, sandboxUrl: options.sandboxUrl }
      : options.initialConfig;
    return c.json(payload);
  });

  app.post("/api/mcp/connect", async (c) => {
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
      // Create authProvider from tokens if provided
      const authProvider = createTokenAuthProvider(body.oauthTokens);

      const result = createTransportNode(config, {
        pipeStderr: true,
        onStderr: (entry) => session.onStderr(entry),
        onFetchRequest: (entry) => session.onFetchRequest(entry),
        authProvider,
      });
      transport = result.transport;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to create transport: ${msg}` }, 500);
    }

    session.setTransport(transport);
    transport.onmessage = (msg) => session.onMessage(msg);

    // Track if transport closes/errors during start - this matches local behavior
    // If transport.start() throws, we catch it. If it resolves but transport closes immediately,
    // we detect that too (process failure after spawn).
    let transportFailed = false;
    let transportError: string | null = null;

    const originalOnclose = transport.onclose;
    const originalOnerror = transport.onerror;

    // Set up error handlers BEFORE calling start() so we catch failures during start
    transport.onerror = (err) => {
      transportFailed = true;
      transportError = err instanceof Error ? err.message : String(err);
      originalOnerror?.(err);
    };

    transport.onclose = () => {
      const session = sessions.get(sessionId);
      if (session) {
        // Mark transport as dead but don't delete session yet
        // We'll notify client via SSE and cleanup when client disconnects
        const errorMsg =
          transportError || "Transport closed - process may have exited";
        session.markTransportDead(errorMsg);
        // If no client connected yet, the client may still be about to
        // open /api/mcp/events for this session — common path when the
        // subprocess fails during startup, after we've already returned
        // 200 with the sessionId. Hold the session (with the queued
        // stderr + transport_error event) for a grace window so the
        // events endpoint can drain them and surface a real error to
        // the user. The endpoint cleans up on stream close; this TTL
        // sweeps sessions whose client never connects at all.
        if (!session.hasEventConsumer()) {
          setTimeout(() => {
            const stale = sessions.get(sessionId);
            if (stale && !stale.hasEventConsumer()) {
              sessions.delete(sessionId);
            }
          }, 30_000);
        }
      } else {
        // Session not created yet - failed during start
        transportFailed = true;
        transportError =
          transportError ||
          "Transport closed during start - process may have failed";
      }
      originalOnclose?.();
    };

    try {
      // transport.start() should throw if process fails to start
      // If it resolves, the process should be running
      await transport.start();

      // Check if transport failed during start (onerror/onclose fired synchronously)
      if (transportFailed) {
        const errorMsg = transportError || "Transport failed during start";
        return c.json({ error: `Failed to start transport: ${errorMsg}` }, 500);
      }
    } catch (err) {
      // transport.start() threw - this is the expected failure path
      const msg = err instanceof Error ? err.message : String(err);
      // Preserve 401 only when the transport/SDK reports it (no message guessing)
      const status =
        (err as { code?: number; status?: number }).code ??
        (err as { code?: number; status?: number }).status;
      const is401 = status === 401;
      return c.json(
        { error: `Failed to start transport: ${msg}` },
        is401 ? 401 : 500,
      );
    }

    // Transport started successfully - add to sessions
    sessions.set(sessionId, session);

    return c.json({ sessionId });
  });

  app.post("/api/mcp/send", async (c) => {
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

    // Check if transport is dead - return error immediately (matches local behavior)
    if (session.isTransportDead()) {
      const errorMsg = session.getTransportError() || "Transport closed";
      return c.json({ error: errorMsg }, 500);
    }

    try {
      await session.transport.send(message, {
        relatedRequestId: relatedRequestId as string | number | undefined,
      });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Preserve 401 only when the transport/SDK reports it (no message guessing)
      const status =
        (err as { code?: number; status?: number }).code ??
        (err as { code?: number; status?: number }).status;
      const is401 = status === 401;
      return c.json({ error: msg }, is401 ? 401 : 500);
    }
  });

  app.get("/api/mcp/events", async (c) => {
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

      // Crash-on-startup path: if the subprocess died between POST
      // /api/mcp/connect (which returned 200) and this GET, the session is
      // alive but the transport is dead. setEventConsumer above just
      // drained the queued stderr + the transport_error event. Yield once
      // so the writeSSE writes flush, then return — closing the stream and
      // surfacing the real error instead of a bare 404 / silent hang.
      if (session.isTransportDead()) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        session.clearEventConsumer();
        sessions.delete(sessionId);
        return;
      }

      stream.onAbort(() => {
        // Client disconnected - clear event consumer
        const shouldCleanup = session.clearEventConsumer();
        stream.close();

        // If transport is dead and no client connected, cleanup session
        if (shouldCleanup || session.isTransportDead()) {
          sessions.delete(sessionId);
        }
      });

      // Keep the stream open until the client disconnects. Hono's streamSSE
      // closes the stream when this callback returns, so we must not return
      // until the connection is aborted.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          // Cleanup happens in onAbort handler above
          resolve();
        });
      });
    });
  });

  app.post("/api/mcp/disconnect", async (c) => {
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
    const body = (await c.req.json().catch(() => ({}))) as Partial<LogEvent>;
    if (fileLogger) {
      forwardLogEvent(fileLogger, body);
    }
    return c.json({ ok: true });
  });

  app.get("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }

    const filePath = getStoreFilePath(storageDir, storeId);

    try {
      const raw = await readStoreFile(filePath);
      if (raw === null) {
        return c.json({}, 200);
      }
      const store = parseStore(raw);
      return c.json(store);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to read store: ${msg}` }, 500);
    }
  });

  app.post("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const filePath = getStoreFilePath(storageDir, storeId);

    try {
      const jsonData = serializeStore(body);
      await writeStoreFile(filePath, jsonData);
      return c.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to write store: ${msg}` }, 500);
    }
  });

  app.delete("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }

    const filePath = getStoreFilePath(storageDir, storeId);

    try {
      await deleteStoreFile(filePath);
      return c.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to delete store: ${msg}` }, 500);
    }
  });

  // --- /api/servers (server list backed by mcp.json) ---

  // Defensive normalize so editor-edited files with type:"http" or missing
  // type round-trip into the canonical form on every read.
  const normalizeMcpServers = (raw: unknown): Record<string, MCPServerConfig> => {
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, MCPServerConfig> = {};
    for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!val || typeof val !== "object") continue;
      out[id] = normalizeServerType(
        val as Record<string, unknown> & { type?: string },
      );
    }
    return out;
  };

  // In-process serialization for the read-modify-write flow on the
  // mutating routes (POST/PUT/DELETE). `atomically` guarantees torn-write
  // safety on the file itself, but two concurrent requests can both read the
  // same baseline and the second write clobbers the first. Single-user local
  // dev tool, so this is a guardrail rather than a hot-path concern, but it
  // avoids a real lost-update once file watching (#1345) or any remote/
  // multi-client usage lands.
  let writeQueue: Promise<void> = Promise.resolve();
  const withWriteLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = writeQueue;
    let release: () => void = () => {};
    writeQueue = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  };

  // Load current config from disk. ENOENT → empty. A valid-JSON file without
  // `mcpServers` is treated as empty (the user may have deliberately wiped it
  // or a future field arrived above the key). Invalid JSON surfaces a 500
  // from the route's outer try — we'd rather flag corruption than silently
  // present "no servers" and let the next write clobber the broken file.
  // The seed-write on first GET happens in the route, not here, so mutating
  // routes don't accidentally trigger it.
  const readMcpConfig = async (): Promise<MCPConfig> => {
    const raw = await readStoreFile(mcpConfigPath);
    if (raw === null) return { mcpServers: {} };
    const parsed = parseStore(raw) as { mcpServers?: unknown } | null;
    return { mcpServers: normalizeMcpServers(parsed?.mcpServers) };
  };

  app.get("/api/servers", async (c) => {
    try {
      const raw = await readStoreFile(mcpConfigPath);
      if (raw === null) {
        await writeStoreFile(mcpConfigPath, serializeStore(DEFAULT_SEED_CONFIG));
        return c.json(DEFAULT_SEED_CONFIG);
      }
      const parsed = parseStore(raw) as { mcpServers?: unknown } | null;
      return c.json({ mcpServers: normalizeMcpServers(parsed?.mcpServers) });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to read server list: ${msg}` }, 500);
    }
  });

  app.post("/api/servers", async (c) => {
    let body: { id?: unknown; config?: unknown };
    try {
      body = (await c.req.json()) as { id?: unknown; config?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body.id !== "string" || !validateStoreId(body.id)) {
      return c.json(
        {
          error:
            "Invalid id: must be non-empty and contain only alphanumeric, hyphen, or underscore",
        },
        400,
      );
    }
    if (!body.config || typeof body.config !== "object") {
      return c.json({ error: "Missing or invalid config" }, 400);
    }
    const id = body.id;

    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (id in current.mcpServers) {
          return c.json({ error: `Server '${id}' already exists` }, 409);
        }
        current.mcpServers[id] = normalizeServerType(
          body.config as Record<string, unknown> & { type?: string },
        );
        await writeStoreFile(mcpConfigPath, serializeStore(current));
        return c.json({ ok: true });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to add server: ${msg}` }, 500);
    }
  });

  app.put("/api/servers/:id", async (c) => {
    const originalId = c.req.param("id");
    if (!originalId || !validateStoreId(originalId)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    let body: { id?: unknown; config?: unknown };
    try {
      body = (await c.req.json()) as { id?: unknown; config?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!body.config || typeof body.config !== "object") {
      return c.json({ error: "Missing or invalid config" }, 400);
    }
    const newId = typeof body.id === "string" ? body.id : originalId;
    if (!validateStoreId(newId)) {
      return c.json({ error: "Invalid new id" }, 400);
    }

    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (!(originalId in current.mcpServers)) {
          return c.json({ error: `Server '${originalId}' not found` }, 404);
        }
        if (newId !== originalId && newId in current.mcpServers) {
          return c.json({ error: `Server '${newId}' already exists` }, 409);
        }
        // Rebuild preserving insertion order; replace the original key in place
        // so the file diff stays minimal when not renaming.
        const next: MCPConfig = { mcpServers: {} };
        for (const [key, val] of Object.entries(current.mcpServers)) {
          if (key === originalId) {
            next.mcpServers[newId] = normalizeServerType(
              body.config as Record<string, unknown> & { type?: string },
            );
          } else {
            next.mcpServers[key] = val;
          }
        }
        await writeStoreFile(mcpConfigPath, serializeStore(next));
        return c.json({ ok: true });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to update server: ${msg}` }, 500);
    }
  });

  app.delete("/api/servers/:id", async (c) => {
    const id = c.req.param("id");
    if (!id || !validateStoreId(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (!(id in current.mcpServers)) {
          return c.json({ ok: true });
        }
        delete current.mcpServers[id];
        await writeStoreFile(mcpConfigPath, serializeStore(current));
        return c.json({ ok: true });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to delete server: ${msg}` }, 500);
    }
  });

  return { app, authToken };
}
