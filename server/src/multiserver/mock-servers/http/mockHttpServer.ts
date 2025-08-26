import express from "express";
import { randomUUID } from "node:crypto";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * Mock HTTP MCP Server for testing purposes
 * Provides basic tools, resources, and prompts via HTTP transport
 */
export class MockHttpServer {
  private app: express.Application;
  private server: any;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private port: number;

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.setupExpress();
    this.setupRoutes();
  }

  private setupExpress(): void {
    this.app.use(express.json());

    // CORS configuration for browser-based clients
    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id",
      );
      res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "mock-http-server",
      version: "1.0.0",
    });

    this.setupResources(server);
    this.setupTools(server);
    this.setupPrompts(server);

    return server;
  }

  private setupResources(server: McpServer): void {
    // Static resource
    server.registerResource(
      "http-config",
      "config://http-test",
      {
        title: "HTTP Test Configuration",
        description: "Mock HTTP configuration data for testing",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(
              {
                environment: "http-test",
                transport: "streamable-http",
                features: ["http-feature1", "http-feature2"],
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      }),
    );

    // Dynamic resource with parameters
    server.registerResource(
      "http-data",
      new ResourceTemplate("http-data://{category}/{id}", { list: undefined }),
      {
        title: "HTTP Test Data",
        description: "Mock HTTP data resource with dynamic parameters",
      },
      async (uri, { category, id }) => ({
        contents: [
          {
            uri: uri.href,
            text: `HTTP Test Data\nCategory: ${category}\nID: ${id}\nTimestamp: ${new Date().toISOString()}`,
          },
        ],
      }),
    );
  }

  private setupTools(server: McpServer): void {
    // HTTP-specific calculation tool
    server.registerTool(
      "http-calculate",
      {
        title: "HTTP Calculator",
        description: "Perform calculations via HTTP transport",
        inputSchema: {
          operation: z
            .enum(["add", "subtract", "multiply", "divide"])
            .describe("Mathematical operation"),
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        },
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0) throw new Error("Division by zero");
            result = a / b;
            break;
        }
        return {
          content: [
            {
              type: "text",
              text: `HTTP Calculator Result: ${a} ${operation} ${b} = ${result}`,
            },
          ],
        };
      },
    );

    // HTTP status tool
    server.registerTool(
      "http-status",
      {
        title: "HTTP Status Tool",
        description: "Get HTTP server status information",
        inputSchema: {},
      },
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transport: "streamable-http",
                status: "active",
                activeSessions: Object.keys(this.transports).length,
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      }),
    );

    // Tool that returns HTTP-specific resource links
    server.registerTool(
      "http-list-resources",
      {
        title: "List HTTP Resources",
        description: "List available HTTP test resources",
        inputSchema: {},
      },
      async () => ({
        content: [
          { type: "text", text: "Available HTTP test resources:" },
          {
            type: "resource_link",
            uri: "config://http-test",
            name: "HTTP Test Configuration",
            description: "Mock HTTP configuration data",
          },
          {
            type: "resource_link",
            uri: "http-data://api/sample",
            name: "Sample HTTP Data",
            description: "Sample HTTP test data",
          },
        ],
      }),
    );

    // Async tool that simulates HTTP request
    server.registerTool(
      "http-fetch-simulation",
      {
        title: "HTTP Fetch Simulation",
        description: "Simulate an HTTP request with delay",
        inputSchema: {
          url: z.string().describe("URL to simulate fetching"),
          delay: z
            .number()
            .optional()
            .describe("Delay in milliseconds (default: 1000)"),
        },
      },
      async ({ url, delay = 1000 }) => {
        // Simulate async HTTP request
        await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          content: [
            {
              type: "text",
              text: `Simulated HTTP fetch to ${url} completed after ${delay}ms delay`,
            },
          ],
        };
      },
    );
  }

  private setupPrompts(server: McpServer): void {
    // HTTP-specific prompt
    server.registerPrompt(
      "http-analysis",
      {
        title: "HTTP Analysis Prompt",
        description: "Analyze HTTP-related data",
        argsSchema: {
          endpoint: z.string().describe("HTTP endpoint to analyze"),
          method: z
            .enum(["GET", "POST", "PUT", "DELETE"])
            .describe("HTTP method"),
        },
      },
      ({ endpoint, method }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please analyze the HTTP ${method} request to endpoint: ${endpoint}`,
            },
          },
        ],
      }),
    );

    // Performance analysis prompt
    server.registerPrompt(
      "http-performance",
      {
        title: "HTTP Performance Analysis",
        description: "Analyze HTTP performance metrics",
        argsSchema: {
          metrics: z.string().describe("Performance metrics data"),
          threshold: z
            .string()
            .optional()
            .describe("Performance threshold in ms"),
        },
      },
      ({ metrics, threshold = "1000" }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please analyze these HTTP performance metrics (threshold: ${threshold}ms):\n\n${metrics}`,
            },
          },
        ],
      }),
    );
  }

  private setupRoutes(): void {
    // Handle POST requests for client-to-server communication
    this.app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports[sessionId]) {
          // Reuse existing transport
          transport = this.transports[sessionId];
        } else if (!sessionId) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              this.transports[sessionId] = transport;
              console.log(
                `HTTP Mock Server: New session initialized: ${sessionId}`,
              );
            },
            enableDnsRebindingProtection: false, // Disabled for testing
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              delete this.transports[transport.sessionId];
              console.log(
                `HTTP Mock Server: Session closed: ${transport.sessionId}`,
              );
            }
          };

          const server = this.createMcpServer();
          await server.connect(transport);
        } else {
          // Invalid request
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided",
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("HTTP Mock Server: Error handling request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });

    // Handle GET requests for server-to-client notifications via SSE
    this.app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    });

    // Handle DELETE requests for session termination
    this.app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    });

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        activeSessions: Object.keys(this.transports).length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Start the HTTP mock server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Mock HTTP MCP Server listening on port ${this.port}`);
          console.log(`Health check: http://localhost:${this.port}/health`);
          console.log(`MCP endpoint: http://localhost:${this.port}/mcp`);
          resolve();
        }
      });
    });
  }

  /**
   * Stop the HTTP mock server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all active transports
        Object.values(this.transports).forEach((transport) => {
          transport.close();
        });
        this.transports = {};

        this.server.close(() => {
          console.log("Mock HTTP MCP Server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}/mcp`;
  }

  /**
   * Get health check URL
   */
  getHealthUrl(): string {
    return `http://localhost:${this.port}/health`;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return Object.keys(this.transports).length;
  }
}

// If run directly, start the server
const isMainModule =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMainModule) {
  const port = parseInt(process.env.PORT || "3001");
  const mockServer = new MockHttpServer(port);

  process.on("SIGINT", async () => {
    console.log("\nShutting down HTTP mock server...");
    await mockServer.stop();
    process.exit(0);
  });

  mockServer.start().catch((error) => {
    console.error("Failed to start HTTP mock server:", error);
    process.exit(1);
  });
}
