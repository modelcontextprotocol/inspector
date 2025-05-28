import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SseError,
  SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ClientNotification,
  ClientRequest,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  ResourceUpdatedNotificationSchema,
  LoggingMessageNotificationSchema,
  Request,
  Result,
  ServerCapabilities,
  PromptReference,
  ResourceReference,
  McpError,
  CompleteResultSchema,
  ErrorCode,
  CancelledNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  Progress,
} from "@modelcontextprotocol/sdk/types.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { useState } from "react";
import { useToast } from "@/lib/hooks/useToast";
import { z } from "zod";
import { ConnectionStatus } from "../constants";
import { Notification, StdErrNotificationSchema } from "../notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { InspectorOAuthClientProvider } from "../auth";
import packageJson from "../../../package.json";
import {
  getMCPProxyAddress,
  getMCPServerRequestMaxTotalTimeout,
  resetRequestTimeoutOnProgress,
} from "@/utils/configUtils";
import { getMCPServerRequestTimeout } from "@/utils/configUtils";
import { InspectorConfig } from "../configurationTypes";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import readline from "readline/promises";

interface UseConnectionOptions {
  transportType: "stdio" | "sse" | "streamable-http";
  command: string;
  args: string;
  sseUrl: string;
  env: Record<string, string>;
  bearerToken?: string;
  headerName?: string;
  config: InspectorConfig;
  claudeApiKey?: string;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPendingRequest?: (request: any, resolve: any, reject: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRoots?: () => any[];
}

// Add interface for extended MCP client with Anthropic
interface ExtendedMcpClient extends Client {
  anthropic: Anthropic;
  processQuery: (query: string, tools: Tool[]) => Promise<string>;
  chatLoop: (tools: Tool[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

export function useConnection({
  transportType,
  command,
  args,
  sseUrl,
  env,
  bearerToken,
  headerName,
  config,
  claudeApiKey,
  onNotification,
  onStdErrNotification,
  onPendingRequest,
  getRoots,
}: UseConnectionOptions) {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const { toast } = useToast();
  const [serverCapabilities, setServerCapabilities] =
    useState<ServerCapabilities | null>(null);
  const [mcpClient, setMcpClient] = useState<ExtendedMcpClient | null>(null);
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [completionsSupported, setCompletionsSupported] = useState(true);

  // Add a method to update the API key on the existing client
  const updateApiKey = (newApiKey: string) => {
    if (mcpClient && mcpClient.anthropic) {
      mcpClient.anthropic = new Anthropic({
        apiKey: newApiKey,
        dangerouslyAllowBrowser: true,
      });
    }
  };

  const pushHistory = (request: object, response?: object) => {
    setRequestHistory((prev) => [
      ...prev,
      {
        request: JSON.stringify(request),
        response: response !== undefined ? JSON.stringify(response) : undefined,
      },
    ]);
  };

  const makeRequest = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ): Promise<z.output<T>> => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }
    try {
      const abortController = new AbortController();

      // prepare MCP Client request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress:
          options?.resetTimeoutOnProgress ??
          resetRequestTimeoutOnProgress(config),
        timeout: options?.timeout ?? getMCPServerRequestTimeout(config),
        maxTotalTimeout:
          options?.maxTotalTimeout ??
          getMCPServerRequestMaxTotalTimeout(config),
      };

      // If progress notifications are enabled, add an onprogress hook to the MCP Client request options
      // This is required by SDK to reset the timeout on progress notifications
      if (mcpRequestOptions.resetTimeoutOnProgress) {
        mcpRequestOptions.onprogress = (params: Progress) => {
          // Add progress notification to `Server Notification` window in the UI
          if (onNotification) {
            onNotification({
              method: "notification/progress",
              params,
            });
          }
        };
      }

      let response;
      try {
        response = await mcpClient.request(request, schema, mcpRequestOptions);

        pushHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        pushHistory(request, { error: errorMessage });
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
  };

  const handleCompletion = async (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!mcpClient || !completionsSupported) {
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
      const response = await makeRequest(request, CompleteResultSchema, {
        signal,
        suppressToast: true,
      });
      return response?.completion.values || [];
    } catch (e: unknown) {
      // Disable completions silently if the server doesn't support them.
      // See https://github.com/modelcontextprotocol/specification/discussions/122
      if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
        setCompletionsSupported(false);
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

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      const error = new Error("MCP client not connected");
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }

    try {
      await mcpClient.notification(notification);
      // Log successful notifications
      pushHistory(notification);
    } catch (e: unknown) {
      if (e instanceof McpError) {
        // Log MCP protocol errors
        pushHistory(notification, { error: e.message });
      }
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  const checkProxyHealth = async () => {
    try {
      const proxyHealthUrl = new URL(`${getMCPProxyAddress(config)}/health`);
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

  const is401Error = (error: unknown): boolean => {
    return (
      (error instanceof SseError && error.code === 401) ||
      (error instanceof Error && error.message.includes("401")) ||
      (error instanceof Error && error.message.includes("Unauthorized"))
    );
  };

  const handleAuthError = async (error: unknown) => {
    if (is401Error(error)) {
      const serverAuthProvider = new InspectorOAuthClientProvider(sseUrl);

      const result = await auth(serverAuthProvider, { serverUrl: sseUrl });
      return result === "AUTHORIZED";
    }

    return false;
  };

  const connect = async (_e?: unknown, retryCount: number = 0) => {
    class MCPClient extends Client<Request, Notification, Result> {
      anthropic: Anthropic;
      constructor() {
        super(
          {
            name: "mcpjam-inspector",
            version: packageJson.version,
          },
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
          if (!schema || typeof schema !== 'object') return schema;
      
          // Handle array
          if (Array.isArray(schema)) {
            return schema.map(item => sanitizeSchema(item));
          }
      
          // Now we know it's an object
          const schemaObj = schema as Record<string, unknown>;
          const sanitized: Record<string, unknown> = {};
      
          for (const [key, value] of Object.entries(schemaObj)) {
            if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
              // Handle properties object
              const propertiesObj = value as Record<string, unknown>;
              const sanitizedProps: Record<string, unknown> = {};
              const keyMapping: Record<string, string> = {};
      
              for (const [propKey, propValue] of Object.entries(propertiesObj)) {
                const sanitizedKey = propKey.replace(/[^a-zA-Z0-9_-]/g, '_');
                keyMapping[propKey] = sanitizedKey;
                sanitizedProps[sanitizedKey] = sanitizeSchema(propValue);
              }
      
              sanitized[key] = sanitizedProps;
      
              // Update required fields if they exist
              if ('required' in schemaObj && Array.isArray(schemaObj.required)) {
                sanitized.required = (schemaObj.required as string[]).map(
                  (req: string) => keyMapping[req] || req
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
              required: []
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
                const toolArgs = content.input as { [x: string]: unknown } | undefined;
      
                const result = await this.callTool({
                  name: toolName,
                  arguments: toolArgs,
                });
                
                finalText.push(
                  `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
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
                    }
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
                    }
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
          finalText.push(`[Warning: Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent excessive API usage.]`);
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
    const client = new MCPClient();

    try {
      await checkProxyHealth();
    } catch {
      setConnectionStatus("error-connecting-to-proxy");
      return;
    }

    try {
      // Inject auth manually instead of using SSEClientTransport, because we're
      // proxying through the inspector server first.
      const headers: HeadersInit = {};

      // Create an auth provider with the current server URL
      const serverAuthProvider = new InspectorOAuthClientProvider(sseUrl);

      // Use manually provided bearer token if available, otherwise use OAuth tokens
      const token =
        bearerToken || (await serverAuthProvider.tokens())?.access_token;
      if (token) {
        const authHeaderName = headerName || "Authorization";
        headers[authHeaderName] = `Bearer ${token}`;
      }

      // Create appropriate transport
      let transportOptions:
        | StreamableHTTPClientTransportOptions
        | SSEClientTransportOptions;

      let mcpProxyServerUrl;
      switch (transportType) {
        case "stdio":
          mcpProxyServerUrl = new URL(`${getMCPProxyAddress(config)}/stdio`);
          mcpProxyServerUrl.searchParams.append("command", command);
          mcpProxyServerUrl.searchParams.append("args", args);
          mcpProxyServerUrl.searchParams.append("env", JSON.stringify(env));
          transportOptions = {
            authProvider: serverAuthProvider,
            eventSourceInit: {
              fetch: (
                url: string | URL | globalThis.Request,
                init: RequestInit | undefined,
              ) => fetch(url, { ...init, headers }),
            },
            requestInit: {
              headers,
            },
          };
          break;

        case "sse":
          mcpProxyServerUrl = new URL(`${getMCPProxyAddress(config)}/sse`);
          mcpProxyServerUrl.searchParams.append("url", sseUrl);
          transportOptions = {
            eventSourceInit: {
              fetch: (
                url: string | URL | globalThis.Request,
                init: RequestInit | undefined,
              ) => fetch(url, { ...init, headers }),
            },
            requestInit: {
              headers,
            },
          };
          break;

        case "streamable-http":
          mcpProxyServerUrl = new URL(`${getMCPProxyAddress(config)}/mcp`);
          mcpProxyServerUrl.searchParams.append("url", sseUrl);
          transportOptions = {
            eventSourceInit: {
              fetch: (
                url: string | URL | globalThis.Request,
                init: RequestInit | undefined,
              ) => fetch(url, { ...init, headers }),
            },
            requestInit: {
              headers,
            },
            // TODO these should be configurable...
            reconnectionOptions: {
              maxReconnectionDelay: 30000,
              initialReconnectionDelay: 1000,
              reconnectionDelayGrowFactor: 1.5,
              maxRetries: 2,
            },
          };
          break;
      }
      (mcpProxyServerUrl as URL).searchParams.append(
        "transportType",
        transportType,
      );

      const clientTransport =
        transportType === "streamable-http"
          ? new StreamableHTTPClientTransport(mcpProxyServerUrl as URL, {
              sessionId: undefined,
              ...transportOptions,
            })
          : new SSEClientTransport(mcpProxyServerUrl as URL, transportOptions);

      if (onNotification) {
        [
          CancelledNotificationSchema,
          LoggingMessageNotificationSchema,
          ResourceUpdatedNotificationSchema,
          ResourceListChangedNotificationSchema,
          ToolListChangedNotificationSchema,
          PromptListChangedNotificationSchema,
        ].forEach((notificationSchema) => {
          client.setNotificationHandler(notificationSchema, onNotification);
        });

        client.fallbackNotificationHandler = (
          notification: Notification,
        ): Promise<void> => {
          onNotification(notification);
          return Promise.resolve();
        };
      }

      if (onStdErrNotification) {
        client.setNotificationHandler(
          StdErrNotificationSchema,
          onStdErrNotification,
        );
      }

      let capabilities;
      try {
        await client.connect(clientTransport);

        capabilities = client.getServerCapabilities();
        const initializeRequest = {
          method: "initialize",
        };
        pushHistory(initializeRequest, {
          capabilities,
          serverInfo: client.getServerVersion(),
          instructions: client.getInstructions(),
        });
      } catch (error) {
        console.error(
          `Failed to connect to MCP Server via the MCP Inspector Proxy: ${mcpProxyServerUrl}:`,
          error,
        );

        const shouldRetry = await handleAuthError(error);
        if (shouldRetry) {
          return connect(undefined, retryCount + 1);
        }
        if (is401Error(error)) {
          // Don't set error state if we're about to redirect for auth

          return;
        }
        throw error;
      }
      setServerCapabilities(capabilities ?? null);
      setCompletionsSupported(true); // Reset completions support on new connection

      if (onPendingRequest) {
        client.setRequestHandler(CreateMessageRequestSchema, (request) => {
          return new Promise((resolve, reject) => {
            onPendingRequest(request, resolve, reject);
          });
        });
      }

      if (getRoots) {
        client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: getRoots() };
        });
      }

      setMcpClient(client as ExtendedMcpClient);
      setConnectionStatus("connected");
    } catch (e) {
      console.error(e);
      setConnectionStatus("error");
    }
  };

  const disconnect = async () => {
    await mcpClient?.close();
    const authProvider = new InspectorOAuthClientProvider(sseUrl);
    authProvider.clear();
    setMcpClient(null);
    setConnectionStatus("disconnected");
    setCompletionsSupported(false);
    setServerCapabilities(null);
  };

  return {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    handleCompletion,
    completionsSupported,
    connect,
    disconnect,
    updateApiKey,
  };
}
