// Connection management endpoints
import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { validateServerId } from "../middleware/validation.js";
import {
  asyncHandler,
  sendSuccess,
  sendError,
} from "../middleware/errorHandler.js";
import { optionalAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { serverManager, connectionManager } from "./servers.js";
import { eventStreamService } from "../services/EventStreamService.js";
import type { ServerStatus, ConnectionResponse } from "../models/types.js";

/**
 * Connect to a specific server
 * POST /api/servers/:id/connect
 */
const connectServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
      // Check if server exists
      const server = await serverManager.getServer(id);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${id} not found`,
        );
      }

      // Check if already connected
      if (await connectionManager.isServerConnected(id)) {
        const status = connectionManager.getServerStatus(id);
        return sendSuccess(res, {
          status,
          message: "Server is already connected",
        });
      }

      // Attempt to connect
      const status = await connectionManager.connectToServer(server);
      sendSuccess(res, { status, message: "Successfully connected to server" });
    } catch (error) {
      throw new Error(
        `Failed to connect to server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Disconnect from a specific server
 * DELETE /api/connections/:serverId
 */
const disconnectServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;
    const id = serverId; // For backward compatibility with existing logic

    try {
      // Check if server exists
      const server = await serverManager.getServer(id);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${id} not found`,
        );
      }

      // Check if connected
      if (!(await connectionManager.isServerConnected(id))) {
        const status = connectionManager.getServerStatus(id);
        return sendSuccess(res, {
          status,
          message: "Server is already disconnected",
        });
      }

      // Disconnect
      await connectionManager.disconnectFromServer(id);
      const status = connectionManager.getServerStatus(id);

      sendSuccess(res, {
        status,
        message: "Successfully disconnected from server",
      });
    } catch (error) {
      throw new Error(
        `Failed to disconnect from server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get connection status for a specific server
 * GET /api/servers/:id/status
 */
const getServerStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
      // Check if server exists
      const server = await serverManager.getServer(id);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${id} not found`,
        );
      }

      const status = connectionManager.getServerStatus(id);
      sendSuccess(res, { status });
    } catch (error) {
      throw new Error(
        `Failed to get server status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get connection status for all servers
 * GET /api/connections/status
 */
const getAllConnectionStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const statuses = connectionManager.getAllServerStatuses();
      const activeConnections = connectionManager.getActiveConnections();

      const response = {
        statuses,
        summary: {
          totalServers: statuses.length,
          activeConnections: activeConnections.size,
          statusCounts: {
            connected: statuses.filter((s) => s.status === "connected").length,
            connecting: statuses.filter((s) => s.status === "connecting")
              .length,
            disconnected: statuses.filter((s) => s.status === "disconnected")
              .length,
            error: statuses.filter((s) => s.status === "error").length,
          },
        },
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to get connection statuses: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Connect to all configured servers
 * POST /api/connections/connect-all
 */
const connectAllServersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const servers = await serverManager.getAllServers();
      const results: Array<{
        serverId: string;
        success: boolean;
        status?: ServerStatus;
        error?: string;
      }> = [];

      // Attempt to connect to each server
      for (const server of servers) {
        try {
          if (!(await connectionManager.isServerConnected(server.id))) {
            const status = await connectionManager.connectToServer(server);
            results.push({ serverId: server.id, success: true, status });
          } else {
            const status = connectionManager.getServerStatus(server.id);
            results.push({ serverId: server.id, success: true, status });
          }
        } catch (error) {
          results.push({
            serverId: server.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const response = {
        results,
        summary: {
          total: servers.length,
          successful: successCount,
          failed: servers.length - successCount,
        },
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to connect to all servers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Disconnect from all servers
 * DELETE /api/connections/disconnect-all
 */
const disconnectAllServersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await connectionManager.disconnectAll();
      const statuses = connectionManager.getAllServerStatuses();

      const response = {
        message: "Disconnected from all servers",
        statuses,
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to disconnect from all servers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Connect to a server by ID
 * POST /api/connections
 */
const connectServerByIdHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.body;

    if (!serverId) {
      return sendError(
        res,
        400,
        "Bad Request",
        "serverId is required in request body",
      );
    }

    try {
      // Check if server exists
      const server = await serverManager.getServer(serverId);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${serverId} not found`,
        );
      }

      // Check if already connected
      if (await connectionManager.isServerConnected(serverId)) {
        const status = connectionManager.getServerStatus(serverId);
        const connection = connectionManager.getConnection(serverId);

        // Create a serializable connection object that includes serverInfo and instructions
        const serializableConnection = connection
          ? {
              id: connection.id,
              client: null, // Not serializable, set to null
              transport: null, // Not serializable, set to null
              capabilities: connection.capabilities,
              serverInfo: connection.serverInfo,
              instructions: connection.instructions,
              resources: connection.resources,
              tools: connection.tools,
              prompts: connection.prompts,
              logLevel: connection.logLevel,
              loggingSupported: connection.loggingSupported,
            }
          : undefined;

        const response: ConnectionResponse = {
          serverId,
          status,
          connection: serializableConnection,
        };

        return sendSuccess(res, response);
      }

      // Attempt to connect
      const status = await connectionManager.connectToServer(server);
      const connection = connectionManager.getConnection(serverId);

      // Create a serializable connection object that includes serverInfo and instructions
      const serializableConnection = connection
        ? {
            id: connection.id,
            client: null, // Not serializable, set to null
            transport: null, // Not serializable, set to null
            capabilities: connection.capabilities,
            serverInfo: connection.serverInfo,
            instructions: connection.instructions,
            resources: connection.resources,
            tools: connection.tools,
            prompts: connection.prompts,
            logLevel: connection.logLevel,
            loggingSupported: connection.loggingSupported,
          }
        : undefined;

      const response: ConnectionResponse = {
        serverId,
        status,
        connection: serializableConnection,
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to connect to server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get connection details for a specific server
 * GET /api/connections/:serverId
 */
const getConnectionHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;

    try {
      // Check if server exists
      const server = await serverManager.getServer(serverId);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${serverId} not found`,
        );
      }

      // Check if connected
      if (!(await connectionManager.isServerConnected(serverId))) {
        return sendError(
          res,
          404,
          "Not Found",
          `No active connection for server ${serverId}`,
        );
      }

      const status = connectionManager.getServerStatus(serverId);
      const connection = connectionManager.getConnection(serverId);

      // Create a serializable connection object that includes serverInfo and instructions
      const serializableConnection = connection
        ? {
            id: connection.id,
            client: null, // Not serializable, set to null
            transport: null, // Not serializable, set to null
            capabilities: connection.capabilities,
            serverInfo: connection.serverInfo,
            instructions: connection.instructions,
            resources: connection.resources,
            tools: connection.tools,
            prompts: connection.prompts,
            logLevel: connection.logLevel,
            loggingSupported: connection.loggingSupported,
          }
        : undefined;

      sendSuccess(res, { status, connection: serializableConnection });
    } catch (error) {
      throw new Error(
        `Failed to get connection: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get all active connections
 * GET /api/connections
 */
const getAllConnectionsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeConnections = connectionManager.getActiveConnections();
      const connections = Array.from(activeConnections.entries()).map(
        ([serverId, connection]) => {
          const status = connectionManager.getServerStatus(serverId);

          // Create a serializable connection object that includes serverInfo and instructions
          const serializableConnection = connection
            ? {
                id: connection.id,
                client: null, // Not serializable, set to null
                transport: null, // Not serializable, set to null
                capabilities: connection.capabilities,
                serverInfo: connection.serverInfo,
                instructions: connection.instructions,
                resources: connection.resources,
                tools: connection.tools,
                prompts: connection.prompts,
                logLevel: connection.logLevel,
                loggingSupported: connection.loggingSupported,
              }
            : undefined;

          return { status, connection: serializableConnection };
        },
      );

      sendSuccess(res, connections);
    } catch (error) {
      throw new Error(
        `Failed to get connections: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Set logging level for a specific server connection
 * POST /api/connections/:serverId/logging
 */
const setServerLogLevelHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { serverId } = req.params;
    const { level } = req.body;

    if (!level) {
      return sendError(
        res,
        400,
        "Bad Request",
        "level is required in request body",
      );
    }

    try {
      // Check if server exists
      const server = await serverManager.getServer(serverId);
      if (!server) {
        return sendError(
          res,
          404,
          "Not Found",
          `Server with ID ${serverId} not found`,
        );
      }

      // Check if connected
      if (!(await connectionManager.isServerConnected(serverId))) {
        return sendError(
          res,
          404,
          "Not Found",
          `No active connection for server ${serverId}`,
        );
      }

      // Get the connection and set the logging level
      const connection = connectionManager.getConnection(serverId);
      if (!connection || !connection.client) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `Connection client not available for server ${serverId}`,
        );
      }

      // Check if the server supports logging using enhanced method
      if (!connectionManager.isLoggingSupported(serverId)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${serverId} does not support logging`,
        );
      }

      // Send the logging/setLevel request to the MCP server
      await connection.client.request(
        {
          method: "logging/setLevel",
          params: { level },
        },
        z.object({}),
      );

      // Update the server logging level using enhanced ConnectionManager method
      const updateSuccess = await connectionManager.updateServerLogLevel(
        serverId,
        level,
      );

      if (!updateSuccess) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `Failed to update logging level for server ${serverId}`,
        );
      }

      // Get the updated connection to ensure we have the latest state
      const updatedConnection = connectionManager.getConnection(serverId);
      if (!updatedConnection) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `Connection lost for server ${serverId} after logging level update`,
        );
      }

      // Broadcast the connection change to all connected clients with updated state
      const serializableConnection = {
        id: updatedConnection.id,
        client: null, // Not serializable, set to null
        transport: null, // Not serializable, set to null
        capabilities: updatedConnection.capabilities,
        serverInfo: updatedConnection.serverInfo,
        instructions: updatedConnection.instructions,
        resources: updatedConnection.resources,
        tools: updatedConnection.tools,
        prompts: updatedConnection.prompts,
        logLevel: updatedConnection.logLevel,
        loggingSupported: updatedConnection.loggingSupported,
      };

      eventStreamService.sendConnectionChange(
        serverId,
        server.name,
        serializableConnection,
      );

      sendSuccess(res, {
        message: `Successfully set log level to ${level} for server ${serverId}`,
        level,
        debug:
          process.env.NODE_ENV === "development"
            ? connectionManager.getLoggingDebugInfo()
            : undefined,
      });
    } catch (error) {
      throw new Error(
        `Failed to set log level for server ${serverId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

// Create router and define routes
export const connectionsRouter = Router();

// Note: Authentication middleware is applied at the app level in index.ts
// No need to apply optionalAuth here as it conflicts with authMiddleware

// Define routes - specific routes MUST come before generic /:serverId routes
connectionsRouter.post("/", connectServerByIdHandler);
connectionsRouter.get("/", getAllConnectionsHandler);
connectionsRouter.post("/connect-all", connectAllServersHandler);
connectionsRouter.delete("/disconnect-all", disconnectAllServersHandler);
connectionsRouter.get("/status", getAllConnectionStatusHandler);

// Specific parameterized routes must come before generic /:serverId routes
connectionsRouter.post("/:serverId/logging", setServerLogLevelHandler);

// Generic /:serverId routes come LAST
connectionsRouter.get("/:serverId", getConnectionHandler);
connectionsRouter.delete("/:serverId", disconnectServerHandler);

// Export individual handlers for testing
export {
  connectServerHandler,
  disconnectServerHandler,
  getServerStatusHandler,
  getAllConnectionStatusHandler,
  connectAllServersHandler,
  disconnectAllServersHandler,
  connectServerByIdHandler,
  getConnectionHandler,
  getAllConnectionsHandler,
  setServerLogLevelHandler,
};
