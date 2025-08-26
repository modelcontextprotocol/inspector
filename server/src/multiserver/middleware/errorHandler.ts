// Error handling middleware
import type { Request, Response, NextFunction } from "express";
import type { ApiError } from "../models/types.js";

/**
 * Global error handling middleware for multiserver API
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  console.error("Multiserver API Error:", {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
  });

  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  // Determine error type and status code
  let statusCode = 500;
  let apiError: ApiError = {
    error: "Internal Server Error",
    message: "An unexpected error occurred",
    code: 500,
  };

  // Handle specific error types
  if (error.message.includes("not found")) {
    statusCode = 404;
    apiError = {
      error: "Not Found",
      message: error.message,
      code: 404,
    };
  } else if (
    error.message.includes("Invalid") ||
    error.message.includes("validation")
  ) {
    statusCode = 400;
    apiError = {
      error: "Bad Request",
      message: error.message,
      code: 400,
    };
  } else if (
    error.message.includes("Unauthorized") ||
    error.message.includes("authentication")
  ) {
    statusCode = 401;
    apiError = {
      error: "Unauthorized",
      message: error.message,
      code: 401,
    };
  } else if (
    error.message.includes("Forbidden") ||
    error.message.includes("permission")
  ) {
    statusCode = 403;
    apiError = {
      error: "Forbidden",
      message: error.message,
      code: 403,
    };
  } else if (
    error.message.includes("conflict") ||
    error.message.includes("already exists")
  ) {
    statusCode = 409;
    apiError = {
      error: "Conflict",
      message: error.message,
      code: 409,
    };
  } else if (
    error.message.includes("timeout") ||
    error.message.includes("connection")
  ) {
    statusCode = 503;
    apiError = {
      error: "Service Unavailable",
      message: error.message,
      code: 503,
    };
  }

  // Send error response
  res.status(statusCode).json(apiError);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<any>,
) {
  return (req: T, res: U, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  const apiError: ApiError = {
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
    code: 404,
  };

  res.status(404).json(apiError);
}

/**
 * Creates a standardized API error
 */
export function createApiError(
  statusCode: number,
  error: string,
  message: string,
): ApiError {
  return {
    error,
    message,
    code: statusCode,
  };
}

/**
 * Sends a standardized success response
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
): void {
  res.status(statusCode).json(data);
}

/**
 * Sends a standardized error response
 */
export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
): void {
  const apiError = createApiError(statusCode, error, message);
  res.status(statusCode).json(apiError);
}
