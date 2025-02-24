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
  Request,
  Result,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { useState } from "react";
import { toast } from "react-toastify";
import { z } from "zod";
import { SESSION_KEYS } from "../constants";
import { Notification, StdErrNotificationSchema } from "../notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { authProvider } from "../auth";

const DEFAULT_REQUEST_TIMEOUT_MSEC = 10000;

interface UseConnectionOptions {
  transportType: "stdio" | "sse";
  command: string;
  args: string;
  sseUrl: string;
  env: Record<string, string>;
  proxyServerUrl: string;
  requestTimeout?: number;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  onPendingRequest?: (request: any, resolve: any, reject: any) => void;
  getRoots?: () => any[];
}

export function useConnection({
  transportType,
  command,
  args,
  sseUrl,
  env,
  proxyServerUrl,
  requestTimeout = DEFAULT_REQUEST_TIMEOUT_MSEC,
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
  ) => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort("Request timed out");
      }, requestTimeout);

      let response;
      try {
        response = await mcpClient.request(request, schema, {
          signal: abortController.signal,
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
      const errorString = (e as Error).message ?? String(e);
      toast.error(errorString);

      throw e;
    }
  };

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      await mcpClient.notification(notification);
      pushHistory(notification);
    } catch (e: unknown) {
      toast.error((e as Error).message ?? String(e));
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
      const client = new Client<Request, Notification, Result>(
        {
          name: "mcp-inspector",
          version: "0.0.1",
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

      const backendUrl = new URL(`${proxyServerUrl}/sse`);

      backendUrl.searchParams.append("transportType", transportType);
      if (transportType === "stdio") {
        backendUrl.searchParams.append("command", command);
        backendUrl.searchParams.append("args", args);
        backendUrl.searchParams.append("env", JSON.stringify(env));
      } else {
        backendUrl.searchParams.append("url", sseUrl);
      }

      // Inject auth manually instead of using SSEClientTransport, because we're
      // proxying through the inspector server first.
      const headers: HeadersInit = {};
      const tokens = await authProvider.tokens();
      if (tokens) {
        headers["Authorization"] = `Bearer ${tokens.access_token}`;
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
        if (shouldRetry) {
          return connect(undefined, retryCount + 1);
        }

        if (error instanceof SseError && error.code === 401) {
          // Don't set error state if we're about to redirect for auth
          return;
        }
        throw error;
      }

      const capabilities = client.getServerCapabilities();
      setServerCapabilities(capabilities ?? null);

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
      console.error(e);
      setConnectionStatus("error");
    }
  };

  return {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    connect,
  };
}
