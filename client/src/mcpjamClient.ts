import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Request,
  Result,
  Notification,
  ServerCapabilities,
  ClientRequest,
  Progress,
  ResourceReference,
  PromptReference,
  CompleteResultSchema,
  McpError,
  ErrorCode,
  CreateMessageRequestSchema,
  CreateMessageResult,
  ListRootsRequestSchema,
  CreateMessageRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import readline from "readline/promises";
import packageJson from "../package.json";
import {
  getMCPProxyAddress,
  getMCPServerRequestMaxTotalTimeout,
  getMCPServerRequestTimeout,
  resetRequestTimeoutOnProgress,
} from "@/utils/configUtils";
import { InspectorConfig } from "./lib/configurationTypes";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport, SSEClientTransportOptions, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import {
    StreamableHTTPClientTransport,
    StreamableHTTPClientTransportOptions,
  } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InspectorOAuthClientProvider } from "./lib/auth";
import { z } from "zod";
import { ConnectionStatus } from "./lib/constants";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { toast } from "./lib/hooks/useToast";
import { StdErrNotificationSchema, StdErrNotification } from "./lib/notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { HttpServerDefinition, MCPJamServerConfig } from "./lib/serverTypes";

// Add interface for extended MCP client with Anthropic
export interface ExtendedMcpClient extends Client {
  anthropic: Anthropic;
  processQuery: (query: string, tools: Tool[]) => Promise<string>;
  chatLoop: (tools: Tool[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

export class MCPJamClient extends Client<Request, Notification, Result>  {
  anthropic?: Anthropic;
  clientTransport: Transport | undefined;
  config: InspectorConfig;
  serverConfig: MCPJamServerConfig;
  headers: HeadersInit;
  mcpProxyServerUrl: URL;
  connectionStatus: ConnectionStatus;
  serverCapabilities: ServerCapabilities | null;
  requestHistory: { request: string; response?: string }[];
  inspectorConfig: InspectorConfig;
  completionsSupported: boolean;
  bearerToken?: string;
  headerName?: string;
  onStdErrNotification?: (notification: StdErrNotification) => void;
  onPendingRequest?: (request: CreateMessageRequest, resolve: (result: CreateMessageResult) => void, reject: (error: Error) => void) => void;
  getRoots?: () => unknown[];
  constructor(serverConfig: MCPJamServerConfig, config: InspectorConfig, headers: HeadersInit, bearerToken?: string, headerName?: string, onStdErrNotification?: (notification: StdErrNotification) => void, claudeApiKey?: string, onPendingRequest?: (request: CreateMessageRequest, resolve: (result: CreateMessageResult) => void, reject: (error: Error) => void) => void, getRoots?: () => unknown[]) {
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
    this.serverConfig = serverConfig;
    this.headers = headers;
    this.mcpProxyServerUrl = new URL(`${getMCPProxyAddress(this.config)}/stdio`);
    this.bearerToken = bearerToken;
    this.headerName = headerName;
    this.connectionStatus = "disconnected";
    this.serverCapabilities = null;
    this.requestHistory = []
    this.completionsSupported = true
    this.inspectorConfig  = {
      MCP_SERVER_REQUEST_TIMEOUT: {
          label: "MCP Server Request Timeout",
          description: "Maximum time in milliseconds to wait for a response from the MCP server",
          value: 30000
      },
      MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS: {
          label: "Reset Timeout on Progress",
          description: "Whether to reset the timeout on progress notifications",
          value: true
      },
      MCP_REQUEST_MAX_TOTAL_TIMEOUT: {
          label: "Max Total Timeout",
          description: "Maximum total time in milliseconds to wait for a response",
          value: 300000
      },
      MCP_PROXY_FULL_ADDRESS: {
          label: "MCP Proxy Address",
          description: "The full address of the MCP Proxy Server",
          value: "http://localhost:6277"
      }
    };
    this.onStdErrNotification = onStdErrNotification;
    this.onPendingRequest = onPendingRequest;
    this.getRoots = getRoots;
  }

  async connectStdio() {
    const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/stdio`);
    
    // Type guard to ensure we have a stdio server config
    if (this.serverConfig.transportType === "stdio" && "command" in this.serverConfig) {
      serverUrl.searchParams.append("command", this.serverConfig.command);
      serverUrl.searchParams.append("args", this.serverConfig.args?.join(" ") ?? "");
      serverUrl.searchParams.append("env", JSON.stringify(this.serverConfig.env ?? {}));
    }
    
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
        this.connectionStatus = "connected";
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        this.connectionStatus = "error";
        throw error; // Re-throw to allow proper error handling
    }
  }

   async connectSSE() {
    try {
        const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/sse`);
        serverUrl.searchParams.append("url", (this.serverConfig as HttpServerDefinition).url.toString());
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
        this.connectionStatus = "connected";
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        this.connectionStatus = "error";
        throw error; // Re-throw to allow proper error handling
    }
  }

   async connectStreamableHttp() {
    try {
        const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/mcp`)
        serverUrl.searchParams.append("url", (this.serverConfig as HttpServerDefinition).url.toString());
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
        this.connectionStatus = "connected";
    } catch (error) {
        console.error("Error connecting to MCP server:", error);
        this.connectionStatus = "error";
        throw error; // Re-throw to allow proper error handling
    }
  }

  async checkProxyHealth() {
    try {
      const proxyHealthUrl = new URL(`${getMCPProxyAddress(this.inspectorConfig)}/health`);
      const proxyHealthResponse = await fetch(proxyHealthUrl);
      const proxyHealth = await proxyHealthResponse.json();
      if (proxyHealth?.status !== "ok") {
        throw new Error("MCP Proxy Server is not healthy");
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  };

  is401Error = (error: unknown): boolean => {
    return (
      (error instanceof SseError && error.code === 401) ||
      (error instanceof Error && error.message.includes("401")) ||
      (error instanceof Error && error.message.includes("Unauthorized"))
    );
  };

  handleAuthError = async (error: unknown) => {
    if (this.is401Error(error)) {
      // Only handle OAuth for HTTP-based transports
      if (this.serverConfig.transportType !== "stdio" && "url" in this.serverConfig && this.serverConfig.url) {
        const serverAuthProvider = new InspectorOAuthClientProvider(this.serverConfig.url.toString());
        const result = await auth(serverAuthProvider, { serverUrl: this.serverConfig.url.toString() });
        return result === "AUTHORIZED";
      }
    }

    return false;
  };

  async connectToServer(_e?: unknown, retryCount: number = 0): Promise<void> {
    const MAX_RETRIES = 1; // Limit retries to prevent infinite loops
    
    try {
      await this.checkProxyHealth();
    } catch {
      this.connectionStatus = "error-connecting-to-proxy";
      return;
    }

    try {
      // Inject auth manually instead of using SSEClientTransport, because we're
      // proxying through the inspector server first.
      const headers: HeadersInit = {};

      // Only apply OAuth authentication for HTTP-based transports
      if (this.serverConfig.transportType !== "stdio" && "url" in this.serverConfig && this.serverConfig.url) {
        // Create an auth provider with the current server URL
        const serverAuthProvider = new InspectorOAuthClientProvider(this.serverConfig.url.toString());

        // Use manually provided bearer token if available, otherwise use OAuth tokens
        const token =
          this.bearerToken || (await serverAuthProvider.tokens())?.access_token;
        if (token) {
          const authHeaderName = this.headerName || "Authorization";
          headers[authHeaderName] = `Bearer ${token}`;
        }
      } else if (this.bearerToken) {
        // For stdio or when manually providing bearer token, still apply it
        const authHeaderName = this.headerName || "Authorization";
        headers[authHeaderName] = `Bearer ${this.bearerToken}`;
      }

      // Update the headers property with auth headers
      this.headers = { ...this.headers, ...headers };

      if (this.onStdErrNotification) {
        this.setNotificationHandler(
          StdErrNotificationSchema,
          this.onStdErrNotification,
        );
      }

      try {
        switch (this.serverConfig.transportType) {
          case "stdio":
            await this.connectStdio();
            break;
          case "sse":
            await this.connectSSE();
            break;
          case "streamable-http":
            await this.connectStreamableHttp();
            break;
        }
        
        // Update server capabilities after successful connection
        this.serverCapabilities = this.getServerCapabilities() ?? null;
        console.log("capabilities", this.serverCapabilities);
        
        const initializeRequest = {
          method: "initialize",
        };
        this.pushRequestHistory(initializeRequest, {
          capabilities: this.serverCapabilities,
          serverInfo: this.getServerVersion(),
          instructions: this.getInstructions(),
        });
      } catch (error) {
        console.error(
          `Failed to connect to MCP Server via the MCP Inspector Proxy: ${this.getMCPProxyServerUrl()}:`,
          error,
        );

        // Only retry if we haven't exceeded max retries and auth error handling succeeds
        if (retryCount < MAX_RETRIES) {
          const shouldRetry = await this.handleAuthError(error);
          if (shouldRetry) {
            console.log(`Retrying connection (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            return this.connectToServer(undefined, retryCount + 1);
          }
        }
        
        if (this.is401Error(error)) {
          // Don't set error state if we're about to redirect for auth
          this.connectionStatus = "error";
          return;
        }
        throw error;
      }
      this.completionsSupported = true; // Reset completions support on new connection

      if (this.onPendingRequest) {
        this.setRequestHandler(CreateMessageRequestSchema, (request) => {
          return new Promise((resolve, reject) => {
            this.onPendingRequest?.(request, resolve, reject);
          });
        });
      }

      if (this.getRoots) {
        this.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: this.getRoots?.() ?? [] };
        });
      }

      this.connectionStatus = "connected";
    } catch (e) {
      console.error(e);
      this.connectionStatus = "error";
    }
  };

  getTransport() {
    return this.clientTransport;
  }

  getMCPProxyServerUrl() {
    return this.mcpProxyServerUrl;
  }
  
  pushRequestHistory(request: object, response?: object) {
    this.requestHistory.push({
      request: JSON.stringify(request),
      response: response !== undefined ? JSON.stringify(response) : undefined,
    });
  }

  updateApiKey = (newApiKey: string) => {
    if (this.anthropic) {
      this.anthropic = new Anthropic({
        apiKey: newApiKey,
        dangerouslyAllowBrowser: true,
      });
    }
  };

  async makeRequest<T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ): Promise<z.output<T>> {
    try {
      const abortController = new AbortController();

      // prepare MCP Client request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress:
          options?.resetTimeoutOnProgress ??
          resetRequestTimeoutOnProgress(this.inspectorConfig),
        timeout: options?.timeout ?? getMCPServerRequestTimeout(this.inspectorConfig),
        maxTotalTimeout:
          options?.maxTotalTimeout ??
          getMCPServerRequestMaxTotalTimeout(this.inspectorConfig),
      };

      // If progress notifications are enabled, add an onprogress hook to the MCP Client request options
      // This is required by SDK to reset the timeout on progress notifications
      if (mcpRequestOptions.resetTimeoutOnProgress) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        mcpRequestOptions.onprogress = (_params: Progress) => {
          // Add progress notification to `Server Notification` window in the UI
          // TODO: Add Notification to UI
        };
      }

      let response;
      try {
        response = await this.request(request, schema, mcpRequestOptions);

        this.pushRequestHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.pushRequestHistory(request, { error: errorMessage });
        throw error;
      }

      return response;
    } catch (e: unknown) {
      if (!options?.suppressToast) {
        const errorString = (e as Error).message ?? String(e);
        toast({
          title: "Error",
          description: errorString,
          variant: "destructive",
        });
      }
      throw e;
    }
  }

  handleCompletion = async (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!this.completionsSupported) {
      return [];
    }

    const request: ClientRequest = {
      method: "completion/complete",
      params: {
        argument: {
          name: argName,
          value,
        },
        ref,
      },
    };

    try {
      const response = await this.makeRequest(request, CompleteResultSchema, {
        signal,
        suppressToast: true,
      });
      return response?.completion.values || [];
    } catch (e: unknown) {
      // Disable completions silently if the server doesn't support them.
      // See https://github.com/modelcontextprotocol/specification/discussions/122
      if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
        this.completionsSupported = false;
        return [];
      }

      // Unexpected errors - show toast and rethrow
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  async tools() {
    return await this.listTools();
  }

  async disconnect() {
    await this.close();
    this.connectionStatus = "disconnected";
    if (this.serverConfig.transportType !== "stdio") {
      const authProvider = new InspectorOAuthClientProvider((this.serverConfig as HttpServerDefinition).url.toString());
      authProvider.clear();
    }
    this.serverCapabilities = null;
  }

  async setServerCapabilities(capabilities: ServerCapabilities) {
    this.serverCapabilities = capabilities;
  }

  async processQuery(query: string, tools: Tool[]): Promise<string> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

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
