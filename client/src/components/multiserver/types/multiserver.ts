import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ServerCapabilities,
  Resource,
  Tool,
  Prompt,
  ServerNotification,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { StdErrNotification } from "../../../lib/notificationTypes.js";

// Multi-server configuration types
export interface MultiServerConfig {
  id: string;
  name: string;
  description?: string;
  transportType: "stdio" | "streamable-http";
  createdAt: Date;
  updatedAt: Date;
}

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

export interface StdioServerConfig extends MultiServerConfig {
  transportType: "stdio";
  config: StdioConfig;
}

export interface HttpServerConfig extends MultiServerConfig {
  transportType: "streamable-http";
  config: HttpConfig;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

// Connection and status types
export interface ServerStatus {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  lastConnected?: Date;
  lastError?: string;
  sessionId?: string;
}

export interface ServerConnection {
  id: string;
  client: Client | null;
  transport: Transport | null;
  capabilities: ServerCapabilities | null;
  serverInfo: any | null;
  instructions: string | null;
  resources: Resource[];
  tools: Tool[];
  prompts: Prompt[];
  // Add logging state
  logLevel: LoggingLevel;
  loggingSupported: boolean;
}

// UI state types
export interface MultiServerState {
  servers: ServerConfig[];
  connections: Map<string, ServerConnection>;
  statuses: Map<string, ServerStatus>;
  selectedServerId: string | null;
  isLoading: boolean;
  error: string | null;
  mode: "single" | "multi";
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
  server: ServerConfig;
  status: ServerStatus;
}

export interface ServerListResponse {
  servers: ServerResponse[];
}

export interface ConnectionRequest {
  serverId: string;
}

export interface ConnectionResponse {
  serverId: string;
  status: ServerStatus;
  connection?: ServerConnection;
}

// Error types
export interface MultiServerError {
  code: string;
  message: string;
  serverId?: string;
  details?: any;
}

// Event types for real-time updates
export interface ServerStatusEvent {
  type: "status_change";
  serverId: string;
  status: ServerStatus;
}

export interface ServerConnectionEvent {
  type: "connection_change";
  serverId: string;
  connection: ServerConnection;
}

export interface ServerNotificationEvent {
  type: "notification";
  serverId: string;
  serverName: string;
  notification: ServerNotification;
  timestamp: string;
}

export interface ServerStdErrNotificationEvent {
  type: "stderr_notification";
  serverId: string;
  serverName: string;
  notification: StdErrNotification;
  timestamp: string;
  source?: "console" | "server";
}

export type MultiServerEvent =
  | ServerStatusEvent
  | ServerConnectionEvent
  | ServerNotificationEvent
  | ServerStdErrNotificationEvent;

// Error aggregation types for dashboard display
export interface ServerErrorSummary {
  serverId: string;
  serverName: string;
  errorCount: number;
  latestError?: StdErrNotification;
  lastErrorTime?: Date;
  source?: "console" | "server";
}

export interface MultiServerErrorState {
  serverErrors: Map<string, StdErrNotification[]>;
  errorSummaries: ServerErrorSummary[];
  totalErrorCount: number;
  consoleErrorCount: number;
  serverErrorCount: number;
}

// Console error interception types
export interface InterceptedConsoleError {
  message: string;
  stack?: string;
  timestamp: number;
  serverName?: string;
}

export interface ConsoleErrorInterceptor {
  setup(
    serverName: string,
    onError: (notification: StdErrNotification) => void,
  ): void;
  cleanup(): void;
  setCurrentServer(serverName: string | null): void;
}

// Cache invalidation types
export interface CacheInvalidationEvent {
  type: "server_deleted" | "server_updated" | "full_refresh";
  serverId?: string;
  timestamp: number;
}

export interface CacheMetadata {
  lastApiSync: number;
  invalidationEvents: CacheInvalidationEvent[];
  version: number;
}

// Persistence types
export interface PersistedMultiServerState {
  servers: ServerConfig[];
  statuses: Record<string, ServerStatus>;
  selectedServerId: string | null;
  lastUpdated: number;
}

export interface EnhancedPersistedState extends PersistedMultiServerState {
  cacheMetadata: CacheMetadata;
}

// Type guard functions for runtime validation
export function isStdioServerConfig(
  server: ServerConfig,
): server is StdioServerConfig {
  return (
    server.transportType === "stdio" &&
    server.config !== undefined &&
    server.config !== null &&
    "command" in server.config &&
    typeof (server.config as StdioConfig).command === "string"
  );
}

export function isHttpServerConfig(
  server: ServerConfig,
): server is HttpServerConfig {
  return (
    server.transportType === "streamable-http" &&
    server.config !== undefined &&
    server.config !== null &&
    "url" in server.config &&
    typeof (server.config as HttpConfig).url === "string"
  );
}

// Safe config access utilities
export function getStdioCommand(server: ServerConfig): string | null {
  return isStdioServerConfig(server) ? server.config.command : null;
}

export function getHttpUrl(server: ServerConfig): string | null {
  return isHttpServerConfig(server) ? server.config.url : null;
}
