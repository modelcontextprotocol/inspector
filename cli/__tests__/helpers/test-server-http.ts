import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  SetLevelRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import express from "express";
import * as fs from "node:fs";
import { createServer as createHttpServer, Server as HttpServer } from "http";
import { createServer as createNetServer } from "net";
import type { ServerConfig } from "./test-fixtures.js";
import { randomUUID } from "node:crypto";

export interface RecordedRequest {
  method: string;
  params?: any;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  response: any;
  timestamp: number;
}

async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as { port: number })?.port;
      server.close(() => resolve(port || startPort));
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

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

export class TestServerHttp {
  private server: Server;
  private config: ServerConfig;
  private recordedRequests: RecordedRequest[] = [];
  private httpServer?: HttpServer;
  private url?: string;
  private currentLogLevel: string | null = null;
  private webAppTransports = new Map<string, StreamableHTTPServerTransport>();

  constructor(config: ServerConfig) {
    this.config = config;
    const capabilities: {
      tools?: {};
      resources?: {};
      prompts?: {};
      logging?: {};
    } = {};
    if (config.tools !== undefined) capabilities.tools = {};
    if (config.resources !== undefined) capabilities.resources = {};
    if (config.prompts !== undefined) capabilities.prompts = {};
    if (config.logging === true) capabilities.logging = {};

    this.server = new Server(config.serverInfo, { capabilities });
    this.setupHandlers();
  }

  private setupHandlers() {
    // Tools
    if (this.config.tools !== undefined) {
      this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: (this.config.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: "object",
            properties: tool.inputSchema || {},
          },
        })),
      }));

      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = this.config.tools?.find(
          (t) => t.name === request.params.name,
        );
        if (!tool) throw new Error(`Tool not found: ${request.params.name}`);
        const result = await tool.handler(request.params.arguments || {});
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      });
    }

    // Resources
    if (this.config.resources !== undefined) {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: this.config.resources || [],
      }));

      this.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          const resource = this.config.resources?.find(
            (r) => r.uri === request.params.uri,
          );
          if (!resource)
            throw new Error(`Resource not found: ${request.params.uri}`);
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

    // Prompts
    if (this.config.prompts !== undefined) {
      this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: (this.config.prompts || []).map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: (prompt.argsSchema
            ? Object.entries(prompt.argsSchema).map(([name, schema]) => ({
                name,
                description: (schema as any).description,
                required: !(schema as any).isOptional?.(),
              }))
            : []) as any,
        })),
      }));

      this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const prompt = this.config.prompts?.find(
          (p) => p.name === request.params.name,
        );
        if (!prompt)
          throw new Error(`Prompt not found: ${request.params.name}`);
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Prompt: ${prompt.name}${request.params.arguments ? ` with args: ${JSON.stringify(request.params.arguments)}` : ""}`,
              },
            },
          ],
        };
      });
    }

    if (this.config.logging === true) {
      this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
        this.currentLogLevel = request.params.level;
        return {};
      });
    }
  }

  async start(
    transportType: "http" | "sse",
    requestedPort?: number,
  ): Promise<number> {
    const port = await findAvailablePort(
      requestedPort || (transportType === "http" ? 3001 : 3000),
    );
    const app = express();
    app.use(express.json());
    this.httpServer = createHttpServer(app);

    if (transportType === "http") {
      app.post("/mcp", async (req: Request, res: Response) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        this.currentRequestHeaders = extractHeaders(req);

        const recorded: RecordedRequest = {
          method: req.body?.method || "unknown",
          params: req.body?.params,
          headers: this.currentRequestHeaders,
          metadata: req.body?.params?._meta,
          timestamp: Date.now(),
          response: { processed: true },
        };
        this.recordedRequests.push(recorded);

        if (sessionId) {
          const transport = this.webAppTransports.get(sessionId);
          if (!transport) {
            res.status(404).end("Session not found");
          } else {
            await transport.handleRequest(req, res, req.body);
          }
        } else {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (id) =>
              this.webAppTransports.set(id, transport),
            onsessionclosed: (id) => this.webAppTransports.delete(id),
          });
          await this.server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        }
      });
    } else {
      app.get("/mcp", async (req: Request, res: Response) => {
        this.currentRequestHeaders = extractHeaders(req);
        const recorded: RecordedRequest = {
          method: "sse-connect",
          headers: this.currentRequestHeaders,
          timestamp: Date.now(),
          response: { processed: true },
        };
        this.recordedRequests.push(recorded);

        const transport = new SSEServerTransport("/mcp", res);
        await this.server.connect(transport);
        await transport.start();
      });
    }

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, "127.0.0.1", () => {
        this.url = `http://127.0.0.1:${port}`;
        resolve(port);
      });
      this.httpServer!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    await this.server.close();
    for (const t of this.webAppTransports.values()) await t.close();
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  getUrl(): string {
    if (!this.url) throw new Error("Server not started");
    return this.url;
  }

  getCurrentLogLevel(): string | null {
    return this.currentLogLevel;
  }

  getRecordedRequests(): RecordedRequest[] {
    return [...this.recordedRequests];
  }
}

export function createTestServerHttp(config: ServerConfig): TestServerHttp {
  return new TestServerHttp(config);
}
