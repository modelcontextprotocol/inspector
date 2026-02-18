/**
 * Hono-based remote server for MCP transports.
 * Hosts /api/config, /api/mcp/connect, send, events, disconnect, /api/fetch, /api/log, /api/storage/:storeId.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type pino from "pino";
import type { LogEvent } from "pino";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import { createTransportNode } from "../../node/transport.js";
import type { RemoteConnectRequest, RemoteSendRequest } from "../types.js";
import type { MCPServerConfig } from "../../types.js";
import { RemoteSession } from "./remote-session.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { API_SERVER_ENV_VARS } from "../constants.js";

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

  /** Optional sandbox URL for MCP Apps tab. When set, GET /api/config includes sandboxUrl. */
  sandboxUrl?: string;
}

export interface CreateRemoteAppResult {
  /** The Hono app */
  app: Hono;
  /** The auth token (from options, env var, or generated). Returned so caller can embed in client. */
  authToken: string;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
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

/**
 * Get default storage directory path.
 */
function getDefaultStorageDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "storage");
}

/**
 * Build initial config object from process.env for GET /api/config.
 * Same shape as previously injected via __INITIAL_CONFIG__.
 */
function buildInitialConfigFromEnv(): {
  defaultCommand?: string;
  defaultArgs?: string[];
  defaultTransport?: string;
  defaultServerUrl?: string;
  defaultEnvironment: Record<string, string>;
} {
  const defaultEnvKeys =
    process.platform === "win32"
      ? [
          "APPDATA",
          "HOMEDRIVE",
          "HOMEPATH",
          "LOCALAPPDATA",
          "PATH",
          "PROCESSOR_ARCHITECTURE",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "USERNAME",
          "USERPROFILE",
          "PROGRAMFILES",
        ]
      : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

  const defaultEnvironment: Record<string, string> = {};
  for (const key of defaultEnvKeys) {
    const value = process.env[key];
    if (value && !value.startsWith("()")) {
      defaultEnvironment[key] = value;
    }
  }
  if (process.env.MCP_ENV_VARS) {
    try {
      Object.assign(
        defaultEnvironment,
        JSON.parse(process.env.MCP_ENV_VARS) as Record<string, string>,
      );
    } catch {
      // Ignore invalid MCP_ENV_VARS
    }
  }

  return {
    ...(process.env.MCP_INITIAL_COMMAND
      ? { defaultCommand: process.env.MCP_INITIAL_COMMAND }
      : {}),
    ...(process.env.MCP_INITIAL_ARGS
      ? { defaultArgs: process.env.MCP_INITIAL_ARGS.split(" ") }
      : {}),
    ...(process.env.MCP_INITIAL_TRANSPORT
      ? { defaultTransport: process.env.MCP_INITIAL_TRANSPORT }
      : {}),
    ...(process.env.MCP_INITIAL_SERVER_URL
      ? { defaultServerUrl: process.env.MCP_INITIAL_SERVER_URL }
      : {}),
    defaultEnvironment,
  };
}

/**
 * Validate storeId to prevent path traversal attacks.
 * Store IDs must be alphanumeric, hyphens, underscores only, and not empty.
 */
function validateStoreId(storeId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(storeId) && storeId.length > 0;
}

/**
 * Get file path for a store ID.
 */
function getStoreFilePath(storageDir: string, storeId: string): string {
  return path.join(storageDir, `${storeId}.json`);
}

/**
 * Simple OAuth client provider that just returns tokens.
 * Used by remote server to inject Bearer tokens into transport requests.
 */
function createTokenAuthProvider(
  tokens: RemoteConnectRequest["oauthTokens"],
): OAuthClientProvider | undefined {
  if (!tokens) return undefined;

  return {
    async tokens(): Promise<OAuthTokens | undefined> {
      return tokens as OAuthTokens;
    },
    // Other methods not needed for transport Bearer token injection
    async clientInformation() {
      return undefined;
    },
    async saveTokens() {
      // No-op
    },
    codeVerifier() {
      return undefined;
    },
    async saveCodeVerifier() {
      // No-op
    },
    clear() {
      // No-op
    },
    redirectToAuthorization() {
      // No-op
    },
    state() {
      return "";
    },
  } as unknown as OAuthClientProvider;
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
  options: RemoteServerOptions = {},
): CreateRemoteAppResult {
  const dangerouslyOmitAuth = !!options.dangerouslyOmitAuth;

  // Determine auth token when auth is enabled: options > env var > generate
  const authToken = dangerouslyOmitAuth
    ? ""
    : options.authToken ||
      process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ||
      randomBytes(32).toString("hex");

  const app = new Hono();
  const sessions = new Map<string, RemoteSession>();
  const { logger: fileLogger, allowedOrigins } = options;
  const storageDir = options.storageDir ?? getDefaultStorageDir();

  // Apply origin validation middleware first (before auth)
  // This prevents DNS rebinding attacks by validating Origin header
  app.use("*", createOriginMiddleware(allowedOrigins));

  // Apply auth middleware unless dangerously omitted
  if (!dangerouslyOmitAuth) {
    app.use("*", createAuthMiddleware(authToken));
  }

  app.get("/api/config", (c) => {
    const initialConfig = buildInitialConfigFromEnv();
    const payload = options.sandboxUrl
      ? { ...initialConfig, sandboxUrl: options.sandboxUrl }
      : initialConfig;
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
        // If no client connected, can cleanup immediately
        if (!session.hasEventConsumer()) {
          sessions.delete(sessionId);
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
      // Preserve 401 status if the underlying error is a 401
      const is401 =
        (err as { code?: number }).code === 401 ||
        msg.includes("401") ||
        msg.includes("Unauthorized");
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
      return c.json({ error: msg }, 500);
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
      const data = await fs.readFile(filePath, "utf-8");
      const store = JSON.parse(data);
      return c.json(store);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return c.json({}, 200); // Return empty object if file doesn't exist
      }
      const msg = err instanceof Error ? err.message : String(err);
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
      // Ensure storage directory exists
      await fs.mkdir(storageDir, { recursive: true });

      // Write store as JSON
      const jsonData = JSON.stringify(body, null, 2);
      await fs.writeFile(filePath, jsonData, "utf-8");

      // Set restrictive permissions (600) for security
      try {
        await fs.chmod(filePath, 0o600);
      } catch {
        // Ignore chmod errors (may fail on some systems)
      }

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
      await fs.unlink(filePath);
      return c.json({ ok: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        // Already deleted, return success
        return c.json({ ok: true });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to delete store: ${msg}` }, 500);
    }
  });

  return { app, authToken };
}
