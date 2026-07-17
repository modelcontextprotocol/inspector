import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import type {
  JSONRPCMessage,
  McpHttpHandler,
} from "@modelcontextprotocol/server";
import { createMcpServer } from "./test-server-fixtures.js";
import { SSEServerTransport } from "@modelcontextprotocol/server-legacy/sse";
import type { Request, Response } from "express";
import express from "express";
import { createServer as createHttpServer, Server as HttpServer } from "http";
import { createServer as createNetServer } from "net";
import { Readable } from "node:stream";
import * as crypto from "node:crypto";
import type { ServerConfig } from "./test-server-fixtures.js";
import {
  setupOAuthRoutes,
  createBearerTokenMiddleware,
  buildScopeRequirementRegistry,
  scopeRequirementRegistryHasEntries,
  createScopeCheckMiddleware,
} from "./test-server-oauth.js";
import {
  setTestServerControl,
  type ServerControl,
} from "./test-server-control.js";

/**
 * Build a Web-standard {@link Request} from an Express request.
 *
 * SDK v2's {@link WebStandardStreamableHTTPServerTransport} speaks the Fetch API
 * (`Request`/`Response`) rather than Node `req`/`res`. The JSON body is passed
 * to `handleRequest` via `parsedBody` (Express already parsed it), so the Web
 * request carries only method, URL, and headers.
 */
function toWebRequest(req: Request): globalThis.Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }
  const url = `http://localhost${req.originalUrl || req.url}`;
  return new globalThis.Request(url, { method: req.method, headers });
}

/**
 * Stream a Web-standard {@link Response} (from `handleRequest`) back onto an
 * Express response, preserving status, headers, and any SSE body stream. The
 * body stream is destroyed if the client disconnects first.
 */
async function writeWebResponse(
  res: Response,
  webResponse: globalThis.Response,
): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webResponse.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(
    webResponse.body as import("node:stream/web").ReadableStream,
  );
  res.on("close", () => {
    nodeStream.destroy();
  });
  nodeStream.pipe(res);
}

export interface RecordedRequest {
  method: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  response: unknown;
  timestamp: number;
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as { port: number })?.port;
      server.close(() => resolve(port || startPort));
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Try next port
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Extract headers from Express request
 */
function extractHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      const lastValue = value[value.length - 1];
      if (typeof lastValue === "string") {
        headers[key] = lastValue;
      }
    }
  }
  return headers;
}

// With this test server, your test can hold an instance and you can get the server's recorded message history at any time.
//
export class TestServerHttp {
  private config: ServerConfig;
  private readonly configWithCallback: ServerConfig;
  private readonly serverControl: ServerControl;
  private _closing = false;
  private recordedRequests: RecordedRequest[] = [];
  private httpServer?: HttpServer;
  private transport?:
    | WebStandardStreamableHTTPServerTransport
    | SSEServerTransport;
  private baseUrl?: string;
  private currentRequestHeaders?: Record<string, string>;
  private currentLogLevel: string | null = null;
  /** One McpServer per connection (SSE and streamable-http both use this; SDK allows only one transport per server) */
  private mcpServersBySession?: Map<string, McpServer>;
  /** Modern (2026-07-28) fetch handler, present only when `config.modern` is set. */
  private modernHandler?: McpHttpHandler;

  constructor(config: ServerConfig) {
    this.config = config;
    this.serverControl = {
      isClosing: () => this._closing,
    };
    this.configWithCallback = {
      ...config,
      onLogLevelSet: (level: string) => {
        this.currentLogLevel = level;
      },
      serverControl: this.serverControl,
    };
  }

  /**
   * Set up message interception for a transport to record incoming messages
   * This wraps the transport's onmessage handler to record requests/notifications
   */
  private setupMessageInterception(
    transport: WebStandardStreamableHTTPServerTransport | SSEServerTransport,
  ): void {
    const originalOnMessage = transport.onmessage;
    transport.onmessage = async (message: JSONRPCMessage) => {
      const timestamp = Date.now();
      const method =
        "method" in message && typeof message.method === "string"
          ? message.method
          : "unknown";
      const params = "params" in message ? message.params : undefined;

      // Extract metadata from params if present - it's probably not worth the effort
      // to type it properly here - so we'll just pry the metadata out if exists.
      const metadata =
        params && typeof params === "object" && "_meta" in params
          ? ((params as Record<string, unknown>)._meta as Record<
              string,
              string
            >)
          : undefined;

      try {
        // Let the server handle the message
        if (originalOnMessage) {
          await originalOnMessage.call(transport, message);
        }

        // Record successful request/notification
        this.recordedRequests.push({
          method,
          params,
          headers: { ...this.currentRequestHeaders },
          metadata: metadata ? { ...metadata } : undefined,
          response: { processed: true },
          timestamp,
        });
      } catch (error) {
        // Record error
        this.recordedRequests.push({
          method,
          params,
          headers: { ...this.currentRequestHeaders },
          metadata: metadata ? { ...metadata } : undefined,
          response: {
            error: error instanceof Error ? error.message : String(error),
          },
          timestamp,
        });
        throw error;
      }
    };
  }

  /**
   * Start the server using the configuration from ServerConfig
   */
  async start(): Promise<number> {
    setTestServerControl(this.serverControl);
    const serverType = this.config.serverType ?? "streamable-http";
    const requestedPort = this.config.port;

    // If a port is explicitly requested, find an available port starting from that value
    // Otherwise, use 0 to let the OS assign an available port
    const port = requestedPort ? await findAvailablePort(requestedPort) : 0;

    if (serverType === "streamable-http") {
      return this.startHttp(port);
    } else {
      return this.startSse(port);
    }
  }

  /**
   * Start the underlying HTTP server listening on localhost, resolving with the
   * assigned port. Localhost-only to avoid macOS firewall prompts; port 0 lets
   * the OS assign an available port.
   */
  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, "127.0.0.1", () => {
        const address = this.httpServer!.address();
        const assignedPort =
          typeof address === "object" && address !== null ? address.port : port;
        this.baseUrl = `http://localhost:${assignedPort}`;
        resolve(assignedPort);
      });
      this.httpServer!.on("error", reject);
    });
  }

  /**
   * Mount the modern (2026-07-28) leg via the SDK's `createMcpHandler`. Unlike
   * the 2025 session model, serving is per-request and stateless: every method
   * routes through one web-standard `fetch` handler, which classifies each
   * request (modern envelope vs. legacy) and serves it — no `Mcp-Session-Id`
   * bookkeeping. The same factory backs both eras, so `legacy: "stateless"`
   * still answers a plain `initialize` handshake.
   *
   * Message recording (`setupMessageInterception`) is not wired here: the
   * modern handler owns per-request transports internally and exposes no
   * `onmessage` seam. Tests that need recorded traffic use the 2025 path.
   */
  private async startModernHttp(
    app: express.Express,
    mcpMiddleware: express.RequestHandler[],
    port: number,
  ): Promise<number> {
    const handler = createMcpHandler(
      () => createMcpServer(this.configWithCallback),
      { legacy: this.config.modern?.legacy ?? "stateless" },
    );
    this.modernHandler = handler;

    const route = async (req: Request, res: Response): Promise<void> => {
      if (res.headersSent) {
        return;
      }
      this.currentRequestHeaders = extractHeaders(req);
      try {
        const webResponse = await handler.fetch(toWebRequest(req), {
          parsedBody: req.body,
        });
        await writeWebResponse(res, webResponse);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    app.post("/mcp", ...mcpMiddleware, route);
    app.get("/mcp", ...mcpMiddleware, route);
    app.delete("/mcp", ...mcpMiddleware, route);

    return this.listen(port);
  }

  private async startHttp(port: number): Promise<number> {
    const app = express();
    app.use(express.json());

    // Create HTTP server
    this.httpServer = createHttpServer(app);

    // Set up OAuth if enabled (BEFORE MCP routes)
    if (this.config.oauth?.enabled) {
      // We need baseUrl, but it's not set yet - we'll set it after server starts
      setupOAuthRoutes(app, this.config.oauth);
    }

    // Bearer token middleware for MCP routes if requireAuth
    const mcpMiddleware: express.RequestHandler[] = [];
    if (this.config.oauth?.enabled && this.config.oauth.requireAuth) {
      mcpMiddleware.push(createBearerTokenMiddleware(this.config.oauth));
      const scopeRegistry = buildScopeRequirementRegistry(this.config);
      if (scopeRequirementRegistryHasEntries(scopeRegistry)) {
        mcpMiddleware.push(createScopeCheckMiddleware(scopeRegistry));
      }
    }

    // Modern (2026-07-28) serving replaces the 2025 session model entirely.
    if (this.config.modern) {
      return this.startModernHttp(app, mcpMiddleware, port);
    }

    // Store transports and one McpServer per session (SDK allows only one transport per server)
    const transports: Map<string, WebStandardStreamableHTTPServerTransport> =
      new Map();
    this.mcpServersBySession = new Map();

    // Set up Express route to handle MCP requests
    app.post("/mcp", ...mcpMiddleware, async (req: Request, res: Response) => {
      // If middleware already sent a response (401), don't continue
      if (res.headersSent) {
        return;
      }
      // Capture headers for this request
      this.currentRequestHeaders = extractHeaders(req);

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        // Existing session - use the transport for this session
        const transport = transports.get(sessionId);
        if (!transport) {
          res.status(404).json({ error: "Session not found" });
          return;
        }

        try {
          const webResponse = await transport.handleRequest(toWebRequest(req), {
            parsedBody: req.body,
          });
          await writeWebResponse(res, webResponse);
        } catch (error) {
          // If response already sent (e.g., by OAuth middleware), don't send another
          if (!res.headersSent) {
            res.status(500).json({
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        // New session - create a new transport and a new McpServer (one server per connection)
        const sessionMcpServer = createMcpServer(this.configWithCallback);
        const newTransport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sessionId: string) => {
            transports.set(sessionId, newTransport);
            this.mcpServersBySession!.set(sessionId, sessionMcpServer);
          },
          onsessionclosed: async (sessionId: string) => {
            const mcp = this.mcpServersBySession?.get(sessionId);
            transports.delete(sessionId);
            this.mcpServersBySession?.delete(sessionId);
            if (mcp) await mcp.close();
          },
        });

        // Set up message interception for this transport
        this.setupMessageInterception(newTransport);

        // Connect this session's MCP server to this transport
        await sessionMcpServer.connect(newTransport);

        try {
          const webResponse = await newTransport.handleRequest(
            toWebRequest(req),
            { parsedBody: req.body },
          );
          await writeWebResponse(res, webResponse);
        } catch (error) {
          // If response already sent (e.g., by OAuth middleware), don't send another
          if (!res.headersSent) {
            res.status(500).json({
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    });

    // Handle GET requests for SSE stream - this enables server-initiated messages
    app.get("/mcp", ...mcpMiddleware, async (req: Request, res: Response) => {
      // Get session ID from header - required for streamable-http
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        res.status(400).json({
          error: "Bad Request: Mcp-Session-Id header is required",
        });
        return;
      }

      // Look up the transport for this session
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          error: "Session not found",
        });
        return;
      }

      // Let the transport handle the GET request
      this.currentRequestHeaders = extractHeaders(req);
      try {
        const webResponse = await transport.handleRequest(toWebRequest(req));
        await writeWebResponse(res, webResponse);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    return this.listen(port);
  }

  private async startSse(port: number): Promise<number> {
    const app = express();
    app.use(express.json());

    // Create HTTP server
    this.httpServer = createHttpServer(app);

    // Set up OAuth if enabled (BEFORE MCP routes)
    // Note: We use port 0 to let OS assign port, so we can't know the actual port yet
    // But the routes use relative paths, so they should work regardless
    if (this.config.oauth?.enabled) {
      // Use placeholder URL - actual baseUrl will be set after server starts
      setupOAuthRoutes(app, this.config.oauth);
    }

    // Bearer token middleware for SSE routes if requireAuth
    const sseMiddleware: express.RequestHandler[] = [];
    if (this.config.oauth?.enabled && this.config.oauth.requireAuth) {
      sseMiddleware.push(createBearerTokenMiddleware(this.config.oauth));
      const scopeRegistry = buildScopeRequirementRegistry(this.config);
      if (scopeRequirementRegistryHasEntries(scopeRegistry)) {
        sseMiddleware.push(createScopeCheckMiddleware(scopeRegistry));
      }
    }

    // One McpServer per connection (same pattern as streamable-http)
    this.mcpServersBySession = new Map();
    const sseTransports: Map<string, SSEServerTransport> = new Map();

    // GET handler for SSE connection (establishes the SSE stream)
    app.get("/sse", ...sseMiddleware, async (req: Request, res: Response) => {
      this.currentRequestHeaders = extractHeaders(req);
      const sessionMcpServer = createMcpServer(this.configWithCallback);
      const sseTransport = new SSEServerTransport("/sse", res);

      const sessionId = sseTransport.sessionId;
      sseTransports.set(sessionId, sseTransport);
      this.mcpServersBySession!.set(sessionId, sessionMcpServer);

      // Clean up on connection close
      res.on("close", async () => {
        const mcp = this.mcpServersBySession?.get(sessionId);
        sseTransports.delete(sessionId);
        this.mcpServersBySession?.delete(sessionId);
        if (mcp) await mcp.close();
      });

      // Intercept messages
      this.setupMessageInterception(sseTransport);

      // Connect this connection's MCP server to this transport
      await sessionMcpServer.connect(sseTransport);
    });

    // POST handler for SSE message sending (SSE uses GET for stream, POST for sending messages)
    app.post("/sse", ...sseMiddleware, async (req: Request, res: Response) => {
      this.currentRequestHeaders = extractHeaders(req);
      const sessionId = req.query.sessionId as string | undefined;

      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId query parameter" });
        return;
      }

      const transport = sseTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "No transport found for sessionId" });
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        res.status(500).json({
          error: errorMessage,
        });
      }
    });

    return this.listen(port);
  }

  /**
   * Stop the server. Set closing before closing transport so in-flight tools can skip sending.
   */
  async stop(): Promise<void> {
    this._closing = true;
    // Tear down the modern leg (aborts in-flight modern exchanges and closes
    // their per-request instances) when it was mounted.
    if (this.modernHandler) {
      await this.modernHandler.close();
      this.modernHandler = undefined;
    }
    // Close all per-connection McpServers (SSE and streamable-http both use the map)
    if (this.mcpServersBySession) {
      for (const mcp of this.mcpServersBySession.values()) {
        await mcp.close();
      }
      this.mcpServersBySession.clear();
      this.mcpServersBySession = undefined;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }

    if (this.httpServer) {
      return new Promise((resolve) => {
        // Force close all connections
        this.httpServer!.closeAllConnections?.();
        this.httpServer!.close(() => {
          this.httpServer = undefined;
          setTestServerControl(null);
          resolve();
        });
      });
    } else {
      setTestServerControl(null);
    }
  }

  /**
   * Get all recorded requests
   */
  getRecordedRequests(): RecordedRequest[] {
    return [...this.recordedRequests];
  }

  /**
   * Clear recorded requests
   */
  clearRecordings(): void {
    this.recordedRequests = [];
  }

  /**
   * Wait until a recorded request matches the predicate, or reject after timeout.
   * Use instead of polling getRecordedRequests() with manual delays.
   */
  waitUntilRecorded(
    predicate: (req: RecordedRequest) => boolean,
    options?: { timeout?: number; interval?: number },
  ): Promise<RecordedRequest> {
    const { timeout = 5000, interval = 10 } = options ?? {};
    const start = Date.now();
    return new Promise<RecordedRequest>((resolve, reject) => {
      const check = () => {
        const req = this.getRecordedRequests().find(predicate);
        if (req) {
          resolve(req);
          return;
        }
        if (Date.now() - start >= timeout) {
          reject(
            new Error(
              `Timeout (${timeout}ms) waiting for recorded request matching predicate`,
            ),
          );
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  /**
   * Get the server URL with the appropriate endpoint path
   */
  get url(): string {
    if (!this.baseUrl) {
      throw new Error("Server not started");
    }
    const serverType = this.config.serverType ?? "streamable-http";
    const endpoint = serverType === "sse" ? "/sse" : "/mcp";
    return `${this.baseUrl}${endpoint}`;
  }

  /**
   * Get the most recent log level that was set
   */
  getCurrentLogLevel(): string | null {
    return this.currentLogLevel;
  }
}

/**
 * Create an HTTP/SSE MCP test server
 */
export function createTestServerHttp(config: ServerConfig): TestServerHttp {
  return new TestServerHttp(config);
}
