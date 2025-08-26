// Request validation middleware
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { ApiError } from "../models/types.js";

/**
 * Creates validation middleware for request body using Zod schema
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validatedData = schema.parse(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const apiError: ApiError = {
          error: "Validation Error",
          message: "Request body validation failed",
          code: 400,
        };

        const validationErrors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );

        res.status(400).json({
          ...apiError,
          details: validationErrors,
        });
      } else {
        const apiError: ApiError = {
          error: "Internal Server Error",
          message: "Unexpected validation error",
          code: 500,
        };
        res.status(500).json(apiError);
      }
    }
  };
}

/**
 * Creates validation middleware for request parameters using Zod schema
 */
export function validateParams<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validatedData = schema.parse(req.params);
      req.params = validatedData as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const apiError: ApiError = {
          error: "Validation Error",
          message: "Request parameters validation failed",
          code: 400,
        };

        const validationErrors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );

        res.status(400).json({
          ...apiError,
          details: validationErrors,
        });
      } else {
        const apiError: ApiError = {
          error: "Internal Server Error",
          message: "Unexpected validation error",
          code: 500,
        };
        res.status(500).json(apiError);
      }
    }
  };
}

/**
 * Creates validation middleware for query parameters using Zod schema
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validatedData = schema.parse(req.query);
      req.query = validatedData as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const apiError: ApiError = {
          error: "Validation Error",
          message: "Query parameters validation failed",
          code: 400,
        };

        const validationErrors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );

        res.status(400).json({
          ...apiError,
          details: validationErrors,
        });
      } else {
        const apiError: ApiError = {
          error: "Internal Server Error",
          message: "Unexpected validation error",
          code: 500,
        };
        res.status(500).json(apiError);
      }
    }
  };
}

/**
 * Validation schema for server ID parameter
 */
export const ServerIdParamsSchema = z.object({
  id: z.string().min(1, "Server ID is required"),
});

/**
 * Middleware to validate server ID parameter
 */
export const validateServerId = validateParams(ServerIdParamsSchema);
