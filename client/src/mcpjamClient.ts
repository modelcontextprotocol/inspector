import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Request,
  Result,
  Notification,
} from "@modelcontextprotocol/sdk/types.js";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import readline from "readline/promises";
import packageJson from "../package.json";
import { getMCPProxyAddress } from "./utils/configUtils";
import { InspectorConfig } from "./lib/configurationTypes";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport, SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import {
    StreamableHTTPClientTransport,
    StreamableHTTPClientTransportOptions,
  } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InspectorOAuthClientProvider } from "./lib/auth";

// Add interface for extended MCP client with Anthropic
export interface ExtendedMcpClient extends Client {
  anthropic: Anthropic;
  processQuery: (query: string, tools: Tool[]) => Promise<string>;
  chatLoop: (tools: Tool[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

export class MCPJamClient extends Client<Request, Notification, Result>  {
  anthropic: Anthropic;
  clientTransport: Transport | undefined;
  config: InspectorConfig;
  command: string;
  args: string;
  env: Record<string, string>;
  headers: HeadersInit;
  sseUrl: string;
  serverAuthProvider: InspectorOAuthClientProvider;
  mcpProxyServerUrl: URL;
  
  constructor(config: InspectorConfig, command: string, args: string, env: Record<string, string>, headers: HeadersInit, sseUrl: string, serverAuthProvider: InspectorOAuthClientProvider, claudeApiKey?: string) {
    super(
        {name: "mcpjam-inspector", version: packageJson.version},
        {
            capabilities: {
                sampling: {},
                roots: {
                    listChanged: true,
                },
            },
        }
    )
    this.anthropic = new Anthropic({
      apiKey: claudeApiKey,
      dangerouslyAllowBrowser: true,
    });
    this.config = config;
    this.command = command;
    this.args = args;
    this.env = env;
    this.headers = headers;
    this.sseUrl = sseUrl;
    this.serverAuthProvider = serverAuthProvider;
    this.mcpProxyServerUrl = new URL(`${getMCPProxyAddress(this.config)}/stdio`);
  }

  async connectStdio() {
    const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/stdio`);
    serverUrl.searchParams.append("command", this.command);
    serverUrl.searchParams.append("args", this.args);
    serverUrl.searchParams.append("env", JSON.stringify(this.env));
    serverUrl.searchParams.append("transportType", "stdio");
    
    const transportOptions: SSEClientTransportOptions = {
        eventSourceInit: {
            fetch: (url: string | URL | globalThis.Request, init: RequestInit | undefined) => 
                fetch(url, { ...init, headers: this.headers }),
        },
        requestInit: {
            headers: this.headers,
        },
    };
    
    this.mcpProxyServerUrl = serverUrl;
    try {
        // We do this because we're proxying through the inspector server first.
        this.clientTransport = new SSEClientTransport(serverUrl, transportOptions);
        await this.connect(this.clientTransport);
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        throw error; // Re-throw to allow proper error handling
    }
  }

   async connectSSE() {
    try {
        const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/sse`);
        serverUrl.searchParams.append("url", this.sseUrl);
        serverUrl.searchParams.append("transportType", "sse");
        const transportOptions: SSEClientTransportOptions = {
            eventSourceInit: {
                fetch: (url: string | URL | globalThis.Request, init: RequestInit | undefined) => fetch(url, { ...init, headers: this.headers }),
            },
            requestInit: {
                headers: this.headers,
            },
        }
        this.clientTransport = new SSEClientTransport(serverUrl, transportOptions)
        this.mcpProxyServerUrl = serverUrl;
        await this.connect(this.clientTransport)
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        throw error; // Re-throw to allow proper error handling
    }
  }

   async connectStreamableHttp() {
    try {
        const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/mcp`)
        serverUrl.searchParams.append("url", this.sseUrl);
        serverUrl.searchParams.append("transportType", "streamable-http");
        const transportOptions: StreamableHTTPClientTransportOptions = {
            requestInit: {
                headers: this.headers,
            },
            reconnectionOptions: {
                maxReconnectionDelay: 30000,
                initialReconnectionDelay: 1000,
                reconnectionDelayGrowFactor: 1.5,
                maxRetries: 2,
            },
        }
        this.clientTransport = new StreamableHTTPClientTransport(serverUrl, transportOptions)
        this.mcpProxyServerUrl = serverUrl;
        await this.connect(this.clientTransport)
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        throw error; // Re-throw to allow proper error handling
    }
  }

  getTransport() {
    return this.clientTransport;
  }

  getMCPProxyServerUrl() {
    return this.mcpProxyServerUrl;
  }

  async processQuery(query: string, tools: Tool[]): Promise<string> {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const finalText: string[] = [];
    const MAX_ITERATIONS = 5;
    let iteration = 0;

    // Helper function to recursively sanitize schema objects
    const sanitizeSchema = (schema: unknown): unknown => {
      if (!schema || typeof schema !== "object") return schema;

      // Handle array
      if (Array.isArray(schema)) {
        return schema.map((item) => sanitizeSchema(item));
      }

      // Now we know it's an object
      const schemaObj = schema as Record<string, unknown>;
      const sanitized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(schemaObj)) {
        if (
          key === "properties" &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          // Handle properties object
          const propertiesObj = value as Record<string, unknown>;
          const sanitizedProps: Record<string, unknown> = {};
          const keyMapping: Record<string, string> = {};

          for (const [propKey, propValue] of Object.entries(
            propertiesObj,
          )) {
            const sanitizedKey = propKey.replace(/[^a-zA-Z0-9_-]/g, "_");
            keyMapping[propKey] = sanitizedKey;
            sanitizedProps[sanitizedKey] = sanitizeSchema(propValue);
          }

          sanitized[key] = sanitizedProps;

          // Update required fields if they exist
          if (
            "required" in schemaObj &&
            Array.isArray(schemaObj.required)
          ) {
            sanitized.required = (schemaObj.required as string[]).map(
              (req: string) => keyMapping[req] || req,
            );
          }
        } else {
          sanitized[key] = sanitizeSchema(value);
        }
      }

      return sanitized;
    };

    const mappedTools = tools.map((tool: Tool) => {
      // Deep copy and sanitize the schema
      let inputSchema;
      if (tool.input_schema) {
        inputSchema = JSON.parse(JSON.stringify(tool.input_schema));
      } else {
        // If no input schema, create a basic object schema
        inputSchema = {
          type: "object",
          properties: {},
          required: [],
        };
      }

      // Ensure the schema has a type field
      if (!inputSchema.type) {
        inputSchema.type = "object";
      }

      // Ensure properties exists for object types
      if (inputSchema.type === "object" && !inputSchema.properties) {
        inputSchema.properties = {};
      }

      const sanitizedSchema = sanitizeSchema(inputSchema);

      return {
        name: tool.name,
        description: tool.description,
        input_schema: sanitizedSchema,
      } as Tool;
    });

    let response = await this.anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages,
      tools: mappedTools,
    });

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      let hasToolUse = false;

      const assistantContent = [];

      for (const content of response.content) {
        if (content.type === "text") {
          finalText.push(content.text);
          assistantContent.push(content);
        } else if (content.type === "tool_use") {
          hasToolUse = true;
          assistantContent.push(content);

          try {
            const toolName = content.name;
            const toolArgs = content.input as
              | { [x: string]: unknown }
              | undefined;

            const result = await this.callTool({
              name: toolName,
              arguments: toolArgs,
            });

            finalText.push(
              `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
            );

            if (assistantContent.length > 0) {
              messages.push({
                role: "assistant",
                content: assistantContent,
              });
            }

            messages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: content.id,
                  content: result.content as string,
                },
              ],
            });
          } catch (error) {
            console.error(`Tool ${content.name} failed:`, error);
            finalText.push(`[Tool ${content.name} failed: ${error}]`);

            messages.push({
              role: "assistant",
              content: assistantContent,
            });

            messages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: content.id,
                  content: `Error: ${error}`,
                  is_error: true,
                },
              ],
            });
          }
        }
      }

      if (!hasToolUse) {
        break;
      }

      try {
        response = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages,
          tools: mappedTools,
        });
      } catch (error) {
        console.error("API call failed:", error);
        finalText.push(`[API Error: ${error}]`);
        break;
      }
    }

    for (const content of response.content) {
      if (content.type === "text") {
        finalText.push(content.text);
      }
    }

    if (iteration >= MAX_ITERATIONS) {
      finalText.push(
        `[Warning: Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent excessive API usage.]`,
      );
    }

    return finalText.join("\n");
  }

  async chatLoop(tools: Tool[]) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message, tools);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.close();
  }
}
