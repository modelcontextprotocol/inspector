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
  type: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  requestInit?: Record<string, unknown>;
}

export type MCPServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | StreamableHttpServerConfig;

export type ServerType = "stdio" | "sse" | "streamable-http";

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

export interface FetchRequestEntry {
  id: string;
  timestamp: Date;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseStatusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  duration?: number; // Time between request and response in ms
  error?: string;
}

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface CreateTransportOptions {
  /**
   * Optional callback to handle stderr logs from stdio transports
   */
  onStderr?: (entry: StderrLogEntry) => void;

  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;

  /**
   * Optional callback to track HTTP fetch requests (for SSE and streamable-http transports)
   */
  onFetchRequest?: (entry: FetchRequestEntry) => void;

  /**
   * Optional OAuth client provider for Bearer authentication (SSE, streamable-http).
   * When set, the SDK injects tokens and handles 401 via the provider.
   */
  authProvider?: OAuthClientProvider;
}

export interface CreateTransportResult {
  transport: Transport;
}

/**
 * Factory that creates a client transport for an MCP server configuration.
 * Required by InspectorClient; caller provides the implementation for their
 * environment (e.g. createTransport for Node, RemoteClientTransport factory for browser).
 */
export type CreateTransport = (
  config: MCPServerConfig,
  options: CreateTransportOptions,
) => CreateTransportResult;

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

import type {
  ReadResourceResult,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "../json/jsonUtils.js";

/**
 * Represents a complete resource read invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.readResource()
 * and cached for later retrieval.
 */
export interface ResourceReadInvocation {
  result: ReadResourceResult; // The full SDK response object
  timestamp: Date; // When the call was made
  uri: string; // The URI that was read (request parameter)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

/**
 * Represents a complete resource template read invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.readResourceFromTemplate()
 * and cached for later retrieval.
 */
export interface ResourceTemplateReadInvocation {
  uriTemplate: string; // The URI template string (unique ID)
  expandedUri: string; // The expanded URI after template expansion
  result: ReadResourceResult; // The full SDK response object
  timestamp: Date; // When the call was made
  params: Record<string, string>; // The parameters used to expand the template (request parameters)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

/**
 * Represents a complete prompt get invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.getPrompt()
 * and cached for later retrieval.
 */
export interface PromptGetInvocation {
  result: GetPromptResult; // The full SDK response object
  timestamp: Date; // When the call was made
  name: string; // The prompt name (request parameter)
  params?: Record<string, string>; // The parameters used when fetching the prompt (request parameters)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

/**
 * Represents a complete tool call invocation, including request parameters,
 * response, and metadata. This object is returned from InspectorClient.callTool()
 * and cached for later retrieval.
 */
export interface ToolCallInvocation {
  toolName: string; // The tool that was called (request parameter)
  params: Record<string, JsonValue>; // The arguments passed to the tool (request parameters)
  result: CallToolResult | null; // The full SDK response object (null on error)
  timestamp: Date; // When the call was made
  success: boolean; // true if call succeeded, false if it threw
  error?: string; // Error message if success === false
  metadata?: Record<string, string>; // Optional metadata that was passed
}
