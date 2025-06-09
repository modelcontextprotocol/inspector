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
  Message,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import readline from "readline/promises";
import packageJson from "../package.json";
import {
  getMCPProxyAddress,
  getMCPServerRequestMaxTotalTimeout,
  getMCPServerRequestTimeout,
  resetRequestTimeoutOnProgress,
  createDefaultConfig,
} from "@/utils/configUtils";
import { InspectorConfig } from "./lib/configurationTypes";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  SSEClientTransport,
  SSEClientTransportOptions,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InspectorOAuthClientProvider } from "./lib/auth";
import { z } from "zod";
import { ConnectionStatus } from "./lib/constants";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { toast } from "./lib/hooks/useToast";
import {
  StdErrNotificationSchema,
  StdErrNotification,
} from "./lib/notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { HttpServerDefinition, MCPJamServerConfig } from "@/lib/serverTypes";
import { mappedTools } from "@/utils/mcpjamClientHelpers";

// Add interface for extended MCP client with Anthropic
export interface ExtendedMcpClient extends Client {
  anthropic: Anthropic;
  processQuery: (
    query: string,
    tools: Tool[],
    onUpdate?: (content: string) => void,
    model?: string,
  ) => Promise<string>;
  chatLoop: (tools: Tool[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

export class MCPJamClient extends Client<Request, Notification, Result> {
  anthropic?: Anthropic;
  clientTransport: Transport | undefined;
  config: InspectorConfig;
  serverConfig: MCPJamServerConfig;
  headers: HeadersInit;
  mcpProxyServerUrl: URL;
  connectionStatus: ConnectionStatus;
  serverCapabilities: ServerCapabilities | null;
  inspectorConfig: InspectorConfig;
  completionsSupported: boolean;
  bearerToken?: string;
  headerName?: string;
  onStdErrNotification?: (notification: StdErrNotification) => void;
  onPendingRequest?: (
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
  ) => void;
  getRoots?: () => unknown[];
  addRequestHistory: (request: object, response?: object) => void;
  constructor(
    serverConfig: MCPJamServerConfig,
    config: InspectorConfig,
    addRequestHistory: (request: object, response?: object) => void,
    bearerToken?: string,
    headerName?: string,
    onStdErrNotification?: (notification: StdErrNotification) => void,
    claudeApiKey?: string,
    onPendingRequest?: (
      request: CreateMessageRequest,
      resolve: (result: CreateMessageResult) => void,
      reject: (error: Error) => void,
    ) => void,
    getRoots?: () => unknown[],
  ) {
    super(
      { name: "mcpjam-inspector", version: packageJson.version },
      {
        capabilities: {
          sampling: {},
          roots: {
            listChanged: true,
          },
        },
      },
    );
    this.anthropic = new Anthropic({
      apiKey: claudeApiKey,
      dangerouslyAllowBrowser: true,
    });
    this.config = config;
    this.serverConfig = serverConfig;
    this.headers = {};
    this.mcpProxyServerUrl = new URL(
      `${getMCPProxyAddress(this.config)}/stdio`,
    );
    this.bearerToken = bearerToken;
    this.headerName = headerName;
    this.connectionStatus = "disconnected";
    this.serverCapabilities = null;
    this.completionsSupported = true;
    this.inspectorConfig = createDefaultConfig();
    this.onStdErrNotification = onStdErrNotification;
    this.onPendingRequest = onPendingRequest;
    this.getRoots = getRoots;
    this.addRequestHistory = addRequestHistory;
  }

  async connectStdio() {
    const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/stdio`);

    // Type guard to ensure we have a stdio server config
    if (
      this.serverConfig.transportType === "stdio" &&
      "command" in this.serverConfig
    ) {
      serverUrl.searchParams.append("command", this.serverConfig.command);
      serverUrl.searchParams.append(
        "args",
        this.serverConfig.args?.join(" ") ?? "",
      );
      serverUrl.searchParams.append(
        "env",
        JSON.stringify(this.serverConfig.env ?? {}),
      );
    }

    serverUrl.searchParams.append("transportType", "stdio");

    const transportOptions: SSEClientTransportOptions = {
      eventSourceInit: {
        fetch: (
          url: string | URL | globalThis.Request,
          init: RequestInit | undefined,
        ) => fetch(url, { ...init, headers: this.headers }),
      },
      requestInit: {
        headers: this.headers,
      },
    };

    this.mcpProxyServerUrl = serverUrl;
    try {
      // We do this because we're proxying through the inspector server first.
      this.clientTransport = new SSEClientTransport(
        serverUrl,
        transportOptions,
      );
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
      serverUrl.searchParams.append(
        "url",
        (this.serverConfig as HttpServerDefinition).url.toString(),
      );
      serverUrl.searchParams.append("transportType", "sse");
      const transportOptions: SSEClientTransportOptions = {
        eventSourceInit: {
          fetch: (
            url: string | URL | globalThis.Request,
            init: RequestInit | undefined,
          ) => fetch(url, { ...init, headers: this.headers }),
        },
        requestInit: {
          headers: this.headers,
        },
      };
      this.clientTransport = new SSEClientTransport(
        serverUrl,
        transportOptions,
      );
      this.mcpProxyServerUrl = serverUrl;
      await this.connect(this.clientTransport);
      this.connectionStatus = "connected";
    } catch (error) {
      console.error("Error connecting to MCP server:", error);
      this.connectionStatus = "error";
      throw error; // Re-throw to allow proper error handling
    }
  }

  async connectStreamableHttp() {
    try {
      const serverUrl = new URL(`${getMCPProxyAddress(this.config)}/mcp`);
      serverUrl.searchParams.append(
        "url",
        (this.serverConfig as HttpServerDefinition).url.toString(),
      );
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
      };
      this.clientTransport = new StreamableHTTPClientTransport(
        serverUrl,
        transportOptions,
      );
      this.mcpProxyServerUrl = serverUrl;
      await this.connect(this.clientTransport);
      this.connectionStatus = "connected";
    } catch (error) {
      console.error("Error connecting to MCP server:", error);
      this.connectionStatus = "error";
      throw error; // Re-throw to allow proper error handling
    }
  }

  async checkProxyHealth() {
    try {
      const proxyHealthUrl = new URL(
        `${getMCPProxyAddress(this.inspectorConfig)}/health`,
      );
      const proxyHealthResponse = await fetch(proxyHealthUrl);
      const proxyHealth = await proxyHealthResponse.json();
      if (proxyHealth?.status !== "ok") {
        throw new Error("MCP Proxy Server is not healthy");
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  }

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
      if (
        this.serverConfig.transportType !== "stdio" &&
        "url" in this.serverConfig &&
        this.serverConfig.url
      ) {
        const serverAuthProvider = new InspectorOAuthClientProvider(
          this.serverConfig.url.toString(),
        );
        const result = await auth(serverAuthProvider, {
          serverUrl: this.serverConfig.url.toString(),
        });
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
      if (
        this.serverConfig.transportType !== "stdio" &&
        "url" in this.serverConfig &&
        this.serverConfig.url
      ) {
        // Create an auth provider with the current server URL
        const serverAuthProvider = new InspectorOAuthClientProvider(
          this.serverConfig.url.toString(),
        );

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
        this.addRequestHistory(initializeRequest, {
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
            console.log(
              `Retrying connection (attempt ${retryCount + 1}/${MAX_RETRIES})`,
            );
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
  }

  getTransport() {
    return this.clientTransport;
  }

  getMCPProxyServerUrl() {
    return this.mcpProxyServerUrl;
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
    console.log("makeRequestTriggered");
    try {
      const abortController = new AbortController();

      // prepare MCP Client request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress:
          options?.resetTimeoutOnProgress ??
          resetRequestTimeoutOnProgress(this.inspectorConfig),
        timeout:
          options?.timeout ?? getMCPServerRequestTimeout(this.inspectorConfig),
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

        this.addRequestHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.addRequestHistory(request, { error: errorMessage });
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
    const tools = await this.listTools();
    return tools;
  }

  async disconnect() {
    await this.close();
    this.connectionStatus = "disconnected";
    if (this.serverConfig.transportType !== "stdio") {
      const authProvider = new InspectorOAuthClientProvider(
        (this.serverConfig as HttpServerDefinition).url.toString(),
      );
      authProvider.clear();
    }
    this.serverCapabilities = null;
  }

  async setServerCapabilities(capabilities: ServerCapabilities) {
    this.serverCapabilities = capabilities;
  }

  async processQuery(
    query: string,
    tools: Tool[],
    onUpdate?: (content: string) => void,
    model: string = "claude-3-5-sonnet-latest",
  ): Promise<string> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

    const context = this.initializeQueryContext(query, tools, model);
    const response = await this.makeInitialApiCall(context);

    return this.processIterations(response, context, onUpdate);
  }

  private initializeQueryContext(query: string, tools: Tool[], model: string) {
    return {
      messages: [{ role: "user" as const, content: query }] as MessageParam[],
      finalText: [] as string[],
      sanitizedTools: mappedTools(tools),
      model,
      MAX_ITERATIONS: 5,
    };
  }

  private async makeInitialApiCall(
    context: ReturnType<typeof this.initializeQueryContext>,
  ) {
    return this.anthropic!.messages.create({
      model: context.model,
      max_tokens: 1000,
      messages: context.messages,
      tools: context.sanitizedTools,
    });
  }

  private async processIterations(
    initialResponse: Message,
    context: ReturnType<typeof this.initializeQueryContext>,
    onUpdate?: (content: string) => void,
  ): Promise<string> {
    let response = initialResponse;
    let iteration = 0;

    while (iteration < context.MAX_ITERATIONS) {
      iteration++;

      const iterationResult = await this.processIteration(response, context);

      this.sendIterationUpdate(iterationResult.content, onUpdate);

      if (!iterationResult.hasToolUse) {
        break;
      }

      try {
        response = await this.makeFollowUpApiCall(context);
      } catch (error) {
        const errorMessage = `[API Error: ${error}]`;
        context.finalText.push(errorMessage);
        this.sendIterationUpdate(errorMessage, onUpdate);
        break;
      }
    }

    this.handleMaxIterationsWarning(iteration, context, onUpdate);
    return context.finalText.join("\n");
  }

  private async processIteration(
    response: Message,
    context: ReturnType<typeof this.initializeQueryContext>,
  ) {
    const iterationContent: string[] = [];
    const assistantContent: ContentBlock[] = [];
    let hasToolUse = false;

    for (const content of response.content) {
      if (content.type === "text") {
        this.handleTextContent(
          content,
          iterationContent,
          context.finalText,
          assistantContent,
        );
      } else if (content.type === "tool_use") {
        hasToolUse = true;
        await this.handleToolUse(
          content,
          iterationContent,
          context,
          assistantContent,
        );
      }
    }

    return {
      content: iterationContent,
      hasToolUse,
    };
  }

  private handleTextContent(
    content: TextBlock,
    iterationContent: string[],
    finalText: string[],
    assistantContent: ContentBlock[],
  ) {
    iterationContent.push(content.text);
    finalText.push(content.text);
    assistantContent.push(content);
  }

  private async handleToolUse(
    content: ToolUseBlock,
    iterationContent: string[],
    context: ReturnType<typeof this.initializeQueryContext>,
    assistantContent: ContentBlock[],
  ) {
    assistantContent.push(content);

    const toolMessage = this.createToolMessage(content.name, content.input);
    iterationContent.push(toolMessage);
    context.finalText.push(toolMessage);

    try {
      await this.executeToolAndUpdateMessages(
        content,
        context,
        assistantContent,
      );
    } catch (error) {
      this.handleToolError(
        error,
        content,
        iterationContent,
        context,
        assistantContent,
      );
    }
  }

  private createToolMessage(toolName: string, toolArgs: unknown): string {
    return `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`;
  }

  private async executeToolAndUpdateMessages(
    content: ToolUseBlock,
    context: ReturnType<typeof this.initializeQueryContext>,
    assistantContent: ContentBlock[],
  ) {
    const result = await this.callTool({
      name: content.name,
      arguments: content.input as { [x: string]: unknown } | undefined,
    });

    this.addMessagesToContext(
      context,
      assistantContent,
      content.id,
      result.content as string,
    );
  }

  private handleToolError(
    error: unknown,
    content: ToolUseBlock,
    iterationContent: string[],
    context: ReturnType<typeof this.initializeQueryContext>,
    assistantContent: ContentBlock[],
  ) {
    console.error(`Tool ${content.name} failed:`, error);
    const errorMessage = `[Tool ${content.name} failed: ${error}]`;
    iterationContent.push(errorMessage);
    context.finalText.push(errorMessage);

    this.addMessagesToContext(
      context,
      assistantContent,
      content.id,
      `Error: ${error}`,
      true,
    );
  }

  private addMessagesToContext(
    context: ReturnType<typeof this.initializeQueryContext>,
    assistantContent: ContentBlock[],
    toolUseId: string,
    resultContent: string,
    isError = false,
  ) {
    if (assistantContent.length > 0) {
      context.messages.push({
        role: "assistant",
        content: assistantContent,
      });
    }

    context.messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: resultContent,
          ...(isError && { is_error: true }),
        },
      ],
    });
  }

  private async makeFollowUpApiCall(
    context: ReturnType<typeof this.initializeQueryContext>,
  ) {
    return this.anthropic!.messages.create({
      model: context.model,
      max_tokens: 1000,
      messages: context.messages,
      tools: context.sanitizedTools,
    });
  }

  private sendIterationUpdate(
    content: string | string[],
    onUpdate?: (content: string) => void,
  ) {
    if (!onUpdate) return;

    const message = Array.isArray(content) ? content.join("\n") : content;
    if (message.length > 0) {
      onUpdate(message);
    }
  }

  private handleMaxIterationsWarning(
    iteration: number,
    context: ReturnType<typeof this.initializeQueryContext>,
    onUpdate?: (content: string) => void,
  ) {
    if (iteration >= context.MAX_ITERATIONS) {
      const warningMessage = `[Warning: Reached maximum iterations (${context.MAX_ITERATIONS}). Stopping to prevent excessive API usage.]`;
      context.finalText.push(warningMessage);
      this.sendIterationUpdate(warningMessage, onUpdate);
    }
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
