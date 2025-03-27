import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  ClientNotification,
  ClientRequest,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  ProgressNotificationSchema,
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
} from "@modelcontextprotocol/sdk/types.js";
import { useState, useRef } from "react";
import { toast } from "react-toastify";
import { z } from "zod";
import { SESSION_KEYS } from "../constants";
import { Notification, StdErrNotificationSchema } from "../notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { authProvider } from "../auth";
import packageJson from "../../../package.json";

import { 
  DirectSseTransport as RealDirectSseTransport, 
  DirectStreamableHttpTransport as RealDirectStreamableHttpTransport,
  DirectTransportError as RealDirectTransportError
} from "../directTransports";

// Use the imported classes
const DirectSseTransport = RealDirectSseTransport;
const DirectStreamableHttpTransport = RealDirectStreamableHttpTransport;
const DirectTransportError = RealDirectTransportError;

const params = new URLSearchParams(window.location.search);
const DEFAULT_REQUEST_TIMEOUT_MSEC =
  parseInt(params.get("timeout") ?? "") || 10000;

interface UseConnectionOptions {
  transportType: "stdio" | "sse" | "streamableHttp";
  command: string;
  args: string;
  sseUrl: string;
  env: Record<string, string>;
  proxyServerUrl: string;
  bearerToken?: string;
  requestTimeout?: number;
  directConnection?: boolean;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  onPendingRequest?: (request: unknown, resolve: unknown, reject: unknown) => void;
  getRoots?: () => unknown[];
}

interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  suppressToast?: boolean;
}

async function testCORSWithServer(serverUrl: URL): Promise<boolean> {
  try {
    console.log(`Testing CORS settings with server at ${serverUrl.toString()}`);
    
    console.log(`Sending preflight OPTIONS request to ${serverUrl.toString()}`);
    const preflightResponse = await fetch(serverUrl.toString(), {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Mcp-Session-Id',
        'Origin': window.location.origin
      }
    });
    
    console.log(`CORS preflight response status: ${preflightResponse.status}`);
    console.log(`CORS headers in preflight response:`, {
      'Access-Control-Allow-Origin': preflightResponse.headers.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': preflightResponse.headers.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': preflightResponse.headers.get('Access-Control-Allow-Headers'),
      'Access-Control-Expose-Headers': preflightResponse.headers.get('Access-Control-Expose-Headers')
    });
    
    return preflightResponse.ok;
  } catch (error) {
    console.error(`Error testing CORS settings: ${(error as Error).message}`);
    return false;
  }
}

export function useConnection({
  transportType,
  command,
  args,
  sseUrl,
  env,
  proxyServerUrl,
  bearerToken,
  requestTimeout = DEFAULT_REQUEST_TIMEOUT_MSEC,
  directConnection = false,
  onNotification,
  onStdErrNotification,
  onPendingRequest,
  getRoots,
}: UseConnectionOptions) {
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connected" | "error"
  >("disconnected");
  const [serverCapabilities, setServerCapabilities] =
    useState<ServerCapabilities | null>(null);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [completionsSupported, setCompletionsSupported] = useState(true);
  const connectAttempts = useRef(0);

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
    options?: RequestOptions,
  ): Promise<z.output<T>> => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort("Request timed out");
      }, options?.timeout ?? requestTimeout);

      let response;
      try {
        response = await mcpClient.request(request, schema, {
          signal: options?.signal ?? abortController.signal,
        });
        pushHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        pushHistory(request, { error: errorMessage });
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      return response;
    } catch (e: unknown) {
      if (!options?.suppressToast) {
        const errorString = (e as Error).message ?? String(e);
        toast.error(errorString);
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
      if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
        setCompletionsSupported(false);
        return [];
      }

      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      const error = new Error("MCP client not connected");
      toast.error(error.message);
      throw error;
    }

    try {
      await mcpClient.notification(notification);
      pushHistory(notification);
    } catch (e: unknown) {
      if (e instanceof McpError) {
        pushHistory(notification, { error: e.message });
      }
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const handleAuthError = async (error: unknown) => {
    if (error instanceof SseError && error.code === 401) {
      sessionStorage.setItem(SESSION_KEYS.SERVER_URL, sseUrl);

      const result = await auth(authProvider, { serverUrl: sseUrl });
      return result === "AUTHORIZED";
    }

    return false;
  };

  const connect = async (_e?: unknown, retryCount: number = 0) => {
    try {
      setConnectionStatus("disconnected");
      connectAttempts.current++;
      
      const client = new Client<Request, Notification, Result>(
        {
          name: "mcp-inspector",
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

      if (directConnection && transportType !== "stdio") {
        console.log(`Connecting directly to MCP server using ${transportType} transport`);
        
        const serverUrl = new URL(sseUrl);
        
        if (transportType === "streamableHttp" && !serverUrl.pathname.endsWith("/mcp")) {
          if (serverUrl.pathname === "/" || !serverUrl.pathname) {
            serverUrl.pathname = "/mcp";
          }
        }
        
        const corsOk = await testCORSWithServer(serverUrl);
        if (!corsOk) {
          console.warn("CORS preflight test failed. Connection might still work, but be prepared for CORS errors.");
        }
        
        const directHeaders: Record<string, string> = {};
        if (bearerToken) {
          directHeaders["Authorization"] = `Bearer ${bearerToken}`;
        }
        directHeaders["Content-Type"] = "application/json";
        
        const origin = window.location.origin;
        console.log(`Creating direct connection from origin: ${origin} to ${serverUrl.toString()}`);
        
        let clientTransport;
        if (transportType === "sse") {
          clientTransport = new DirectSseTransport(serverUrl, {
            headers: directHeaders,
            useCredentials: false 
          });
        } else if (transportType === "streamableHttp") {
          clientTransport = new DirectStreamableHttpTransport(serverUrl, {
            headers: directHeaders,
            useCredentials: false 
          });
        } else {
          throw new Error(`Unsupported transport type for direct connection: ${transportType}`);
        }
        
        if (onNotification) {
          client.setNotificationHandler(ProgressNotificationSchema, onNotification);
          client.setNotificationHandler(ResourceUpdatedNotificationSchema, onNotification);
          client.setNotificationHandler(LoggingMessageNotificationSchema, onNotification);
        }
        
        if (onStdErrNotification) {
          client.setNotificationHandler(StdErrNotificationSchema, onStdErrNotification);
        }
        
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
        
        try {
          console.log("Connecting to MCP server directly...");
          await client.connect(clientTransport);
          console.log("Connected directly to MCP server");
          
          const capabilities = client.getServerCapabilities();
          setServerCapabilities(capabilities ?? null);
          setCompletionsSupported(true);
          
          setMcpClient(client);
          setConnectionStatus("connected");
          return;
        } catch (error) {
          console.error("Failed to connect directly to MCP server:", error);
          
          if (error instanceof DirectTransportError) {
            console.error("DirectTransportError details:", {
              code: error.code,
              message: error.message,
              response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
              } : undefined
            });
          }
          
          const shouldRetry = await handleAuthError(error);
          if (shouldRetry && retryCount < 3) {
            return connect(undefined, retryCount + 1);
          }
          
          throw error;
        }
      }

      const backendUrl = new URL(`${proxyServerUrl}/sse`);

      backendUrl.searchParams.append("transportType", transportType);
      
      if (transportType === "stdio") {
        backendUrl.searchParams.append("command", command);
        backendUrl.searchParams.append("args", args);
        backendUrl.searchParams.append("env", JSON.stringify(env));
      } else {
        const url = new URL(sseUrl);
        
        if (transportType === "streamableHttp" && !url.pathname) {
          url.pathname = "/mcp";
        }
        
        backendUrl.searchParams.append("url", url.toString());
      }

      const headers: HeadersInit = {};

      const token = bearerToken || (await authProvider.tokens())?.access_token;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const clientTransport = new SSEClientTransport(backendUrl, {
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
        requestInit: {
          headers,
        },
      });

      if (onNotification) {
        client.setNotificationHandler(
          ProgressNotificationSchema,
          onNotification,
        );

        client.setNotificationHandler(
          ResourceUpdatedNotificationSchema,
          onNotification,
        );

        client.setNotificationHandler(
          LoggingMessageNotificationSchema,
          onNotification,
        );
      }

      if (onStdErrNotification) {
        client.setNotificationHandler(
          StdErrNotificationSchema,
          onStdErrNotification,
        );
      }

      try {
        await client.connect(clientTransport);
      } catch (error) {
        console.error("Failed to connect to MCP server:", error);
        const shouldRetry = await handleAuthError(error);
        if (shouldRetry && retryCount < 3) {
          return connect(undefined, retryCount + 1);
        }

        if (error instanceof SseError && error.code === 401) {
          return;
        }
        throw error;
      }

      const capabilities = client.getServerCapabilities();
      setServerCapabilities(capabilities ?? null);
      setCompletionsSupported(true);

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

      setMcpClient(client);
      setConnectionStatus("connected");
    } catch (e) {
      console.error("Connection error:", e);
      setConnectionStatus("error");
      
      if (retryCount < 2) {
        setTimeout(() => {
          connect(undefined, retryCount + 1);
        }, 1000);
      } else {
        toast.error("Failed to connect to MCP server after multiple attempts");
      }
    }
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
  };
}
