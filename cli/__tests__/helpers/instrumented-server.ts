import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import express from "express";
import { createServer as createHttpServer, Server as HttpServer } from "http";
import { createServer as createNetServer } from "net";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>; // JSON Schema
  handler: (params: Record<string, any>) => Promise<any>;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text?: string;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface ServerConfig {
  tools?: ToolDefinition[];
  resources?: ResourceDefinition[];
  prompts?: PromptDefinition[];
}

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
    server.listen(startPort, () => {
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
      headers[key] = value[value.length - 1];
    }
  }
  return headers;
}

export class InstrumentedServer {
  private mcpServer: McpServer;
  private config: ServerConfig;
  private recordedRequests: RecordedRequest[] = [];
  private httpServer?: HttpServer;
  private transport?: StreamableHTTPServerTransport | SSEServerTransport;
  private url?: string;
  private currentRequestHeaders?: Record<string, string>;
  private currentLogLevel: string | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    this.mcpServer = new McpServer(
      {
        name: "instrumented-test-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
      },
    );

    this.setupHandlers();
    this.setupLoggingHandler();
  }

  private setupHandlers() {
    // Set up tools
    if (this.config.tools && this.config.tools.length > 0) {
      for (const tool of this.config.tools) {
        this.mcpServer.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
          },
          async (args) => {
            const result = await tool.handler(args as Record<string, any>);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          },
        );
      }
    }

    // Set up resources
    if (this.config.resources && this.config.resources.length > 0) {
      for (const resource of this.config.resources) {
        this.mcpServer.registerResource(
          resource.name,
          resource.uri,
          {
            description: resource.description,
            mimeType: resource.mimeType,
          },
          async () => {
            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType || "text/plain",
                  text: resource.text || "",
                },
              ],
            };
          },
        );
      }
    }

    // Set up prompts
    if (this.config.prompts && this.config.prompts.length > 0) {
      for (const prompt of this.config.prompts) {
        // Convert arguments array to a schema object if provided
        const argsSchema = prompt.arguments
          ? prompt.arguments.reduce(
              (acc, arg) => {
                acc[arg.name] = {
                  type: "string",
                  description: arg.description,
                };
                return acc;
              },
              {} as Record<string, any>,
            )
          : undefined;

        this.mcpServer.registerPrompt(
          prompt.name,
          {
            description: prompt.description,
            argsSchema,
          },
          async (args) => {
            // Return a simple prompt response
            return {
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Prompt: ${prompt.name}${args ? ` with args: ${JSON.stringify(args)}` : ""}`,
                  },
                },
              ],
            };
          },
        );
      }
    }
  }

  private setupLoggingHandler() {
    // Intercept logging/setLevel requests to track the level
    this.mcpServer.server.setRequestHandler(
      SetLevelRequestSchema,
      async (request) => {
        this.currentLogLevel = request.params.level;
        // Return empty result as per MCP spec
        return {};
      },
    );
  }

  /**
   * Start the server with the specified transport
   */
  async start(
    transport: "http" | "sse",
    requestedPort?: number,
  ): Promise<number> {
    const port = requestedPort
      ? await findAvailablePort(requestedPort)
      : await findAvailablePort(transport === "http" ? 3001 : 3000);

    this.url = `http://localhost:${port}`;

    if (transport === "http") {
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

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, () => {
        resolve(port);
      });
      this.httpServer!.on("error", reject);
    });
  }

  private async startSse(port: number): Promise<number> {
    const app = express();
    app.use(express.json());

    // Create HTTP server
    this.httpServer = createHttpServer(app);

    // For SSE, we need to set up an Express route that creates the transport per request
    // This is a simplified version - SSE transport is created per connection
    app.get("/mcp", async (req: Request, res: Response) => {
      this.currentRequestHeaders = extractHeaders(req);
      const sseTransport = new SSEServerTransport("/mcp", res);

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
            await originalOnMessage.call(sseTransport, message);
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

      await this.mcpServer.connect(sseTransport);
      await sseTransport.start();
    });

    // Note: SSE transport is created per request, so we don't store a single instance
    this.transport = undefined;

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, () => {
        resolve(port);
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
   * Get the server URL
   */
  getUrl(): string {
    if (!this.url) {
      throw new Error("Server not started");
    }
    return this.url;
  }

  /**
   * Get the most recent log level that was set
   */
  getCurrentLogLevel(): string | null {
    return this.currentLogLevel;
  }
}

/**
 * Create an instrumented MCP server for testing
 */
export function createInstrumentedServer(
  config: ServerConfig,
): InstrumentedServer {
  return new InstrumentedServer(config);
}

/**
 * Create a simple "add" tool definition that adds two numbers
 */
export function createAddTool(): ToolDefinition {
  return {
    name: "add",
    description: "Add two numbers together",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    },
    handler: async (params: Record<string, any>) => {
      const a = params.a as number;
      const b = params.b as number;
      return { result: a + b };
    },
  };
}

/**
 * Create a simple "echo" tool definition that echoes back the input
 */
export function createEchoTool(): ToolDefinition {
  return {
    name: "echo",
    description: "Echo back the input message",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo back" },
      },
      required: ["message"],
    },
    handler: async (params: Record<string, any>) => {
      return { message: `Echo: ${params.message as string}` };
    },
  };
}
