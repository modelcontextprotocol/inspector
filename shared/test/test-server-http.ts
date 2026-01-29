import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "./test-server-fixtures.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Request, Response } from "express";
import express from "express";
import { createServer as createHttpServer, Server as HttpServer } from "http";
import { createServer as createNetServer } from "net";
import * as z from "zod/v4";
import * as crypto from "node:crypto";
import type { ServerConfig } from "./test-server-fixtures.js";
import {
  setupOAuthRoutes,
  createBearerTokenMiddleware,
} from "./test-server-oauth.js";

export interface RecordedRequest {
  method: string;
  params?: any;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  response: any;
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
  private mcpServer: McpServer;
  private config: ServerConfig;
  private recordedRequests: RecordedRequest[] = [];
  private httpServer?: HttpServer;
  private transport?: StreamableHTTPServerTransport | SSEServerTransport;
  private baseUrl?: string;
  private currentRequestHeaders?: Record<string, string>;
  private currentLogLevel: string | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    // Pass callback to track log level for testing
    const configWithCallback: ServerConfig = {
      ...config,
      onLogLevelSet: (level: string) => {
        this.currentLogLevel = level;
      },
    };
    this.mcpServer = createMcpServer(configWithCallback);
  }

  /**
   * Set up message interception for a transport to record incoming messages
   * This wraps the transport's onmessage handler to record requests/notifications
   */
  private setupMessageInterception(
    transport: StreamableHTTPServerTransport | SSEServerTransport,
  ): void {
    const originalOnMessage = transport.onmessage;
    transport.onmessage = async (message) => {
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
          ? ((params as any)._meta as Record<string, string>)
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

  private async startHttp(port: number): Promise<number> {
    const app = express();
    app.use(express.json());

    // Create HTTP server
    this.httpServer = createHttpServer(app);

    // Set up OAuth if enabled (BEFORE MCP routes)
    if (this.config.oauth?.enabled) {
      // We need baseUrl, but it's not set yet - we'll set it after server starts
      // For now, use a placeholder that will be updated
      const placeholderUrl = `http://localhost:${port}`;
      setupOAuthRoutes(app, this.config.oauth, placeholderUrl);
    }

    // Store transports by sessionId - each transport instance manages ONE session
    const transports: Map<string, StreamableHTTPServerTransport> = new Map();

    // Bearer token middleware for MCP routes if requireAuth
    const mcpMiddleware: express.RequestHandler[] = [];
    if (this.config.oauth?.enabled && this.config.oauth.requireAuth) {
      mcpMiddleware.push(createBearerTokenMiddleware(this.config.oauth));
    }

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
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          // If response already sent (e.g., by OAuth middleware), don't send another
          if (!res.headersSent) {
            res.status(500).json({
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        // New session - create a new transport instance
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sessionId: string) => {
            transports.set(sessionId, newTransport);
          },
          onsessionclosed: (sessionId: string) => {
            transports.delete(sessionId);
          },
        });

        // Set up message interception for this transport
        this.setupMessageInterception(newTransport);

        // Connect the MCP server to this transport
        await this.mcpServer.connect(newTransport);

        try {
          await newTransport.handleRequest(req, res, req.body);
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
        await transport.handleRequest(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    // Start listening on localhost only to avoid macOS firewall prompts
    // Use port 0 to let the OS assign an available port if no port was specified
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
      // The OAuth routes use relative paths, so they'll work with any base URL
      const placeholderUrl = `http://localhost:${port}`;
      setupOAuthRoutes(app, this.config.oauth, placeholderUrl);
    }

    // Bearer token middleware for SSE routes if requireAuth
    const sseMiddleware: express.RequestHandler[] = [];
    if (this.config.oauth?.enabled && this.config.oauth.requireAuth) {
      sseMiddleware.push(createBearerTokenMiddleware(this.config.oauth));
    }

    // Store transports by sessionId (like the SDK example)
    const sseTransports: Map<string, SSEServerTransport> = new Map();

    // GET handler for SSE connection (establishes the SSE stream)
    app.get("/sse", ...sseMiddleware, async (req: Request, res: Response) => {
      this.currentRequestHeaders = extractHeaders(req);
      const sseTransport = new SSEServerTransport("/sse", res);

      // Store transport by sessionId immediately (before connecting)
      sseTransports.set(sseTransport.sessionId, sseTransport);

      // Clean up on connection close
      res.on("close", () => {
        sseTransports.delete(sseTransport.sessionId);
      });

      // Intercept messages
      this.setupMessageInterception(sseTransport);

      // Connect server to transport (this automatically calls start())
      await this.mcpServer.connect(sseTransport);
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

    // Start listening on localhost only to avoid macOS firewall prompts
    // Use port 0 to let the OS assign an available port if no port was specified
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
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.mcpServer.close();

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
          resolve();
        });
      });
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
