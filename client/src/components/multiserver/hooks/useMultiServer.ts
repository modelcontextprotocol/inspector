import { useState, useEffect, useCallback, useRef } from "react";
import {
  MultiServerState,
  ServerConfig,
  ServerStatus,
  ServerConnection,
  CreateServerRequest,
  UpdateServerRequest,
  MultiServerEvent,
} from "../types/multiserver";
import {
  MultiServerApi,
  MultiServerApiError,
} from "../services/multiServerApi";
import { useToast } from "../../../lib/hooks/useToast";
import {
  multiServerHistoryStore,
  InitializeHistoryData,
} from "../stores/multiServerHistoryStore";
import {
  LoggingLevelSchema,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import {
  mergeServerStates,
  restoreMultiServerState,
  persistMultiServerState,
} from "../utils/stateManager";
import { globalEventStreamManager } from "../utils/eventStreamManager";
import { clientLoggingSync } from "../utils/loggingLevelSync";
import { invalidateServerCache } from "../utils/localStorage";
import { useConsoleErrorInterception } from "./useConsoleErrorInterception";

const getInitialMode = (): "single" | "multi" => {
  const savedMode = localStorage.getItem("mcp-inspector-mode");
  return savedMode === "multi" || savedMode === "single" ? savedMode : "single";
};

const INITIAL_STATE: MultiServerState = {
  servers: [],
  connections: new Map(),
  statuses: new Map(),
  selectedServerId: null,
  isLoading: false,
  error: null,
  mode: getInitialMode(),
};

export function useMultiServer() {
  const [state, setState] = useState<MultiServerState>(INITIAL_STATE);
  const { toast } = useToast();

  // Flag to prevent multiple initializations
  const [hasInitialized, setHasInitialized] = useState(false);

  // Add ref to track initialization state
  const initializationInProgress = useRef(false);

  // Add ref to store current connections for getServerConnection
  const connectionsRef = useRef<Map<string, ServerConnection>>(new Map());

  // Get current server info for console error interception
  const currentServer = state.selectedServerId
    ? state.servers.find((s) => s.id === state.selectedServerId)
    : null;

  // Set up console error interception for the selected server
  useConsoleErrorInterception({
    enabled: state.mode === "multi",
    currentServerId: state.selectedServerId,
    serverName: currentServer?.name || null,
  });

  // Initialize and load servers
  const initialize = useCallback(async () => {
    // Prevent multiple simultaneous initializations
    if (initializationInProgress.current) {
      console.log(
        "Initialization already in progress, skipping duplicate call",
      );
      return;
    }

    initializationInProgress.current = true;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Better session detection - check if we have any persisted state
      const hasPersistedState =
        localStorage.getItem("mcp-inspector-multiserver-state") !== null;
      const restoredState = hasPersistedState
        ? restoreMultiServerState()
        : null;

      // Fetch current state from API with better error handling
      let response;
      try {
        response = await MultiServerApi.getServers();
      } catch (apiError) {
        console.error("API error during initialization:", apiError);

        // If API fails but we have persisted state, use it
        if (restoredState) {
          const persistedStatuses = new Map(
            Object.entries(restoredState.statuses || {}).map(([id, status]) => [
              id,
              status,
            ]),
          );

          setState((prev) => ({
            ...prev,
            servers: restoredState.servers || [],
            statuses: persistedStatuses,
            selectedServerId: restoredState.selectedServerId || null,
            isLoading: false,
            error: "API unavailable - using cached data",
          }));
          return;
        }

        throw apiError;
      }

      const apiServers = response.servers.map((s) => s.server);
      const apiStatuses = new Map(
        response.servers.map((s) => [s.server.id, s.status]),
      );

      // For new sessions, only use API data. For existing sessions, merge with localStorage
      let finalServers, finalStatuses, finalSelectedServerId;

      if (!hasPersistedState || !restoredState) {
        finalServers = apiServers;
        finalStatuses = apiStatuses;
        finalSelectedServerId = null;
      } else {
        // Merge localStorage state with API state for existing sessions
        const persistedState = {
          servers: restoredState.servers,
          statuses: Object.fromEntries(restoredState.statuses),
          selectedServerId: restoredState.selectedServerId,
          lastUpdated: Date.now(),
        };

        const mergedState = mergeServerStates(
          apiServers,
          apiStatuses,
          persistedState,
        );
        finalServers = mergedState.servers;
        finalStatuses = mergedState.statuses;
        finalSelectedServerId = mergedState.selectedServerId;
      }

      // Load existing connections
      const connections = await MultiServerApi.getConnections();

      const connectionMap = new Map(
        connections
          .filter(
            (connResponse) => connResponse.connection && connResponse.serverId,
          ) // Only include responses with actual connections AND valid serverId
          .map((connResponse) => {
            const connection = connResponse.connection!;
            const serverConnection: ServerConnection = {
              id: connResponse.serverId,
              client: connection.client || null,
              transport: connection.transport || null,
              capabilities: connection.capabilities || null,
              serverInfo: connection.serverInfo || null,
              instructions: connection.instructions || null,
              resources: connection.resources || [],
              tools: connection.tools || [],
              prompts: connection.prompts || [],
              logLevel: connection.logLevel || LoggingLevelSchema.enum.info,
              loggingSupported: !!connection.capabilities?.logging,
            };

            return [connResponse.serverId, serverConnection];
          }),
      );

      setState((prev) => ({
        ...prev,
        servers: finalServers,
        statuses: finalStatuses,
        selectedServerId: finalSelectedServerId,
        connections: connectionMap,
        isLoading: false,
      }));
    } catch (error) {
      console.error("Error during initialization:", error);
      const errorMessage =
        error instanceof MultiServerApiError
          ? error.message
          : "Failed to load servers";

      setState((prev) => ({
        ...prev,
        error: errorMessage,
        isLoading: false,
      }));
    } finally {
      initializationInProgress.current = false;
    }
  }, []); // Remove toast dependency

  // Initialize with retry logic
  const initializeWithRetry = useCallback(
    async (retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await initialize();
          return; // Success, exit retry loop
        } catch (error) {
          console.error(`Initialization attempt ${attempt} failed:`, error);

          if (attempt === retries) {
            // Final attempt failed
            const errorMessage =
              error instanceof MultiServerApiError
                ? error.message
                : "Failed to load servers after multiple attempts";

            setState((prev) => ({
              ...prev,
              error: errorMessage,
              isLoading: false,
            }));
            return;
          }

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    },
    [initialize],
  );

  // Set up event stream listener using global event stream manager
  const setupEventStreamListener = useCallback(() => {
    const handleEvent = (data: MultiServerEvent) => {
      // Use setTimeout to avoid updating state during render
      setTimeout(() => {
        // Handle history store updates outside of setState to prevent setState during render
        let historyUpdateFn: (() => void) | null = null;

        setState((prev) => {
          const newState = { ...prev };

          switch (data.type) {
            case "status_change":
              newState.statuses = new Map(prev.statuses);
              newState.statuses.set(data.serverId, data.status);
              break;

            case "connection_change":
              newState.connections = new Map(prev.connections);
              // Ensure the connection has the required client-side properties
              const enhancedConnection: ServerConnection = {
                ...data.connection,
                loggingSupported: !!data.connection.capabilities?.logging,
              };
              newState.connections.set(data.serverId, enhancedConnection);

              // Also update the connectionsRef immediately for completion callbacks
              connectionsRef.current = new Map(newState.connections);
              break;

            case "notification":
              // Prepare history store update for after setState
              if (data.notification && data.serverName) {
                historyUpdateFn = () => {
                  // Check if this is an initialization notification (logging message after connection)
                  if (
                    data.notification.method === "notifications/message" &&
                    data.notification.params &&
                    (data.notification.params as any).data?.includes(
                      "Logging level set to:",
                    )
                  ) {
                    // This is an initialization notification - also create an initialize entry
                    const connection = prev.connections.get(data.serverId);
                    if (connection) {
                      const initializeData: InitializeHistoryData = {
                        capabilities: connection.capabilities || undefined,
                        serverInfo: connection.serverInfo || undefined,
                        instructions: connection.instructions || undefined,
                      };
                      multiServerHistoryStore.addInitializeEntry(
                        data.serverId,
                        data.serverName,
                        initializeData,
                      );
                    }
                  }

                  // Always add the notification to history
                  multiServerHistoryStore.addNotification(
                    data.serverId,
                    data.serverName,
                    data.notification,
                  );
                };
              }
              break;

            case "stderr_notification":
              // Prepare history store update for after setState
              if (data.notification) {
                historyUpdateFn = () => {
                  console.log(
                    `[useMultiServer] Processing stderr notification for server ${data.serverId}:`,
                    data.notification,
                  );
                  multiServerHistoryStore.addStdErrNotification(
                    data.serverId,
                    data.notification,
                  );
                };
              }
              break;
          }

          return newState;
        });

        // Execute history store updates after setState is complete
        if (historyUpdateFn) {
          setTimeout(historyUpdateFn, 0);
        }
      }, 0);
    };

    // Add listener to global event stream manager
    return globalEventStreamManager.addListener(handleEvent);
  }, []);

  // Add new server
  const addServer = useCallback(
    async (config: CreateServerRequest) => {
      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        const response = await MultiServerApi.createServer(config);

        setState((prev) => {
          const newServers = [...prev.servers, response.server];
          const newStatuses = new Map(prev.statuses).set(
            response.server.id,
            response.status,
          );

          // Persist state after successful addition
          persistMultiServerState(
            newServers,
            newStatuses,
            prev.selectedServerId,
          );

          return {
            ...prev,
            servers: newServers,
            statuses: newStatuses,
            isLoading: false,
          };
        });

        toast({
          title: "Success",
          description: `Server "${response.server.name}" created successfully`,
        });

        return response.server;
      } catch (error) {
        const errorMessage =
          error instanceof MultiServerApiError
            ? error.message
            : "Failed to create server";

        setState((prev) => ({ ...prev, isLoading: false }));

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });

        throw error;
      }
    },
    [toast],
  );

  // Update server configuration
  const updateServer = useCallback(
    async (serverId: string, config: UpdateServerRequest) => {
      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        const response = await MultiServerApi.updateServer(serverId, config);

        setState((prev) => {
          const newServers = prev.servers.map((s) =>
            s.id === serverId ? response.server : s,
          );
          const newStatuses = new Map(prev.statuses).set(
            serverId,
            response.status,
          );

          // Persist state after successful update
          persistMultiServerState(
            newServers,
            newStatuses,
            prev.selectedServerId,
          );

          return {
            ...prev,
            servers: newServers,
            statuses: newStatuses,
            isLoading: false,
          };
        });

        toast({
          title: "Success",
          description: `Server "${response.server.name}" updated successfully`,
        });

        return response.server;
      } catch (error) {
        console.error("Error updating server:", error);

        const errorMessage =
          error instanceof MultiServerApiError
            ? error.message
            : "Failed to update server";

        setState((prev) => ({ ...prev, isLoading: false }));

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });

        throw error;
      }
    },
    [toast],
  );

  // Delete server with immediate cache invalidation and enhanced cleanup
  const deleteServer = useCallback(
    async (serverId: string) => {
      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        // The server-side deleteServer already handles disconnection,
        // so we don't need to call disconnectServer separately
        await MultiServerApi.deleteServer(serverId);

        // CRITICAL FIX: Immediately invalidate cache to prevent server from reappearing
        invalidateServerCache(serverId);

        // Clean up client-side logging sync state
        clientLoggingSync.removeServer(serverId);

        let deletedServerName = "";

        setState((prev) => {
          const server = prev.servers.find((s) => s.id === serverId);
          if (server) {
            deletedServerName = server.name;
          }

          const newStatuses = new Map(prev.statuses);
          const newConnections = new Map(prev.connections);
          newStatuses.delete(serverId);
          newConnections.delete(serverId);

          const newServers = prev.servers.filter((s) => s.id !== serverId);
          const newSelectedServerId =
            prev.selectedServerId === serverId ? null : prev.selectedServerId;

          // Persist state after successful deletion
          persistMultiServerState(newServers, newStatuses, newSelectedServerId);

          return {
            ...prev,
            servers: newServers,
            statuses: newStatuses,
            connections: newConnections,
            selectedServerId: newSelectedServerId,
            isLoading: false,
          };
        });

        // Show success toast after state update
        if (deletedServerName) {
          toast({
            title: "Success",
            description: `Server "${deletedServerName}" deleted successfully`,
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof MultiServerApiError
            ? error.message
            : "Failed to delete server";

        setState((prev) => ({ ...prev, isLoading: false }));

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });

        throw error;
      }
    },
    [toast],
  );

  // Connect to server
  const connectToServer = useCallback(
    async (serverId: string) => {
      // Get server from current state to avoid dependency issues
      setState((prev) => {
        const server = prev.servers.find((s) => s.id === serverId);
        if (!server) return prev;

        // Update status to connecting
        const newStatuses = new Map(prev.statuses);
        newStatuses.set(serverId, {
          id: serverId,
          status: "connecting",
        });

        // Perform the actual connection in a separate async operation
        (async () => {
          try {
            const response = await MultiServerApi.connectServer(serverId);

            setState((currentState) => {
              const newStatuses = new Map(currentState.statuses);
              const newConnections = new Map(currentState.connections);

              newStatuses.set(serverId, response.status);
              if (response.connection) {
                const serverConnection: ServerConnection = {
                  id: serverId,
                  client: response.connection.client || null,
                  transport: response.connection.transport || null,
                  capabilities: response.connection.capabilities || null,
                  serverInfo: response.connection.serverInfo || null,
                  instructions: response.connection.instructions || null,
                  resources: response.connection.resources || [],
                  tools: response.connection.tools || [],
                  prompts: response.connection.prompts || [],
                  logLevel:
                    response.connection.logLevel ||
                    LoggingLevelSchema.enum.info,
                  loggingSupported: !!response.connection.capabilities?.logging,
                };
                newConnections.set(serverId, serverConnection);
              }

              return {
                ...currentState,
                statuses: newStatuses,
                connections: newConnections,
              };
            });

            // Always add initialize entry to history (like single-server mode)
            // This ensures the initialize entry appears for every successful connection
            const initializeData: InitializeHistoryData = {
              capabilities: response.connection?.capabilities || undefined,
              serverInfo: response.connection?.serverInfo || undefined,
              instructions: response.connection?.instructions || undefined,
            };

            multiServerHistoryStore.addInitializeEntry(
              serverId,
              server.name,
              initializeData,
            );

            toast({
              title: "Success",
              description: `Connected to "${server.name}"`,
            });
          } catch (error) {
            console.error("Connection error:", error);

            // Check if the connection actually succeeded despite the error
            // This handles cases where the backend returns 500 but the connection works
            try {
              // Wait a moment for the connection to potentially establish
              await new Promise((resolve) => setTimeout(resolve, 1000));

              // Try to get the connection status to see if it actually worked
              const connectionResponse =
                await MultiServerApi.getConnection(serverId);

              if (connectionResponse.connection) {
                // Connection actually succeeded despite the error
                setState((currentState) => {
                  const newStatuses = new Map(currentState.statuses);
                  const newConnections = new Map(currentState.connections);

                  newStatuses.set(serverId, connectionResponse.status);
                  if (connectionResponse.connection) {
                    const serverConnection: ServerConnection = {
                      id: serverId,
                      client: connectionResponse.connection.client || null,
                      transport:
                        connectionResponse.connection.transport || null,
                      capabilities:
                        connectionResponse.connection.capabilities || null,
                      serverInfo:
                        connectionResponse.connection.serverInfo || null,
                      instructions:
                        connectionResponse.connection.instructions || null,
                      resources: connectionResponse.connection.resources || [],
                      tools: connectionResponse.connection.tools || [],
                      prompts: connectionResponse.connection.prompts || [],
                      logLevel:
                        connectionResponse.connection.logLevel ||
                        LoggingLevelSchema.enum.info,
                      loggingSupported:
                        !!connectionResponse.connection.capabilities?.logging,
                    };
                    newConnections.set(serverId, serverConnection);
                  }

                  return {
                    ...currentState,
                    statuses: newStatuses,
                    connections: newConnections,
                  };
                });

                // Add initialize entry to history
                const initializeData: InitializeHistoryData = {
                  capabilities:
                    connectionResponse.connection?.capabilities || undefined,
                  serverInfo:
                    connectionResponse.connection?.serverInfo || undefined,
                  instructions:
                    connectionResponse.connection?.instructions || undefined,
                };

                multiServerHistoryStore.addInitializeEntry(
                  serverId,
                  server.name,
                  initializeData,
                );

                toast({
                  title: "Success",
                  description: `Connected to "${server.name}" (despite server error)`,
                });

                return; // Exit successfully
              }
            } catch (checkError) {
              // Connection check failed, so the original error was real
              console.error("Connection verification failed:", checkError);
            }

            // If we get here, the connection truly failed
            const errorMessage =
              error instanceof MultiServerApiError
                ? error.message
                : "Failed to connect to server";

            // Update status to error
            setState((currentState) => {
              const newStatuses = new Map(currentState.statuses);
              newStatuses.set(serverId, {
                id: serverId,
                status: "error",
                lastError: errorMessage,
              });
              return { ...currentState, statuses: newStatuses };
            });

            toast({
              title: "Connection Error",
              description: `Failed to connect to "${server.name}": ${errorMessage}`,
              variant: "destructive",
            });
          }
        })();

        return { ...prev, statuses: newStatuses };
      });
    },
    [toast],
  );

  // Disconnect from server with enhanced cleanup
  const disconnectFromServer = useCallback(
    async (serverId: string) => {
      setState((prev) => {
        const server = prev.servers.find((s) => s.id === serverId);
        if (!server) return prev;

        // Perform the actual disconnection in a separate async operation
        (async () => {
          try {
            await MultiServerApi.disconnectServer(serverId);

            setState((currentState) => {
              const newStatuses = new Map(currentState.statuses);
              const newConnections = new Map(currentState.connections);

              newStatuses.set(serverId, {
                id: serverId,
                status: "disconnected",
              });
              newConnections.delete(serverId);

              return {
                ...currentState,
                statuses: newStatuses,
                connections: newConnections,
              };
            });

            // Clean up client-side logging sync state
            clientLoggingSync.removeServer(serverId);

            toast({
              title: "Success",
              description: `Disconnected from "${server.name}"`,
            });
          } catch (error) {
            const errorMessage =
              error instanceof MultiServerApiError
                ? error.message
                : "Failed to disconnect from server";

            toast({
              title: "Error",
              description: `Failed to disconnect from "${server.name}": ${errorMessage}`,
              variant: "destructive",
            });
          }
        })();

        return prev;
      });
    },
    [toast],
  );

  // Select server
  const selectServer = useCallback((serverId: string | null) => {
    setState((prev) => ({ ...prev, selectedServerId: serverId }));
  }, []);

  // Toggle mode between single and multi-server
  const toggleMode = useCallback(() => {
    setState((prev) => {
      const newMode = prev.mode === "single" ? "multi" : "single";

      // Persist current multi-server state before switching modes
      if (prev.mode === "multi" && prev.servers.length > 0) {
        persistMultiServerState(
          prev.servers,
          prev.statuses,
          prev.selectedServerId,
        );
      }

      // Persist mode to localStorage
      localStorage.setItem("mcp-inspector-mode", newMode);

      // Reset flags when switching modes
      if (newMode === "multi") {
        setHasInitialized(false);
      }

      // Event stream cleanup and initialization will be handled by useEffect

      return { ...prev, mode: newMode };
    });
  }, []); // Remove all dependencies to prevent infinite loops

  // Get server by ID
  const getServer = useCallback(
    (serverId: string): ServerConfig | undefined => {
      return state.servers.find((s) => s.id === serverId);
    },
    [state.servers],
  );

  // Get server status
  const getServerStatus = useCallback(
    (serverId: string): ServerStatus => {
      return (
        state.statuses.get(serverId) || {
          id: serverId,
          status: "disconnected",
        }
      );
    },
    [state.statuses],
  );

  // Get server connection
  const getServerConnection = useCallback(
    (serverId: string): ServerConnection | undefined => {
      // Use the ref to get the most current connections
      const connection = connectionsRef.current.get(serverId);
      return connection;
    },
    [],
  ); // No dependencies needed since we use ref

  // Set server log level with enhanced synchronization and race condition prevention
  const setServerLogLevel = useCallback(
    async (serverId: string, level: LoggingLevel) => {
      try {
        // Register completion callback for debugging purposes only
        // The actual UI updates are handled by connection_change events
        clientLoggingSync.onSyncComplete(serverId, () => {
          // Completion callback for UI updates via connection_change events
        });

        // Use the enhanced client logging sync for reliable level changes
        const success = await clientLoggingSync.performLogLevelChange(
          serverId,
          level,
          async (id: string, logLevel: LoggingLevel) => {
            try {
              // Track expected level in event stream manager for fallback correction
              globalEventStreamManager.trackServerLoggingLevel(id, logLevel);

              // Update local state with optimistic update
              setState((prev) => {
                const newConnections = new Map(prev.connections);
                const connection = newConnections.get(id);
                if (connection) {
                  newConnections.set(id, {
                    ...connection,
                    logLevel: logLevel,
                  });
                }
                return { ...prev, connections: newConnections };
              });

              // Make the API call
              await MultiServerApi.setServerLogLevel(id, logLevel);

              return true;
            } catch (error) {
              console.error(
                `[useMultiServer] Failed to set log level for server: ${id}`,
                error,
              );

              // Revert optimistic update on error
              setState((prev) => {
                const newConnections = new Map(prev.connections);
                const connection = newConnections.get(id);
                if (connection) {
                  // Get the actual level from client sync or fallback to 'info'
                  const actualLevel =
                    clientLoggingSync.getActualLevel(id) ||
                    LoggingLevelSchema.enum.info;
                  newConnections.set(id, {
                    ...connection,
                    logLevel: actualLevel,
                  });
                }
                return { ...prev, connections: newConnections };
              });

              return false;
            }
          },
        );

        if (!success) {
          throw new Error(
            `Failed to synchronize logging level for server ${serverId}`,
          );
        }

        // The completion callback will handle updating the UI state with the actual server level
        // This ensures the dropdown shows the correct current level
      } catch (error) {
        console.error(
          `[useMultiServer] Failed to set log level for server: ${serverId}`,
          error,
        );
        throw error;
      }
    },
    [],
  ); // No dependencies needed since both managers are stable singletons

  // Listen for localStorage mode changes from external sources (like App component)
  useEffect(() => {
    const handleStorageChange = (e?: StorageEvent) => {
      // Only handle mode changes, not other localStorage changes
      if (e && e.key !== "mcp-inspector-mode") return;

      const currentMode = localStorage.getItem("mcp-inspector-mode");
      const normalizedMode: "single" | "multi" =
        currentMode === "single-server"
          ? "single"
          : currentMode === "multi-server"
            ? "multi"
            : currentMode === "single"
              ? "single"
              : currentMode === "multi"
                ? "multi"
                : "single";

      if (normalizedMode !== state.mode) {
        setState((prev) => ({ ...prev, mode: normalizedMode }));
      }
    };

    // Listen for storage events (changes from other tabs/windows)
    window.addEventListener("storage", handleStorageChange);

    // Check once on mount for initial sync
    handleStorageChange();

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [state.mode]);

  // Initialize when switching to multi-server mode
  useEffect(() => {
    if (
      state.mode === "multi" &&
      !state.isLoading &&
      state.servers.length === 0 &&
      !hasInitialized
    ) {
      setHasInitialized(true);
      initializeWithRetry().catch((error) => {
        console.error("Initialization failed:", error);
        setState((prev) => ({
          ...prev,
          error: "Failed to initialize multi-server mode",
          isLoading: false,
        }));
      });
    }
  }, [state.mode, state.isLoading, hasInitialized, state.servers.length]); // Remove initializeWithRetry from deps

  // Keep connectionsRef in sync with state.connections
  useEffect(() => {
    connectionsRef.current = state.connections;
  }, [state.connections]);

  // Set up event stream listener when in multi-server mode (regardless of server count)
  useEffect(() => {
    let removeListener: (() => void) | null = null;

    if (state.mode === "multi") {
      // Set up event stream listener immediately when in multi-server mode
      // This ensures stderr notifications are captured even for the first server connection
      removeListener = setupEventStreamListener();
    }

    // Cleanup function
    return () => {
      if (removeListener) {
        console.log("[useMultiServer] Cleaning up event stream listener");
        removeListener();
      }
    };
  }, [state.mode, setupEventStreamListener]);

  return {
    // State
    ...state,

    // Actions
    addServer,
    updateServer,
    deleteServer,
    connectToServer,
    disconnectFromServer,
    selectServer,
    toggleMode,
    setServerLogLevel,

    // Getters
    getServer,
    getServerStatus,
    getServerConnection,

    // Utilities
    initialize,
  };
}
