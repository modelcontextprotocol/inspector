import { useState, useEffect, useCallback } from "react";
import {
  ServerCapabilities,
  Resource,
  Tool,
  Prompt,
  ClientRequest,
  ClientNotification,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";
import {
  ServerConnection,
  ServerConfig,
  ServerStatus,
} from "../../components/multiserver/types/multiserver";
import { MultiServerApi } from "../../components/multiserver/services/multiServerApi";
import { useToast } from "./useToast";
import {
  multiServerHistoryStore,
  InitializeHistoryData,
} from "../../components/multiserver/stores/multiServerHistoryStore";
import { StdErrNotification } from "../notificationTypes";

interface UseServerConnectionOptions {
  serverId: string;
  server?: ServerConfig;
  onStatusChange?: (status: ServerStatus) => void;
  onConnectionChange?: (connection: ServerConnection) => void;
  onStdErrNotification?: (notification: StdErrNotification) => void;
}

interface ServerConnectionState {
  connection: ServerConnection | null;
  status: ServerStatus;
  isConnecting: boolean;
  isLoading: boolean;
  error: string | null;
  requestHistory: Array<{ request: string; response?: string }>;
  serverNotifications: ServerNotification[];
}

const INITIAL_STATE: ServerConnectionState = {
  connection: null,
  status: { id: "", status: "disconnected" },
  isConnecting: false,
  isLoading: false,
  error: null,
  requestHistory: [],
  serverNotifications: [],
};

export function useServerConnection({
  serverId,
  server,
  onStatusChange,
  onConnectionChange,
  onStdErrNotification,
}: UseServerConnectionOptions) {
  const [state, setState] = useState<ServerConnectionState>({
    ...INITIAL_STATE,
    status: { id: serverId, status: "disconnected" },
  });
  const { toast } = useToast();

  // Update server ID when it changes
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      status: { ...prev.status, id: serverId },
    }));
  }, [serverId]);

  // Load connection status and data
  const loadConnection = useCallback(async () => {
    if (!serverId) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get current status
      const statusResponse = await MultiServerApi.getServerStatus(serverId);

      // Extract the actual status from the response
      // The API returns {status: ServerStatus} but we need just ServerStatus
      const status: ServerStatus =
        (statusResponse as any).status || statusResponse;

      // Get connection if connected
      let connection: ServerConnection | null = null;
      if (status.status === "connected") {
        try {
          const connectionResponse =
            await MultiServerApi.getConnection(serverId);
          connection = connectionResponse.connection || null;
        } catch (error) {
          // Connection might not exist, that's okay
          console.warn("Failed to load connection details:", error);
        }
      }

      setState((prev) => ({
        ...prev,
        status,
        connection,
        isLoading: false,
      }));

      // Notify parent components
      onStatusChange?.(status);
      if (connection) {
        onConnectionChange?.(connection);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load connection";
      setState((prev) => ({
        ...prev,
        error: errorMessage,
        isLoading: false,
        status: { id: serverId, status: "error", lastError: errorMessage },
      }));
    }
  }, [serverId, onStatusChange, onConnectionChange]);

  // Connect to server
  const connect = useCallback(async () => {
    if (!serverId || !server) {
      throw new Error("Server ID and configuration required");
    }

    setState((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
      status: { ...prev.status, status: "connecting" },
    }));

    try {
      const response = await MultiServerApi.connectServer(serverId);

      setState((prev) => ({
        ...prev,
        status: response.status,
        connection: response.connection || null,
        isConnecting: false,
        error: null, // Clear any previous errors
      }));

      // Notify parent components
      onStatusChange?.(response.status);
      if (response.connection) {
        onConnectionChange?.(response.connection);
      }

      toast({
        title: "Success",
        description: `Connected to "${server.name}"`,
      });

      // Always add initialize entry to history (like single-server mode)
      // This ensures the initialize entry appears even if capabilities are not immediately available
      const initializeData: InitializeHistoryData = {
        capabilities: response.connection?.capabilities || undefined,
        // Note: Multi-server API doesn't provide serverInfo or instructions yet
        // These could be enhanced in the future
        serverInfo: undefined,
        instructions: undefined,
      };

      multiServerHistoryStore.addInitializeEntry(
        serverId,
        server.name,
        initializeData,
      );

      // Refresh connection data to ensure UI is in sync
      setTimeout(() => {
        loadConnection();
      }, 100);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";
      const errorStatus: ServerStatus = {
        id: serverId,
        status: "error",
        lastError: errorMessage,
      };

      setState((prev) => ({
        ...prev,
        status: errorStatus,
        connection: null,
        isConnecting: false,
        error: errorMessage,
      }));

      onStatusChange?.(errorStatus);

      toast({
        title: "Connection Error",
        description: `Failed to connect to "${server.name}": ${errorMessage}`,
        variant: "destructive",
      });

      throw error;
    }
  }, [
    serverId,
    server,
    onStatusChange,
    onConnectionChange,
    toast,
    loadConnection,
  ]);

  // Disconnect from server
  const disconnect = useCallback(async () => {
    if (!serverId || !server) return;

    try {
      await MultiServerApi.disconnectServer(serverId);

      const disconnectedStatus: ServerStatus = {
        id: serverId,
        status: "disconnected",
      };

      setState((prev) => ({
        ...prev,
        status: disconnectedStatus,
        connection: null,
        error: null,
      }));

      onStatusChange?.(disconnectedStatus);

      toast({
        title: "Success",
        description: `Disconnected from "${server.name}"`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Disconnect failed";

      toast({
        title: "Error",
        description: `Failed to disconnect from "${server.name}": ${errorMessage}`,
        variant: "destructive",
      });

      throw error;
    }
  }, [serverId, server, onStatusChange, toast]);

  // Add request to history
  const pushHistory = useCallback(
    (request: object, response?: object) => {
      const requestStr = JSON.stringify(request);
      const responseStr =
        response !== undefined ? JSON.stringify(response) : undefined;

      // Add to local state for backward compatibility
      setState((prev) => ({
        ...prev,
        requestHistory: [
          ...prev.requestHistory,
          {
            request: requestStr,
            response: responseStr,
          },
        ],
      }));

      // Add to centralized history store
      if (server) {
        multiServerHistoryStore.addRequest(
          serverId,
          server.name,
          requestStr,
          responseStr,
        );
      }
    },
    [serverId, server],
  );

  // Add server notification
  const addNotification = useCallback(
    (notification: ServerNotification) => {
      // Add to local state for backward compatibility
      setState((prev) => ({
        ...prev,
        serverNotifications: [...prev.serverNotifications, notification],
      }));

      // Add to centralized history store
      if (server) {
        multiServerHistoryStore.addNotification(
          serverId,
          server.name,
          notification,
        );
      }
    },
    [serverId, server],
  );

  // Add stderr notification
  const addStdErrNotification = useCallback(
    (notification: StdErrNotification) => {
      // Add to centralized history store
      multiServerHistoryStore.addStdErrNotification(serverId, notification);

      // Call the callback if provided
      onStdErrNotification?.(notification);
    },
    [serverId, onStdErrNotification],
  );

  // Make request to server via HTTP proxy
  const makeRequest = useCallback(
    async <T extends z.ZodType>(
      request: ClientRequest,
      schema: T,
      options?: RequestOptions & { suppressToast?: boolean },
    ): Promise<z.output<T>> => {
      if (!serverId) {
        throw new Error("No server ID provided");
      }

      // Check connection status before making request
      if (state.status.status !== "connected") {
        const errorMessage = `Server is not connected. Current status: ${state.status.status}`;

        // Only log as warning instead of error to reduce console noise
        console.warn("makeRequest - Server not connected:", {
          serverId,
          status: state.status,
          request: request.method,
        });

        throw new Error(errorMessage);
      }

      try {
        // Make HTTP request to the proxy endpoint
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get("MCP_PROXY_AUTH_TOKEN");

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (token) {
          headers["x-mcp-proxy-auth"] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/mcp/${serverId}/request`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            method: request.method,
            params: request.params,
          }),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: response.statusText }));
          const error = new Error(errorData.message || "Request failed");
          // Add failed request to history
          pushHistory(request, { error: error.message });
          throw error;
        }

        const data = await response.json();

        // Validate the response with the provided schema
        const validatedResult = schema.parse(data.result);

        // Add successful request to history
        pushHistory(request, validatedResult);

        return validatedResult;
      } catch (error) {
        // If we haven't already added to history (for non-HTTP errors), add it now
        if (
          !(error instanceof Error && error.message.includes("Request failed"))
        ) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          pushHistory(request, { error: errorMessage });
        }

        if (!options?.suppressToast) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          toast({
            title: "Request Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
        throw error;
      }
    },
    [serverId, state.status.status, toast, pushHistory],
  );

  // Send notification to server via HTTP proxy
  const sendNotification = useCallback(
    async (notification: ClientNotification) => {
      if (!serverId) {
        throw new Error("No server ID provided");
      }

      if (state.status.status !== "connected") {
        throw new Error("Server is not connected");
      }

      try {
        // Make HTTP request to the proxy endpoint for notifications
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get("MCP_PROXY_AUTH_TOKEN");

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (token) {
          headers["x-mcp-proxy-auth"] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/mcp/${serverId}/request`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            method: notification.method,
            params: notification.params,
          }),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ message: response.statusText }));
          throw new Error(errorData.message || "Notification failed");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast({
          title: "Notification Error",
          description: errorMessage,
          variant: "destructive",
        });
        throw error;
      }
    },
    [serverId, state.status.status, toast],
  );

  // Get server resources
  const getResources = useCallback((): Resource[] => {
    return state.connection?.resources || [];
  }, [state.connection]);

  // Get server tools
  const getTools = useCallback((): Tool[] => {
    return state.connection?.tools || [];
  }, [state.connection]);

  // Get server prompts
  const getPrompts = useCallback((): Prompt[] => {
    return state.connection?.prompts || [];
  }, [state.connection]);

  // Get server capabilities
  const getCapabilities = useCallback((): ServerCapabilities | null => {
    return state.connection?.capabilities || null;
  }, [state.connection]);

  // Check if server is connected
  const isConnected = useCallback((): boolean => {
    // For multi-server mode, prioritize status over connection object
    // This is especially important for streamable HTTP servers which may not
    // populate the connection object in the same way as stdio servers
    return state.status.status === "connected";
  }, [state.status.status]);

  // Check if server is connecting
  const isConnecting = useCallback((): boolean => {
    return state.status.status === "connecting" || state.isConnecting;
  }, [state.status.status, state.isConnecting]);

  // Check if server has error
  const hasError = useCallback((): boolean => {
    return state.status.status === "error" || state.error !== null;
  }, [state.status.status, state.error]);

  // Get error message
  const getError = useCallback((): string | null => {
    return state.status.lastError || state.error;
  }, [state.status.lastError, state.error]);

  // Refresh connection data
  const refresh = useCallback(async () => {
    await loadConnection();
  }, [loadConnection]);

  // Load connection on mount and when serverId changes
  useEffect(() => {
    if (serverId) {
      loadConnection();
    }
  }, [serverId, loadConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup any active connections if needed
      if (state.connection?.client) {
        // Note: We don't automatically disconnect here as the connection
        // might be managed by the parent component or multi-server hook
      }
    };
  }, [state.connection]);

  return {
    // State
    connection: state.connection,
    status: state.status,
    isLoading: state.isLoading,
    error: state.error,

    // Connection management
    connect,
    disconnect,
    refresh,

    // Communication
    makeRequest,
    sendNotification,

    // Data access
    getResources,
    getTools,
    getPrompts,
    getCapabilities,

    // History and notifications
    requestHistory: state.requestHistory,
    serverNotifications: state.serverNotifications,
    addNotification,
    addStdErrNotification,

    // Status checks
    isConnected: isConnected(),
    isConnecting: isConnecting(),
    hasError: hasError(),
    getError,
  };
}
