// Core server configuration types and interfaces
import { z } from "zod";

// Base server configuration interface
export interface ServerConfig {
  id: string;
  name: string;
  description?: string;
  transportType: "stdio" | "streamable-http";
  createdAt: Date;
  updatedAt: Date;
}

// Configuration-specific interfaces
export interface StdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  headerName?: string;
  oauthClientId?: string;
  oauthScope?: string;
}

// STDIO-specific configuration with nested config
export interface StdioServerConfig extends ServerConfig {
  transportType: "stdio";
  config: StdioConfig;
}

// HTTP-specific configuration with nested config
export interface HttpServerConfig extends ServerConfig {
  transportType: "streamable-http";
  config: HttpConfig;
}

// Union type for all server configurations
export type MultiServerConfig = StdioServerConfig | HttpServerConfig;

// Server status and connection state
export interface ServerStatus {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  lastConnected?: Date;
  lastError?: string;
  sessionId?: string;
}

// API request/response types
export interface CreateServerRequest {
  name: string;
  description?: string;
  transportType: "stdio" | "streamable-http";
  config: StdioConfig | HttpConfig;
}

export interface UpdateServerRequest {
  name?: string;
  description?: string;
  config?: StdioConfig | HttpConfig;
}

export interface ServerResponse {
  server: MultiServerConfig;
  status: ServerStatus;
}

export interface ServerListResponse {
  servers: ServerResponse[];
}

// Connection types
export interface ServerConnection {
  id: string;
  client: any | null;
  transport: any | null;
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

export interface ConnectionRequest {
  serverId: string;
}

export interface ConnectionResponse {
  serverId: string;
  status: ServerStatus;
  connection?: ServerConnection;
}

// Error response types
export interface ApiError {
  error: string;
  message: string;
  code?: number;
}

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}

// Zod schemas for runtime validation
export const StdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()),
});

export const HttpConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  bearerToken: z.string().optional(),
  headerName: z.string().optional(),
  oauthClientId: z.string().optional(),
  oauthScope: z.string().optional(),
});

export const CreateServerRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  transportType: z.enum(["stdio", "streamable-http"]),
  config: z.union([StdioConfigSchema, HttpConfigSchema]),
});

export const UpdateServerRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  config: z
    .union([StdioConfigSchema.partial(), HttpConfigSchema.partial()])
    .optional(),
});

// Type guards for runtime type checking
export function isStdioServerConfig(
  config: MultiServerConfig,
): config is StdioServerConfig {
  return (
    config.transportType === "stdio" &&
    config.config !== undefined &&
    config.config !== null &&
    "command" in config.config &&
    typeof (config.config as StdioConfig).command === "string"
  );
}

export function isHttpServerConfig(
  config: MultiServerConfig,
): config is HttpServerConfig {
  return (
    config.transportType === "streamable-http" &&
    config.config !== undefined &&
    config.config !== null &&
    "url" in config.config &&
    typeof (config.config as HttpConfig).url === "string"
  );
}
