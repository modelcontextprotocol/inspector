// Stdio transport config
export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

// SSE transport config
export interface SseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  eventSourceInit?: Record<string, unknown>;
  requestInit?: Record<string, unknown>;
}

// StreamableHTTP transport config
export interface StreamableHttpServerConfig {
  type: "streamableHttp";
  url: string;
  headers?: Record<string, string>;
  requestInit?: Record<string, unknown>;
}

export type MCPServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | StreamableHttpServerConfig;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface StderrLogEntry {
  timestamp: Date;
  message: string;
}

import type {
  ServerCapabilities,
  Implementation,
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
} from "@modelcontextprotocol/sdk/types.js";

export interface MessageEntry {
  id: string;
  timestamp: Date;
  direction: "request" | "response" | "notification";
  message:
    | JSONRPCRequest
    | JSONRPCNotification
    | JSONRPCResultResponse
    | JSONRPCErrorResponse;
  response?: JSONRPCResultResponse | JSONRPCErrorResponse;
  duration?: number; // Time between request and response in ms
}

export interface ServerState {
  status: ConnectionStatus;
  error: string | null;
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  resources: any[];
  prompts: any[];
  tools: any[];
  stderrLogs: StderrLogEntry[];
}
