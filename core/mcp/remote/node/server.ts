/**
 * Hono-based remote server for MCP transports.
 * Hosts /api/config, /api/mcp/connect, send, events, disconnect, /api/fetch, /api/log,
 * /api/storage/:storeId, /api/servers (+ /api/servers/:id).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { stat as fsStat } from "node:fs/promises";
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
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { createTransportNode } from "../../node/transport.js";
import type { RemoteConnectRequest, RemoteSendRequest } from "../types.js";
import type {
  InspectorServerSettings,
  MCPConfig,
  MCPServerConfig,
  StoredMCPServer,
} from "../../types.js";
import {
  DEFAULT_SEED_CONFIG,
  INSPECTOR_FIELD_KEYS,
  inspectorSettingsToStoredFields,
  normalizeServerType,
  storedFieldsToInspectorSettings,
  stripInspectorFields,
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
  /**
   * Tear down stateful resources owned by the app (currently the lazy
   * chokidar watcher behind `/api/servers/events`). Long-lived prod callers
   * (the standalone server, the vite dev plugin) chain this into their own
   * HTTP-server close so the watcher is released on shutdown. Tests that
   * exercise SSE should call it in teardown — tests that never subscribe
   * never start the watcher and can omit it without leaking.
   *
   * Resolves once the subscriber set is cleared and the watcher is closed.
   * Individual SSE stream callbacks held inside `streamSSE` are not awaited
   * here — they resolve on their own when the underlying socket aborts.
   * Callers that need to be sure those have settled (e.g. the standalone
   * server) should call `httpServer.closeAllConnections()` *after* this.
   */
  close: () => Promise<void>;
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

  // --- /api/servers/events: file-watch fanout state -----------------------
  //
  // Subscribers are SSE writers added by GET /api/servers/events and removed
  // on stream abort. The chokidar watcher is created lazily on the first
  // subscription and torn down again when the last one leaves, so tests (and
  // headless tools) that never open the channel never spin up a real fs
  // watcher. The `lastWrittenMtimeMs` field is captured after every write we
  // initiate ourselves; the watcher handler stat()s on each event and
  // suppresses the broadcast if the mtime matches — that's how we avoid
  // refreshing every connected browser tab for our own POST/PUT/DELETE.
  const serverEventSubscribers = new Set<(data: string) => void>();
  let mcpConfigWatcher: FSWatcher | null = null;
  let lastWrittenMtimeMs: number | null = null;

  const broadcastServerListChange = (): void => {
    const payload = JSON.stringify({ type: "change" });
    for (const send of serverEventSubscribers) {
      try {
        send(payload);
      } catch {
        // Each subscriber owns its own write loop and cleans itself up in
        // onAbort; swallowing here keeps one bad stream from blocking the
        // fanout to the rest.
      }
    }
  };

  const writeMcpAndTrackMtime = async (data: string): Promise<void> => {
    // If an external editor wrote the file between our previous write and
    // this one, chokidar's `awaitWriteFinish` will coalesce both events
    // into a single watcher fire whose mtime matches what we're about to
    // write — and the watcher handler will then suppress the broadcast.
    // Peer subscribers (e.g. a second browser tab) would never learn about
    // the external edit. Detect that case here by comparing the current
    // on-disk mtime against our last tracked mtime; broadcast after the
    // write completes so peers re-fetch.
    //
    // This is a notification-of-divergence, not a preservation guarantee:
    // depending on whether the external write landed before or after the
    // route handler's `readMcpConfig()`, the external edit's content may
    // already be inside our serialized payload (it'll round-trip) or it
    // may have been read-around and the next `writeStoreFile` below will
    // overwrite it. Either way peers learn there's been a change and
    // re-fetch the resulting authoritative on-disk state. Preserving the
    // external edit's content in the second ordering would require a
    // read-modify-write retry loop, which is outside this PR's scope and
    // probably not worth it for a single-user local dev tool.
    //
    // The originating tab's mutator triggers its own refresh on PUT/POST
    // success, so this extra broadcast is intended for peers only — a
    // double refresh on the originating tab is cheap (same GET, same
    // payload) and acceptable.
    let externalEditDetected = false;
    if (lastWrittenMtimeMs !== null) {
      try {
        const s = await fsStat(mcpConfigPath);
        if (s.mtimeMs !== lastWrittenMtimeMs) {
          externalEditDetected = true;
        }
      } catch {
        // File missing → an external delete slipped in between our writes.
        // Treat as an external edit so peers learn about it.
        externalEditDetected = true;
      }
    }

    await writeStoreFile(mcpConfigPath, data);
    try {
      const s = await fsStat(mcpConfigPath);
      lastWrittenMtimeMs = s.mtimeMs;
    } catch {
      // If the stat fails the next watcher event will broadcast — that's the
      // correct fallback (the only cost is a redundant client refresh).
    }

    if (externalEditDetected) {
      broadcastServerListChange();
    }
  };

  const handleWatcherEvent = async (event: string): Promise<void> => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    if (event !== "unlink") {
      try {
        const s = await fsStat(mcpConfigPath);
        if (
          lastWrittenMtimeMs !== null &&
          s.mtimeMs === lastWrittenMtimeMs
        ) {
          return;
        }
      } catch {
        // File vanished between event and stat — broadcast so subscribers
        // re-fetch and the GET handler can re-seed on the next read.
      }
    }
    broadcastServerListChange();
  };

  const handleWatcherError = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (fileLogger) {
      fileLogger.warn({ err: msg }, "mcp.json watcher error");
    } else {
      console.warn("[mcp.json watcher]", msg);
    }
  };

  const ensureWatcher = (): void => {
    if (mcpConfigWatcher) return;
    // `awaitWriteFinish` coalesces the multi-event sequence editors produce
    // when they save via temp-file + rename (the watched path briefly
    // disappears then reappears). The stability threshold also covers our
    // own atomically-written rename, so a single backend POST yields one
    // event to inspect rather than an unlink/add pair.
    mcpConfigWatcher = chokidarWatch(mcpConfigPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    mcpConfigWatcher.on("all", (event) => {
      void handleWatcherEvent(event);
    });
    mcpConfigWatcher.on("error", handleWatcherError);
  };

  const maybeStopWatcher = async (): Promise<void> => {
    if (serverEventSubscribers.size > 0) return;
    if (!mcpConfigWatcher) return;
    const w = mcpConfigWatcher;
    mcpConfigWatcher = null;
    try {
      await w.close();
    } catch {
      // Closing a chokidar instance can throw on already-closed handles
      // (e.g. if the underlying fs watch was unhooked by a signal). The
      // resource is gone either way; nothing to do.
    }
  };

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
        settings: body.settings,
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

  // Match handleWatcherError's pattern: log to the configured logger if
  // present, fall back to console.warn for visibility in `npm run dev`
  // where no logger is wired up. Both gates below feed user-visible
  // signals (legacy on-disk shape, client bug smuggling fields), so a
  // silent drop is worse than a console line.
  const logWarn = (bindings: Record<string, unknown>, msg: string): void => {
    if (fileLogger) {
      fileLogger.warn(bindings, msg);
    } else {
      console.warn("[mcp.json]", msg, bindings);
    }
  };

  // Defensive normalize so editor-edited files with type:"http" or missing
  // type round-trip into the canonical form on every read. Inspector-
  // extension fields (headers / metadata / connectionTimeout / requestTimeout
  // / oauth) sit at the top level of each entry post-#1358; this function
  // is the read-side gate — it validates each field's shape and drops
  // anything malformed with a logged warn, so a hand-edited file with
  // `headers: "oops"` can't put garbage rows into the form.
  //
  // Legacy `settings` nodes written by the pre-#1358 build (one #1352
  // release on v2/main that never shipped stable) are dropped with a
  // warn — those persisted headers / metadata / timeouts / OAuth
  // credentials are intentionally lost on first read (hard cutover per
  // #1358 decision 4). Users re-enter via the form or hand-edit into the
  // flat shape.
  const isStringRecord = (v: unknown): v is Record<string, string> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    for (const val of Object.values(v as Record<string, unknown>)) {
      if (typeof val !== "string") return false;
    }
    return true;
  };
  const isKvArray = (v: unknown): v is { key: string; value: string }[] => {
    if (!Array.isArray(v)) return false;
    return v.every(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        typeof (e as Record<string, unknown>).key === "string" &&
        typeof (e as Record<string, unknown>).value === "string",
    );
  };
  const isOauthObject = (
    v: unknown,
  ): v is { clientId?: string; clientSecret?: string; scopes?: string } => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    for (const k of ["clientId", "clientSecret", "scopes"] as const) {
      if (o[k] !== undefined && typeof o[k] !== "string") return false;
    }
    return true;
  };
  // `Number.isFinite` rejects `Infinity` and `NaN` as well as non-numbers,
  // matching the write-side semantics in `validateSettings`. A hand-edited
  // file with `connectionTimeout: Infinity` would otherwise pass the guard
  // and propagate to the form (where it has no useful meaning).
  const isNonNegNumber = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;

  const normalizeMcpServers = (
    raw: unknown,
  ): Record<string, StoredMCPServer> => {
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, StoredMCPServer> = {};
    for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!val || typeof val !== "object") continue;
      // `valObj` is the per-entry object we'll mutate in place via the
      // `delete` calls below. Safe because the only callers
      // (`readMcpConfig` and the GET handler's seed branch) pass in
      // freshly-parsed JSON they don't retain a reference to elsewhere.
      const valObj = val as Record<string, unknown>;

      // Strip a legacy nested `settings` node before normalizeServerType
      // would spread it through. Hard cutover per decision 4.
      if ("settings" in valObj) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "settings" },
          "Dropping legacy `settings` node from mcp.json entry — fields now live at the top level. Re-enter via the settings form or hand-edit the file into the flat shape.",
        );
        delete valObj.settings;
      }

      // Per-field shape validation on the Inspector-extension keys. The
      // write path (validateSettings) is symmetric — same checks. Drop
      // bad shapes individually so a single malformed key doesn't take
      // out the rest of the entry; log so the user can fix the file.
      if ("headers" in valObj && !isStringRecord(valObj.headers)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "headers" },
          "Dropping malformed `headers` field — expected `Record<string, string>`.",
        );
        delete valObj.headers;
      }
      if ("metadata" in valObj && !isKvArray(valObj.metadata)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "metadata" },
          "Dropping malformed `metadata` field — expected `Array<{ key: string, value: string }>`.",
        );
        delete valObj.metadata;
      }
      if (
        "connectionTimeout" in valObj &&
        !isNonNegNumber(valObj.connectionTimeout)
      ) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "connectionTimeout" },
          "Dropping malformed `connectionTimeout` field — expected non-negative number.",
        );
        delete valObj.connectionTimeout;
      }
      if (
        "requestTimeout" in valObj &&
        !isNonNegNumber(valObj.requestTimeout)
      ) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "requestTimeout" },
          "Dropping malformed `requestTimeout` field — expected non-negative number.",
        );
        delete valObj.requestTimeout;
      }
      if ("oauth" in valObj && !isOauthObject(valObj.oauth)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "oauth" },
          "Dropping malformed `oauth` field — expected `{ clientId?, clientSecret?, scopes? }`.",
        );
        delete valObj.oauth;
      }

      out[id] = normalizeServerType(
        valObj as Record<string, unknown> & { type?: string },
      ) as StoredMCPServer;
    }
    return out;
  };

  // Build a single on-disk entry from `{ config, settings }`, normalizing the
  // type discriminator and splatting Inspector-extension fields onto the
  // entry as direct keys (post-#1358 flat shape).
  //
  // `normalizeServerType` spreads unknown keys from the incoming config
  // through verbatim, so a caller that included `config.settings` (or any
  // of the now-flat Inspector keys) on the wire would smuggle those values
  // onto the stored entry — bypassing `validateSettings`. Strip them here
  // so `validateSettings` remains the single write path for those fields.
  // Log a warning if we observe this — it indicates a client bug (settings
  // travel through the body's top-level `settings` field per the kept-
  // envelope wire shape from #1358 decision 5, not nested in config).
  //
  // `id` is threaded through purely so the warning correlates to a specific
  // entry; the route ultimately reaches here via POST or PUT and both know
  // the target id at call time.
  //
  // The set of guarded keys is the source-of-truth `INSPECTOR_FIELD_KEYS`
  // plus the legacy `"settings"` wrapper key. Adding a new Inspector-
  // extension field to `StoredMCPServer` propagates through the
  // `satisfies` check in `serverList.ts` and updates this guard
  // automatically; nothing to remember to update here.
  const SMUGGLE_GUARDED_KEYS: ReadonlySet<string> = new Set<string>([
    ...INSPECTOR_FIELD_KEYS,
    "settings",
  ]);
  const buildStoredEntry = (
    id: string,
    config: unknown,
    settings: InspectorServerSettings | undefined,
  ): StoredMCPServer => {
    // `unknown` parameter contract: be honest about the shape rather than
    // assuming the route layer's pre-checks. The route handlers do reject
    // non-object config before reaching here, but this helper should stay
    // safe to call from anywhere.
    const configObj: Record<string, unknown> =
      config !== null && typeof config === "object"
        ? (config as Record<string, unknown>)
        : {};
    const smuggled: string[] = [];
    const configOnly: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(configObj)) {
      if (SMUGGLE_GUARDED_KEYS.has(k)) {
        smuggled.push(k);
        continue;
      }
      configOnly[k] = v;
    }
    if (smuggled.length > 0) {
      logWarn(
        { route: "/api/servers", id, smuggledKeys: smuggled },
        "Stripping Inspector-extension keys from request body's `config` — those must travel through the top-level `settings` field, not nested inside `config`.",
      );
    }
    const normalized = normalizeServerType(
      configOnly as Record<string, unknown> & { type?: string },
    ) as StoredMCPServer;
    if (settings !== undefined) {
      Object.assign(normalized, inspectorSettingsToStoredFields(settings));
    }
    return normalized;
  };

  // Structurally validates an InspectorServerSettings payload off the wire so
  // a malformed body can't persist to disk and crash the UI later (e.g.
  // `settings: []` or `settings: { headers: "oops" }`). Mirrors the lenient
  // read on `normalizeMcpServers` so the only fully-trusted invariant is
  // "what we accept on the write path."
  const validateSettings = (
    raw: unknown,
  ):
    | { ok: true; value: InspectorServerSettings }
    | { ok: false; error: string } => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "settings must be an object" };
    }
    const obj = raw as Record<string, unknown>;
    const isKvArray = (v: unknown): v is { key: string; value: string }[] => {
      if (!Array.isArray(v)) return false;
      return v.every(
        (e) =>
          e !== null &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).key === "string" &&
          typeof (e as Record<string, unknown>).value === "string",
      );
    };
    if (!isKvArray(obj.headers)) {
      return {
        ok: false,
        error: "settings.headers must be an array of { key, value }",
      };
    }
    if (!isKvArray(obj.metadata)) {
      return {
        ok: false,
        error: "settings.metadata must be an array of { key, value }",
      };
    }
    if (
      typeof obj.connectionTimeout !== "number" ||
      obj.connectionTimeout < 0
    ) {
      return {
        ok: false,
        error: "settings.connectionTimeout must be a non-negative number",
      };
    }
    if (typeof obj.requestTimeout !== "number" || obj.requestTimeout < 0) {
      return {
        ok: false,
        error: "settings.requestTimeout must be a non-negative number",
      };
    }
    for (const optional of [
      "oauthClientId",
      "oauthClientSecret",
      "oauthScopes",
    ] as const) {
      if (obj[optional] !== undefined && typeof obj[optional] !== "string") {
        return { ok: false, error: `settings.${optional} must be a string` };
      }
    }
    // Build the validated value from explicitly named fields rather than
    // casting the raw object through. Unknown keys silently drop so a
    // misconfigured client can't smuggle stowaways onto disk, and consumers
    // can rely on the validated shape being exactly InspectorServerSettings.
    // Empty-string OAuth fields coerce to absent — the form emits `""` when
    // the user clears an input, and an empty `oauthClientId` on disk would
    // later be misread as "OAuth configured."
    const value: InspectorServerSettings = {
      headers: obj.headers as { key: string; value: string }[],
      metadata: obj.metadata as { key: string; value: string }[],
      connectionTimeout: obj.connectionTimeout as number,
      requestTimeout: obj.requestTimeout as number,
    };
    if (typeof obj.oauthClientId === "string" && obj.oauthClientId !== "") {
      value.oauthClientId = obj.oauthClientId;
    }
    if (
      typeof obj.oauthClientSecret === "string" &&
      obj.oauthClientSecret !== ""
    ) {
      value.oauthClientSecret = obj.oauthClientSecret;
    }
    if (typeof obj.oauthScopes === "string" && obj.oauthScopes !== "") {
      value.oauthScopes = obj.oauthScopes;
    }
    return { ok: true, value };
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
        await writeMcpAndTrackMtime(serializeStore(DEFAULT_SEED_CONFIG));
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
    let body: { id?: unknown; config?: unknown; settings?: unknown };
    try {
      body = (await c.req.json()) as {
        id?: unknown;
        config?: unknown;
        settings?: unknown;
      };
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
    // Settings on POST: optional. `undefined` → no settings node persisted.
    // Any provided value must structurally match InspectorServerSettings.
    let postSettings: InspectorServerSettings | undefined;
    if (body.settings !== undefined && body.settings !== null) {
      const validated = validateSettings(body.settings);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      postSettings = validated.value;
    }
    const id = body.id;

    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (id in current.mcpServers) {
          return c.json({ error: `Server '${id}' already exists` }, 409);
        }
        current.mcpServers[id] = buildStoredEntry(
          id,
          body.config,
          postSettings,
        );
        await writeMcpAndTrackMtime(serializeStore(current));
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
    let body: { id?: unknown; config?: unknown; settings?: unknown };
    try {
      body = (await c.req.json()) as {
        id?: unknown;
        config?: unknown;
        settings?: unknown;
      };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    // Config on PUT: optional. If the field is omitted, preserve the
    // existing transport config from disk. This makes "patch only settings"
    // a first-class shape — callers like updateServerSettings don't have to
    // snapshot the current config off in-memory state (which could race
    // against a concurrent refresh and silently revert a separate edit).
    // A provided config must structurally be an object; we let
    // `normalizeServerType` do the lenient type coercion downstream.
    if (
      body.config !== undefined &&
      (body.config === null || typeof body.config !== "object")
    ) {
      return c.json({ error: "Invalid config" }, 400);
    }
    // Settings on PUT have three intents:
    //   - field omitted (`undefined`)  → preserve the existing settings node
    //   - explicit `null`              → clear the settings node
    //   - a settings object            → validate and apply
    // Preserving on omission means callers that only want to update config
    // (e.g. ServerConfigModal save) don't silently wipe persisted settings.
    type SettingsIntent =
      | { kind: "preserve" }
      | { kind: "clear" }
      | { kind: "apply"; value: InspectorServerSettings };
    let settingsIntent: SettingsIntent;
    if (body.settings === undefined) {
      settingsIntent = { kind: "preserve" };
    } else if (body.settings === null) {
      settingsIntent = { kind: "clear" };
    } else {
      const validated = validateSettings(body.settings);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      settingsIntent = { kind: "apply", value: validated.value };
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
        // Rebuild preserving insertion order; replace the original key in
        // place so the file diff stays minimal when not renaming. Writing
        // the full map back also means normalize-on-read self-heals any
        // malformed settings node on *other* servers in the file — a
        // deliberate side-effect of using `readMcpConfig` + full rewrite
        // here.
        const existing = current.mcpServers[originalId];
        if (!existing) {
          // The `in` check above guarantees this branch is unreachable;
          // narrowing without the non-null assertion keeps TS happy and
          // makes the contract explicit for future refactors.
          return c.json(
            { error: `Server '${originalId}' not found` },
            404,
          );
        }
        // Split the existing entry into its SDK-only config (no Inspector-
        // extension fields) and its lifted settings, then apply patch
        // semantics from the body to each. The flat-on-disk Inspector
        // fields are sliced off `existing` so the preserve-on-omit `config`
        // path doesn't accidentally carry them through as raw disk keys —
        // they need to flow through `buildStoredEntry` so empty `settings`
        // intents can clear them.
        //
        // `stripInspectorFields` + `storedFieldsToInspectorSettings` both
        // derive from the same `INSPECTOR_FIELD_KEYS` set, so adding a new
        // Inspector-extension field to `StoredMCPServer` doesn't silently
        // leak through this preserve path.
        const existingConfig = stripInspectorFields(existing);
        const existingSettings = storedFieldsToInspectorSettings(existing);
        const nextConfig =
          body.config !== undefined ? body.config : existingConfig;
        let nextSettings: InspectorServerSettings | undefined;
        switch (settingsIntent.kind) {
          case "preserve":
            nextSettings = existingSettings;
            break;
          case "clear":
            nextSettings = undefined;
            break;
          case "apply":
            nextSettings = settingsIntent.value;
            break;
        }
        const next: MCPConfig = { mcpServers: {} };
        for (const [key, val] of Object.entries(current.mcpServers)) {
          if (key === originalId) {
            next.mcpServers[newId] = buildStoredEntry(
              newId,
              nextConfig,
              nextSettings,
            );
          } else {
            next.mcpServers[key] = val;
          }
        }
        await writeMcpAndTrackMtime(serializeStore(next));
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
        await writeMcpAndTrackMtime(serializeStore(current));
        return c.json({ ok: true });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to delete server: ${msg}` }, 500);
    }
  });

  // Server-sent events for `mcp.json` external edits. The payload is
  // intentionally empty-of-meaning ({"type":"change"}) — the client only
  // cares that *something* happened on disk and re-fetches GET /api/servers
  // to get the authoritative state. This sidesteps any drift between an
  // event payload and the canonical normalize-on-read shape.
  app.get("/api/servers/events", async (c) => {
    return streamSSE(c, async (stream) => {
      const send = (data: string): void => {
        void stream.writeSSE({ event: "change", data });
      };
      serverEventSubscribers.add(send);
      ensureWatcher();

      stream.onAbort(() => {
        serverEventSubscribers.delete(send);
        void maybeStopWatcher();
        stream.close();
      });

      // Hono closes the stream the moment this callback returns, so hold the
      // promise open until the client aborts. Cleanup happens in the
      // onAbort handler registered above.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  });

  return {
    app,
    authToken,
    close: async () => {
      serverEventSubscribers.clear();
      await maybeStopWatcher();
    },
  };
}
