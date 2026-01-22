import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "./test-server-fixtures.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Request, Response } from "express";
import express from "express";
import { createServer as createHttpServer, Server as HttpServer } from "http";
import { createServer as createNetServer } from "net";
import * as z from "zod/v4";
import type { ServerConfig } from "./test-server-fixtures.js";

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

    // Create StreamableHTTP transport
    this.transport = new StreamableHTTPServerTransport({});

    // Set up Express route to handle MCP requests
    app.post("/mcp", async (req: Request, res: Response) => {
      // Capture headers for this request
      this.currentRequestHeaders = extractHeaders(req);

      try {
        await (this.transport as StreamableHTTPServerTransport).handleRequest(
          req,
          res,
          req.body,
        );
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle GET requests for SSE stream - this enables server-initiated messages
    app.get("/mcp", async (req: Request, res: Response) => {
      // Capture headers for this request
      this.currentRequestHeaders = extractHeaders(req);

      try {
        await (this.transport as StreamableHTTPServerTransport).handleRequest(
          req,
          res,
        );
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Intercept messages to record them
    const originalOnMessage = this.transport.onmessage;
    this.transport.onmessage = async (message) => {
      const timestamp = Date.now();
      const method =
        "method" in message && typeof message.method === "string"
          ? message.method
          : "unknown";
      const params = "params" in message ? message.params : undefined;

      try {
        // Extract metadata from params if present
        const metadata =
          params && typeof params === "object" && "_meta" in params
            ? ((params as any)._meta as Record<string, string>)
            : undefined;

        // Let the server handle the message
        if (originalOnMessage) {
          await originalOnMessage.call(this.transport, message);
        }

        // Record successful request (response will be sent by transport)
        // Note: We can't easily capture the response here, so we'll record
        // that the request was processed
        this.recordedRequests.push({
          method,
          params,
          headers: { ...this.currentRequestHeaders },
          metadata: metadata ? { ...metadata } : undefined,
          response: { processed: true },
          timestamp,
        });
      } catch (error) {
        // Extract metadata from params if present
        const metadata =
          params && typeof params === "object" && "_meta" in params
            ? ((params as any)._meta as Record<string, string>)
            : undefined;

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

    // Connect transport to server
    await this.mcpServer.connect(this.transport);

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

    // Store transports by sessionId (like the SDK example)
    const sseTransports: Map<string, SSEServerTransport> = new Map();

    // GET handler for SSE connection (establishes the SSE stream)
    app.get("/sse", async (req: Request, res: Response) => {
      this.currentRequestHeaders = extractHeaders(req);
      const sseTransport = new SSEServerTransport("/sse", res);

      // Store transport by sessionId immediately (before connecting)
      sseTransports.set(sseTransport.sessionId, sseTransport);

      // Clean up on connection close
      res.on("close", () => {
        sseTransports.delete(sseTransport.sessionId);
      });

      // Intercept messages
      const originalOnMessage = sseTransport.onmessage;
      sseTransport.onmessage = async (message) => {
        const timestamp = Date.now();
        const method =
          "method" in message && typeof message.method === "string"
            ? message.method
            : "unknown";
        const params = "params" in message ? message.params : undefined;

        try {
          // Extract metadata from params if present
          const metadata =
            params && typeof params === "object" && "_meta" in params
              ? ((params as any)._meta as Record<string, string>)
              : undefined;

          if (originalOnMessage) {
            originalOnMessage.call(sseTransport, message);
          }

          this.recordedRequests.push({
            method,
            params,
            headers: { ...this.currentRequestHeaders },
            metadata: metadata ? { ...metadata } : undefined,
            response: { processed: true },
            timestamp,
          });
        } catch (error) {
          // Extract metadata from params if present
          const metadata =
            params && typeof params === "object" && "_meta" in params
              ? ((params as any)._meta as Record<string, string>)
              : undefined;

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

      // Connect server to transport (this automatically calls start())
      await this.mcpServer.connect(sseTransport);
    });

    // POST handler for SSE message sending (SSE uses GET for stream, POST for sending messages)
    app.post("/sse", async (req: Request, res: Response) => {
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
