// RESTful API endpoints for server management
import { Router } from "express";
import type { Request, Response } from "express";
import { ServerManager } from "../services/ServerManager.js";
import { ConnectionManager } from "../services/ConnectionManager.js";
import { defaultTransportFactory } from "../utils/transportFactory.js";
import { validateBody, validateServerId } from "../middleware/validation.js";
import {
  asyncHandler,
  sendSuccess,
  sendError,
} from "../middleware/errorHandler.js";
import { optionalAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  CreateServerRequestSchema,
  UpdateServerRequestSchema,
  type CreateServerRequest,
  type UpdateServerRequest,
  type ServerResponse,
  type ServerListResponse,
} from "../models/types.js";

// Initialize services
const connectionManager = new ConnectionManager(defaultTransportFactory);
const serverManager = new ServerManager(connectionManager);

// Set up notification handler to forward notifications to event stream
import { eventStreamService } from "../services/EventStreamService.js";

connectionManager.setNotificationHandler(
  (serverId: string, notification: any) => {
    // Check if this is a stderr notification
    if (notification.method === "notifications/stderr") {
      // Handle stderr notifications separately
      eventStreamService.sendStdErrNotification(serverId, notification);
    } else {
      // Use enhanced notification level correction from ConnectionManager
      const correctedNotification = connectionManager.correctNotificationLevel(
        serverId,
        notification,
      );

      // Handle regular notifications with corrected levels
      serverManager
        .getServer(serverId)
        .then((server) => {
          if (server) {
            eventStreamService.sendNotification(
              serverId,
              server.name,
              correctedNotification,
            );
          }
        })
        .catch((error) => {
          console.error(
            `Failed to get server name for notification from ${serverId}:`,
            error,
          );
          // Send notification without server name as fallback
          eventStreamService.sendNotification(
            serverId,
            `Server ${serverId}`,
            correctedNotification,
          );
        });
    }
  },
);

/**
 * Create a new server configuration
 * POST /api/servers
 */
const createServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const createRequest: CreateServerRequest = req.body;

    try {
      const serverConfig = await serverManager.createServer(createRequest);
      const status = connectionManager.getServerStatus(serverConfig.id);

      const response: ServerResponse = {
        server: serverConfig,
        status,
      };

      sendSuccess(res, response, 201);
    } catch (error) {
      throw new Error(
        `Failed to create server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get all server configurations
 * GET /api/servers
 */
const getServersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const servers = await serverManager.getAllServers();
      const serverResponses: ServerResponse[] = servers.map((server) => ({
        server,
        status: connectionManager.getServerStatus(server.id),
      }));

      const response: ServerListResponse = {
        servers: serverResponses,
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to retrieve servers: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get a specific server configuration
 * GET /api/servers/:id
 */
const getServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
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
      const response: ServerResponse = {
        server,
        status,
      };

      sendSuccess(res, response);
    } catch (error) {
      throw new Error(
        `Failed to retrieve server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Update a server configuration
 * PUT /api/servers/:id
 */
const updateServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updateRequest: UpdateServerRequest = req.body;

    try {
      const updatedServer = await serverManager.updateServer(id, updateRequest);
      const status = connectionManager.getServerStatus(id);

      const response: ServerResponse = {
        server: updatedServer,
        status,
      };

      sendSuccess(res, response);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return sendError(res, 404, "Not Found", error.message);
      }
      throw new Error(
        `Failed to update server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Delete a server configuration
 * DELETE /api/servers/:id
 */
const deleteServerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
      await serverManager.deleteServer(id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return sendError(res, 404, "Not Found", error.message);
      }
      throw new Error(
        `Failed to delete server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

/**
 * Get server statistics
 * GET /api/servers/stats
 */
const getServerStatsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const totalServers = serverManager.getServerCount();
      const activeConnections = connectionManager.getConnectionCount();
      const statuses = connectionManager.getAllServerStatuses();

      const stats = {
        totalServers,
        activeConnections,
        statusCounts: {
          connected: statuses.filter((s) => s.status === "connected").length,
          connecting: statuses.filter((s) => s.status === "connecting").length,
          disconnected: statuses.filter((s) => s.status === "disconnected")
            .length,
          error: statuses.filter((s) => s.status === "error").length,
        },
      };

      sendSuccess(res, stats);
    } catch (error) {
      throw new Error(
        `Failed to retrieve server statistics: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

// Create router and define routes
export const serversRouter = Router();

// Apply middleware
serversRouter.use(optionalAuth);

// Import connection handlers
import {
  connectServerHandler,
  disconnectServerHandler,
  getServerStatusHandler,
} from "./connections.js";

// Define routes
serversRouter.post(
  "/",
  validateBody(CreateServerRequestSchema),
  createServerHandler,
);
serversRouter.get("/", getServersHandler);
serversRouter.get("/stats", getServerStatsHandler);
serversRouter.get("/:id", validateServerId, getServerHandler);
serversRouter.put(
  "/:id",
  validateServerId,
  validateBody(UpdateServerRequestSchema),
  updateServerHandler,
);
serversRouter.delete("/:id", validateServerId, deleteServerHandler);

// Connection management routes for specific servers
serversRouter.post("/:id/connect", validateServerId, connectServerHandler);
serversRouter.delete("/:id/connect", validateServerId, disconnectServerHandler);
serversRouter.get("/:id/status", validateServerId, getServerStatusHandler);

// Export individual handlers for testing
export {
  createServerHandler,
  getServersHandler,
  getServerHandler,
  updateServerHandler,
  deleteServerHandler,
  getServerStatsHandler,
  serverManager,
  connectionManager,
};
