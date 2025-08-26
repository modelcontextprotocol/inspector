// Server-Sent Events endpoint for real-time updates
import { Router } from "express";
import type { Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { optionalAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { eventStreamService } from "../services/EventStreamService.js";

/**
 * Server-Sent Events endpoint
 * GET /api/events
 */
const eventsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    // Add client to event stream
    eventStreamService.addClient(res);
  },
);

/**
 * Get event stream statistics
 * GET /api/events/stats
 */
const getEventStatsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const stats = {
      connectedClients: eventStreamService.getClientCount(),
      timestamp: new Date().toISOString(),
    };

    res.json(stats);
  },
);

// Create router and define routes
export const eventsRouter = Router();

// Apply middleware
eventsRouter.use(optionalAuth);

// Define routes
eventsRouter.get("/", eventsHandler);
eventsRouter.get("/stats", getEventStatsHandler);

// Export handlers for testing
export { eventsHandler, getEventStatsHandler };
