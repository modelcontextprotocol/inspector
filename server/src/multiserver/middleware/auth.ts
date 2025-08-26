// Authentication middleware (extends existing)
import type { Request, Response, NextFunction } from "express";
import { sendError } from "./errorHandler.js";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Extended request interface with user information
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name?: string;
    permissions?: string[];
  };
}

/**
 * Basic authentication middleware for multiserver API
 * This extends the existing authentication patterns from the main server
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  // For now, we'll implement a simple pass-through since the main server
  // handles authentication. In a production environment, this would
  // validate JWT tokens, API keys, or other authentication mechanisms.

  // Check if the request has proper authentication headers
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // For development/testing, we'll allow requests without auth
    // In production, this should be more restrictive
    console.warn(
      "No authorization header found, allowing request for development",
    );
    return next();
  }

  // Basic token validation (placeholder implementation)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    // In a real implementation, validate the token here
    // For now, we'll accept any bearer token
    req.user = {
      id: "default-user",
      name: "Development User",
      permissions: ["read", "write", "admin"],
    };

    return next();
  }

  // Invalid authentication format
  sendError(res, 401, "Unauthorized", "Invalid authentication format");
}

/**
 * Permission-based authorization middleware
 */
export function requirePermission(permission: string) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user) {
      return sendError(res, 401, "Unauthorized", "Authentication required");
    }

    const userPermissions = req.user.permissions || [];

    if (
      !userPermissions.includes(permission) &&
      !userPermissions.includes("admin")
    ) {
      return sendError(
        res,
        403,
        "Forbidden",
        `Permission '${permission}' required`,
      );
    }

    next();
  };
}

/**
 * MCP Proxy authentication middleware (matches single-server implementation)
 * Uses the same token validation as the main server
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  // Get session token from environment (same as main server)
  const sessionToken =
    process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");
  const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;

  if (authDisabled) {
    return next();
  }

  const sendUnauthorized = () => {
    res.status(401).json({
      error: "Unauthorized",
      message:
        "Authentication required. Use the session token shown in the console when starting the server.",
    });
  };

  // Check x-mcp-proxy-auth header (same as main server)
  const authHeader = req.headers["x-mcp-proxy-auth"];
  const authHeaderValue = Array.isArray(authHeader)
    ? authHeader[0]
    : authHeader;

  // Also check query parameter for EventSource requests (which can't send custom headers)
  const queryToken = req.query.MCP_PROXY_AUTH_TOKEN as string;

  let providedToken: string | null = null;

  if (authHeaderValue && authHeaderValue.startsWith("Bearer ")) {
    providedToken = authHeaderValue.substring(7); // Remove 'Bearer ' prefix
  } else if (queryToken) {
    providedToken = queryToken;
  }

  if (!providedToken) {
    // For optional auth, continue without authentication
    return next();
  }

  const expectedToken = sessionToken;

  // Convert to buffers for timing-safe comparison
  const providedBuffer = Buffer.from(providedToken);
  const expectedBuffer = Buffer.from(expectedToken);

  // Check length first to prevent timing attacks
  if (providedBuffer.length !== expectedBuffer.length) {
    // For optional auth, continue without authentication instead of sending 401
    return next();
  }

  // Perform timing-safe comparison
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    // For optional auth, continue without authentication instead of sending 401
    return next();
  }

  // Authentication successful
  req.user = {
    id: "authenticated-user",
    name: "MCP Inspector User",
    permissions: ["read", "write", "admin"],
  };

  next();
}

/**
 * Rate limiting middleware (basic implementation)
 */
export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || "unknown";
    const now = Date.now();

    const clientData = requests.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      // Reset or initialize client data
      requests.set(clientId, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (clientData.count >= maxRequests) {
      return sendError(res, 429, "Too Many Requests", "Rate limit exceeded");
    }

    // Increment request count
    clientData.count++;
    next();
  };
}

/**
 * CORS middleware for multiserver API
 */
export function corsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Set CORS headers
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }

  next();
}
