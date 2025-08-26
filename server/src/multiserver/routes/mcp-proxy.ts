// MCP request proxy endpoints
import { Router } from "express";
import type { Response } from "express";
import { validateServerId } from "../middleware/validation.js";
import {
  asyncHandler,
  sendSuccess,
  sendError,
} from "../middleware/errorHandler.js";
import { optionalAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { serverManager, connectionManager } from "./servers.js";
import { z } from "zod";

// Zod schemas for MCP requests
const MCPRequestSchema = z.object({
  method: z.string(),
  params: z.any().optional(),
});

const ListResourcesRequestSchema = z.object({
  method: z.literal("resources/list"),
  params: z.any().optional(),
});

const ListToolsRequestSchema = z.object({
  method: z.literal("tools/list"),
  params: z.any().optional(),
});

const ListPromptsRequestSchema = z.object({
  method: z.literal("prompts/list"),
  params: z.any().optional(),
});

const CallToolRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.string(),
    arguments: z.any().optional(),
  }),
});

const GetPromptRequestSchema = z.object({
  method: z.literal("prompts/get"),
  params: z.object({
    name: z.string(),
    arguments: z.any().optional(),
  }),
});

const ReadResourceRequestSchema = z.object({
  method: z.literal("resources/read"),
  params: z.object({
    uri: z.string(),
  }),
});

const PingRequestSchema = z.object({
  method: z.literal("ping"),
  params: z.any().optional(),
});

const SamplingRequestSchema = z.object({
  method: z.literal("sampling/createMessage"),
  params: z.object({
    messages: z.array(z.any()),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    includeContext: z.string().optional(),
  }),
});

/**
 * Generic MCP request proxy
 * POST /api/servers/:id/request
 */
const proxyMCPRequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const requestBody = req.body;

    try {
      // Validate basic request structure
      const mcpRequest = MCPRequestSchema.parse(requestBody);

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

      // Check if server is connected
      if (!connectionManager.isServerConnected(id)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${id} is not connected`,
        );
      }

      // Get the connection
      const connection = connectionManager.getConnection(id);
      if (!connection?.client) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `No active client connection for server ${id}`,
        );
      }

      // Make the request to the MCP server
      let result;
      try {
        // Use the client's request method directly without schema validation
        // since we're proxying arbitrary requests
        result = await connection.client.request(
          {
            method: mcpRequest.method,
            params: mcpRequest.params,
          },
          z.any(),
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return sendError(
          res,
          400,
          "MCP Request Failed",
          `MCP request failed: ${errorMessage}`,
        );
      }

      sendSuccess(res, { result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "Bad Request", "Invalid request format");
      }

      throw error;
    }
  },
);

/**
 * List resources
 * GET /api/servers/:id/resources
 */
const listResourcesHandler = asyncHandler(
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

      // Check if server is connected
      if (!connectionManager.isServerConnected(id)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${id} is not connected`,
        );
      }

      // Get the connection
      const connection = connectionManager.getConnection(id);
      if (!connection) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `No active connection for server ${id}`,
        );
      }

      // Return cached resources from connection
      sendSuccess(res, { resources: connection.resources });
    } catch (error) {
      throw error;
    }
  },
);

/**
 * List tools
 * GET /api/servers/:id/tools
 */
const listToolsHandler = asyncHandler(
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

      // Check if server is connected
      if (!connectionManager.isServerConnected(id)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${id} is not connected`,
        );
      }

      // Get the connection
      const connection = connectionManager.getConnection(id);
      if (!connection) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `No active connection for server ${id}`,
        );
      }

      // Return cached tools from connection
      sendSuccess(res, { tools: connection.tools });
    } catch (error) {
      throw error;
    }
  },
);

/**
 * List prompts
 * GET /api/servers/:id/prompts
 */
const listPromptsHandler = asyncHandler(
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

      // Check if server is connected
      if (!connectionManager.isServerConnected(id)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${id} is not connected`,
        );
      }

      // Get the connection
      const connection = connectionManager.getConnection(id);
      if (!connection) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `No active connection for server ${id}`,
        );
      }

      // Return cached prompts from connection
      sendSuccess(res, { prompts: connection.prompts });
    } catch (error) {
      throw error;
    }
  },
);

/**
 * Get server capabilities
 * GET /api/servers/:id/capabilities
 */
const getCapabilitiesHandler = asyncHandler(
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

      // Check if server is connected
      if (!connectionManager.isServerConnected(id)) {
        return sendError(
          res,
          400,
          "Bad Request",
          `Server ${id} is not connected`,
        );
      }

      // Get the connection
      const connection = connectionManager.getConnection(id);
      if (!connection) {
        return sendError(
          res,
          500,
          "Internal Server Error",
          `No active connection for server ${id}`,
        );
      }

      // Return cached capabilities from connection
      sendSuccess(res, { capabilities: connection.capabilities });
    } catch (error) {
      throw error;
    }
  },
);

// Create router and define routes
export const mcpProxyRouter = Router();

// Generic MCP request proxy
mcpProxyRouter.post("/:id/request", validateServerId, proxyMCPRequestHandler);

// Specific endpoints for common operations
mcpProxyRouter.get("/:id/resources", validateServerId, listResourcesHandler);
mcpProxyRouter.get("/:id/tools", validateServerId, listToolsHandler);
mcpProxyRouter.get("/:id/prompts", validateServerId, listPromptsHandler);
mcpProxyRouter.get(
  "/:id/capabilities",
  validateServerId,
  getCapabilitiesHandler,
);

// Export individual handlers for testing
export {
  proxyMCPRequestHandler,
  listResourcesHandler,
  listToolsHandler,
  listPromptsHandler,
  getCapabilitiesHandler,
};
