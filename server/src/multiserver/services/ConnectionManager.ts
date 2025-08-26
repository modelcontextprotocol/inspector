// Connection lifecycle management
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { MultiServerConfig, ServerStatus } from "../models/types.js";
import { TransportFactory } from "../utils/transportFactory.js";
import { generateSessionId } from "../utils/idGenerator.js";
import { loggingLevelManager } from "../utils/loggingLevelManager.js";
import { connectionReliabilityMiddleware } from "../middleware/connectionReliability.js";
import { z } from "zod";
import {
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  CancelledNotificationSchema,
  ServerNotification,
  NotificationSchema as BaseNotificationSchema,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { eventStreamService } from "./EventStreamService.js";

// Define stderr notification schema
const StdErrNotificationSchema = BaseNotificationSchema.extend({
  method: z.literal("notifications/stderr"),
  params: z.object({
    content: z.string(),
  }),
});

// Zod schemas for MCP protocol responses
const InitializeResultSchema = z.object({
  capabilities: z.any(),
  protocolVersion: z.string().optional(),
  serverInfo: z.any().optional(),
  instructions: z.string().optional(),
});

const ListResourcesResultSchema = z.object({
  resources: z.array(z.any()).optional(),
});

const ListToolsResultSchema = z.object({
  tools: z.array(z.any()).optional(),
});

const ListPromptsResultSchema = z.object({
  prompts: z.array(z.any()).optional(),
});

// Server connection interface matching client expectations
interface ServerConnection {
  id: string;
  client: Client | null;
  transport: Transport | null;
  capabilities: any | null;
  serverInfo: any | null;
  instructions: string | null;
  resources: any[];
  tools: any[];
  prompts: any[];
  logLevel?: string;
  loggingSupported?: boolean;
  pendingLogLevel?: string; // Used to fix notification log levels after setLevel requests
}

/**
 * Manages connections to multiple MCP servers
 */
export class ConnectionManager {
  private connections: Map<string, ServerConnection> = new Map();
  private statuses: Map<string, ServerStatus> = new Map();
  private transportFactory: TransportFactory;
  private notificationHandler?: (
    serverId: string,
    notification: ServerNotification,
  ) => void;

  constructor(transportFactory: TransportFactory) {
    this.transportFactory = transportFactory;
  }

  /**
   * Sets the notification handler for all server connections
   */
  setNotificationHandler(
    handler: (serverId: string, notification: ServerNotification) => void,
  ) {
    this.notificationHandler = handler;
  }

  /**
   * Establishes connection to a specific server with enhanced reliability
   */
  async connectToServer(config: MultiServerConfig): Promise<ServerStatus> {
    const serverId = config.id;

    // Use connection reliability middleware to ensure error visibility
    return await connectionReliabilityMiddleware.ensureErrorVisibility(
      serverId,
      async () => {
        try {
          // Update status to connecting
          this.updateServerStatus(serverId, {
            id: serverId,
            status: "connecting",
            sessionId: generateSessionId(),
          });

          // Create transport for the server
          const transport =
            await this.transportFactory.createTransportForServer(config);

          // Create client and connect
          const client = new Client(
            {
              name: "mcp-inspector",
              version: "1.0.0",
            },
            {
              capabilities: {
                resources: {},
                tools: {},
                prompts: {},
              },
            },
          );

          // Set up notification handlers before connecting
          if (this.notificationHandler) {
            const notificationHandler = this.notificationHandler;

            // Set up specific notification handlers (but not logging messages to avoid duplicates)
            [
              ResourceUpdatedNotificationSchema,
              ResourceListChangedNotificationSchema,
              ToolListChangedNotificationSchema,
              PromptListChangedNotificationSchema,
              CancelledNotificationSchema,
            ].forEach((notificationSchema) => {
              client.setNotificationHandler(
                notificationSchema,
                (notification: ServerNotification) => {
                  notificationHandler(serverId, notification);
                },
              );
            });

            // Set up stderr notification handler separately
            client.setNotificationHandler(
              StdErrNotificationSchema,
              (notification: any) => {
                notificationHandler(
                  serverId,
                  notification as ServerNotification,
                );
              },
            );

            // Set up fallback notification handler for any other notifications (including logging)
            // This will handle logging/message notifications without duplication
            client.fallbackNotificationHandler = (
              notification: any,
            ): Promise<void> => {
              // Only handle notifications that don't have specific handlers
              const method = notification.method;
              const hasSpecificHandler = [
                "notifications/resources/updated",
                "notifications/resources/list_changed",
                "notifications/tools/list_changed",
                "notifications/prompts/list_changed",
                "notifications/cancelled",
                "notifications/stderr",
              ].includes(method);

              if (!hasSpecificHandler) {
                notificationHandler(
                  serverId,
                  notification as ServerNotification,
                );
              }
              return Promise.resolve();
            };
          }

          await client.connect(transport);

          // Set up stderr handling for STDIO transports (similar to single-server implementation)
          if (
            transport.constructor.name === "StdioClientTransport" &&
            this.notificationHandler
          ) {
            const stdioTransport = transport as any; // Cast to access stderr property
            if (stdioTransport.stderr) {
              stdioTransport.stderr.on("data", (chunk: Buffer) => {
                const content = chunk.toString();

                // Create stderr notification in MCP format
                const stderrNotification = {
                  jsonrpc: "2.0" as const,
                  method: "notifications/stderr" as const,
                  params: {
                    content: content,
                  },
                };

                // Send through notification handler (cast to unknown first to avoid type issues)
                this.notificationHandler!(
                  serverId,
                  stderrNotification as unknown as ServerNotification,
                );
              });
            }
          }

          // Initialize server capabilities
          let capabilities = null;
          let serverInfo = null;
          let instructions = null;
          let resources: any[] = [];
          let tools: any[] = [];
          let prompts: any[] = [];

          try {
            // Use different initialization approaches based on transport type
            if (config.transportType === "streamable-http") {
              // For streamable HTTP: Use direct client methods to avoid "Server already initialized" errors
              capabilities = await client.getServerCapabilities();
              serverInfo = await client.getServerVersion();
              instructions = (await client.getInstructions()) || null;
            } else {
              // For stdio and other transports: Keep existing manual request approach
              const initResult = await client.request(
                {
                  method: "initialize",
                  params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {
                      resources: {},
                      tools: {},
                      prompts: {},
                      logging: {},
                    },
                    clientInfo: {
                      name: "mcp-inspector",
                      version: "1.0.0",
                    },
                  },
                },
                InitializeResultSchema,
              );
              capabilities = initResult.capabilities;
              serverInfo = initResult.serverInfo || null;
              instructions = initResult.instructions || null;
            }

            // Get resources if supported
            if (capabilities?.resources) {
              try {
                const resourcesResult = await client.request(
                  { method: "resources/list" },
                  ListResourcesResultSchema,
                );
                resources = resourcesResult.resources || [];
              } catch (error) {
                console.warn(
                  `Failed to list resources for server ${serverId}:`,
                  error,
                );
              }
            }

            // Get tools if supported
            if (capabilities?.tools) {
              try {
                const toolsResult = await client.request(
                  { method: "tools/list" },
                  ListToolsResultSchema,
                );
                tools = toolsResult.tools || [];
              } catch (error) {
                console.warn(
                  `Failed to list tools for server ${serverId}:`,
                  error,
                );
              }
            }

            // Get prompts if supported
            if (capabilities?.prompts) {
              try {
                const promptsResult = await client.request(
                  { method: "prompts/list" },
                  ListPromptsResultSchema,
                );
                prompts = promptsResult.prompts || [];
              } catch (error) {
                console.warn(
                  `Failed to list prompts for server ${serverId}:`,
                  error,
                );
              }
            }
          } catch (error) {
            console.warn(`Failed to initialize server ${serverId}:`, error);
          }

          // Create server connection object
          const serverConnection: ServerConnection = {
            id: serverId,
            client,
            transport,
            capabilities,
            serverInfo,
            instructions,
            resources,
            tools,
            prompts,
            logLevel: undefined, // Will be set when user changes it
            loggingSupported: capabilities?.logging ? true : false,
          };

          // Store the connection
          this.connections.set(serverId, serverConnection);

          // Update status to connected with proper session tracking
          const status: ServerStatus = {
            id: serverId,
            status: "connected",
            lastConnected: new Date(),
            sessionId:
              this.statuses.get(serverId)?.sessionId || generateSessionId(),
          };

          this.updateServerStatus(serverId, status);

          // Ensure connection is properly tracked for all transport types
          console.log(
            `Successfully connected to server ${serverId} (${config.transportType}):`,
            {
              hasClient: !!serverConnection.client,
              hasTransport: !!serverConnection.transport,
              hasCapabilities: !!serverConnection.capabilities,
              transportType: config.transportType,
              status: status.status,
            },
          );

          // Set default logging level to trigger server notification (like single-server mode)
          if (capabilities?.logging) {
            try {
              const defaultLogLevel = "info"; // Default logging level
              await client.setLoggingLevel(defaultLogLevel);
              // Update connection with the logging level
              serverConnection.logLevel = defaultLogLevel;

              // Send initialization notification through event stream (like single-server mode)
              if (this.notificationHandler) {
                const initNotification = {
                  method: "notifications/message" as const,
                  params: {
                    level: defaultLogLevel,
                    logger: config.name,
                    data: `Logging level set to: ${defaultLogLevel}`,
                  },
                };

                // Send through notification handler to trigger event stream
                this.notificationHandler(serverId, initNotification as any);
              }
            } catch (error) {
              console.warn(
                `Failed to set default logging level for server ${serverId}:`,
                error,
              );
            }
          }

          // Validate the connection before returning success
          if (!(await this.validateConnection(serverId))) {
            throw new Error("Connection validation failed after establishment");
          }

          return status;
        } catch (error) {
          // Handle connection error
          this.handleConnectionError(serverId, error as Error);
          throw error;
        }
      },
    );
  }

  /**
   * Validates that a connection is properly established with enhanced health checking
   */
  private async validateConnection(serverId: string): Promise<boolean> {
    const connection = this.connections.get(serverId);
    const status = this.statuses.get(serverId);

    if (!connection || !status) {
      return false;
    }

    // Check if we have the essential components for a valid connection
    const hasValidClient = connection.client !== null;
    const hasValidTransport = connection.transport !== null;

    // For a connection to be truly "connected", we need at least client and transport
    // Capabilities may be null if initialization failed, but the connection itself can still be valid
    const isValidConnection = hasValidClient && hasValidTransport;

    if (!isValidConnection && status.status === "connected") {
      console.warn(`Connection validation failed for server ${serverId}:`, {
        hasValidClient,
        hasValidTransport,
        hasCapabilities: connection.capabilities !== null,
        currentStatus: status.status,
      });

      // Update status to error if connection is invalid
      this.updateServerStatus(serverId, {
        id: serverId,
        status: "error",
        lastError: "Connection validation failed - missing client or transport",
        sessionId: undefined,
      });

      return false;
    }

    // Use connection reliability middleware for enhanced health validation
    if (isValidConnection && connection.client) {
      const isHealthy =
        await connectionReliabilityMiddleware.validateConnectionHealth(
          serverId,
          async () => {
            try {
              // Simple health check - try to get server capabilities
              const capabilities =
                await connection.client!.getServerCapabilities();
              return capabilities !== null;
            } catch (error) {
              return false;
            }
          },
        );

      if (!isHealthy) {
        console.warn(`Connection health check failed for server ${serverId}`);
        return false;
      }
    }

    return isValidConnection;
  }

  /**
   * Disconnects from a specific server with enhanced cleanup
   */
  async disconnectFromServer(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);

    if (connection) {
      try {
        // Close the client connection first
        if (connection.client) {
          await connection.client.close();
        }
        // Close the transport connection
        if (connection.transport) {
          await connection.transport.close();
        }
      } catch (error) {
        console.error(
          `Error closing connection for server ${serverId}:`,
          error,
        );
      }

      // Remove from connections
      this.connections.delete(serverId);
    }

    // Clean up logging level manager state for this server
    loggingLevelManager.removeServer(serverId);

    // Clean up connection reliability middleware state
    connectionReliabilityMiddleware.resetConnectionState(serverId);

    // Update status to disconnected
    this.updateServerStatus(serverId, {
      id: serverId,
      status: "disconnected",
      sessionId: undefined,
    });
  }

  /**
   * Gets the connection status of a specific server
   */
  getServerStatus(serverId: string): ServerStatus {
    return (
      this.statuses.get(serverId) || {
        id: serverId,
        status: "disconnected",
      }
    );
  }

  /**
   * Gets status of all servers
   */
  getAllServerStatuses(): ServerStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * Checks if a server is currently connected with enhanced validation
   */
  async isServerConnected(serverId: string): Promise<boolean> {
    const status = this.statuses.get(serverId);
    if (status?.status !== "connected") {
      return false;
    }

    // Validate the connection to ensure it's actually working
    return await this.validateConnection(serverId);
  }

  /**
   * Gets all active server connections
   */
  getActiveConnections(): Map<string, ServerConnection> {
    return new Map(this.connections);
  }

  /**
   * Gets a specific server connection
   */
  getConnection(serverId: string): ServerConnection | undefined {
    return this.connections.get(serverId);
  }

  /**
   * Gets all active transport connections (for backward compatibility)
   */
  getActiveTransports(): Map<string, Transport> {
    const transports = new Map<string, Transport>();
    for (const [serverId, connection] of this.connections) {
      if (connection.transport) {
        transports.set(serverId, connection.transport);
      }
    }
    return transports;
  }

  /**
   * Gets a specific transport (for backward compatibility)
   */
  getTransport(serverId: string): Transport | undefined {
    const connection = this.connections.get(serverId);
    return connection?.transport || undefined;
  }

  /**
   * Updates server status
   */
  private updateServerStatus(
    serverId: string,
    status: Partial<ServerStatus>,
  ): void {
    const currentStatus = this.statuses.get(serverId) || {
      id: serverId,
      status: "disconnected" as const,
    };

    const updatedStatus: ServerStatus = {
      ...currentStatus,
      ...status,
      id: serverId, // Ensure ID is always set
    };

    this.statuses.set(serverId, updatedStatus);
  }

  /**
   * Handles connection errors
   */
  private handleConnectionError(serverId: string, error: Error): void {
    console.error(`Connection error for server ${serverId}:`, error);

    // Remove failed connection
    this.connections.delete(serverId);

    // Update status to error
    this.updateServerStatus(serverId, {
      id: serverId,
      status: "error",
      lastError: error.message,
      sessionId: undefined,
    });
  }

  /**
   * Disconnects all servers and cleans up resources
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map(
      (serverId) => this.disconnectFromServer(serverId),
    );

    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Gets the number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Gets the number of servers with status tracking
   */
  getStatusCount(): number {
    return this.statuses.size;
  }

  /**
   * Updates the logging level for a server with enhanced synchronization
   */
  async updateServerLogLevel(
    serverId: string,
    level: LoggingLevel,
  ): Promise<boolean> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.client) {
      return false;
    }

    try {
      // First, update the connection state immediately to ensure it's available for serialization
      connection.logLevel = level;
      connection.pendingLogLevel = level;

      // Track in logging level manager
      loggingLevelManager.setServerLogLevel(serverId, level);

      // Use connection reliability middleware for reliable sync
      const success =
        await connectionReliabilityMiddleware.syncLoggingLevelReliably(
          serverId,
          level,
          async (id: string, logLevel: LoggingLevel) => {
            try {
              await connection.client!.setLoggingLevel(logLevel);
              return true;
            } catch (error) {
              console.error(
                `Failed to set logging level for server ${id}:`,
                error,
              );
              // Revert connection state on failure
              connection.logLevel =
                connection.logLevel === level ? undefined : connection.logLevel;
              connection.pendingLogLevel = undefined;
              return false;
            }
          },
        );

      // If the sync failed, revert the connection state
      if (!success) {
        connection.logLevel =
          connection.logLevel === level ? undefined : connection.logLevel;
        connection.pendingLogLevel = undefined;
        loggingLevelManager.removeServer(serverId);
      }

      return success;
    } catch (error) {
      console.error(
        `Failed to update logging level for server ${serverId}:`,
        error,
      );
      // Revert connection state on error
      connection.logLevel =
        connection.logLevel === level ? undefined : connection.logLevel;
      connection.pendingLogLevel = undefined;
      return false;
    }
  }

  /**
   * Gets the current logging level for a server
   */
  getServerLogLevel(serverId: string): LoggingLevel | undefined {
    const connection = this.connections.get(serverId);
    if (connection?.logLevel) {
      return connection.logLevel as LoggingLevel;
    }

    // Fallback to logging level manager
    return loggingLevelManager.getExpectedLevel(serverId);
  }

  /**
   * Corrects the logging level of a notification if needed
   */
  correctNotificationLevel(
    serverId: string,
    notification: ServerNotification,
  ): ServerNotification {
    // Only correct logging/message notifications
    if (
      notification.method !== "notifications/message" ||
      !notification.params
    ) {
      return notification;
    }

    const params = notification.params as any;
    if (!params.level) {
      return notification;
    }

    const currentLevel = params.level as LoggingLevel;

    // Check if we should correct this notification level
    if (
      loggingLevelManager.shouldCorrectNotificationLevel(serverId, currentLevel)
    ) {
      const correctionLevel = loggingLevelManager.getCorrectionLevel(serverId);

      if (correctionLevel) {
        // Create corrected notification
        const correctedNotification = {
          ...notification,
          params: {
            ...params,
            level: correctionLevel,
          },
          _meta: {
            originalLevel: currentLevel,
            correctedLevel: correctionLevel,
            serverId: serverId,
          },
        };

        // Consume the pending level to handle multiple notifications
        loggingLevelManager.consumePendingLevel(serverId);

        return correctedNotification as ServerNotification;
      }
    }

    return notification;
  }

  /**
   * Checks if a server supports logging
   */
  isLoggingSupported(serverId: string): boolean {
    const connection = this.connections.get(serverId);
    return connection?.loggingSupported || false;
  }

  /**
   * Gets debug information about logging levels and connection reliability for all servers
   */
  getLoggingDebugInfo(): {
    connections: Record<
      string,
      {
        logLevel?: string;
        loggingSupported?: boolean;
        pendingLogLevel?: string;
      }
    >;
    loggingLevelManager: ReturnType<typeof loggingLevelManager.getDebugInfo>;
    connectionReliability: ReturnType<
      typeof connectionReliabilityMiddleware.getDebugInfo
    >;
  } {
    const connections: Record<
      string,
      {
        logLevel?: string;
        loggingSupported?: boolean;
        pendingLogLevel?: string;
      }
    > = {};

    for (const [serverId, connection] of this.connections) {
      connections[serverId] = {
        logLevel: connection.logLevel,
        loggingSupported: connection.loggingSupported,
        pendingLogLevel: connection.pendingLogLevel,
      };
    }

    return {
      connections,
      loggingLevelManager: loggingLevelManager.getDebugInfo(),
      connectionReliability: connectionReliabilityMiddleware.getDebugInfo(),
    };
  }
}
