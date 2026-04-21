import type {
  CallToolResult,
  GetPromptResult,
  Implementation,
  JSONRPCErrorResponse,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResultResponse,
  Prompt,
  ReadResourceResult,
  Resource,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "../json/jsonUtils.js";

// Stdio transport config
export interface StdioServerConfig {
  // Optional: stdio is the implicit default when `type` is absent. A
  // narrowing `switch (config.type)` must therefore cover the `undefined`
  // branch as `StdioServerConfig`.
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

export type FetchRequestCategory = "auth" | "transport";

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
  /** Distinguishes OAuth/auth fetches from MCP transport fetches */
  category: FetchRequestCategory;
}

/** Entry shape from createFetchTracker before category is added by the caller */
export type FetchRequestEntryBase = Omit<FetchRequestEntry, "category">;

export interface ServerState {
  status: ConnectionStatus;
  error: string | null;
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  resources: Resource[];
  prompts: Prompt[];
  tools: Tool[];
  stderrLogs: StderrLogEntry[];
}

/**
 * Represents a complete resource read invocation, including request parameters,
 * response, and metadata.
 */
export interface ResourceReadInvocation {
  result: ReadResourceResult;
  timestamp: Date;
  uri: string;
  metadata?: Record<string, string>;
}

/**
 * Represents a complete resource template read invocation, including request parameters,
 * response, and metadata.
 */
export interface ResourceTemplateReadInvocation {
  uriTemplate: string;
  expandedUri: string;
  result: ReadResourceResult;
  timestamp: Date;
  params: Record<string, string>;
  metadata?: Record<string, string>;
}

/**
 * Represents a complete prompt get invocation, including request parameters,
 * response, and metadata.
 */
export interface PromptGetInvocation {
  result: GetPromptResult;
  timestamp: Date;
  name: string;
  params?: Record<string, string>;
  metadata?: Record<string, string>;
}

/**
 * Represents a complete tool call invocation, including request parameters,
 * response, and metadata.
 */
export interface ToolCallInvocation {
  toolName: string;
  params: Record<string, JsonValue>;
  result: CallToolResult | null;
  timestamp: Date;
  success: boolean;
  error?: string;
  metadata?: Record<string, string>;
}

// v2-only wrapper types (no v1.5 equivalent)

/**
 * Resource subscription wrapper used by the Resources screen to track
 * subscribed resources and the time of the last update notification.
 */
export interface InspectorResourceSubscription {
  resource: Resource;
  lastUpdated?: Date;
}

/**
 * Runtime settings for a configured server. A subset of
 * InspectorClientOptions (v1.5) relevant to the settings form:
 * connection mode, headers, metadata, timeouts, and OAuth credentials.
 */
export interface InspectorServerSettings {
  connectionMode: "proxy" | "direct";
  headers: { key: string; value: string }[];
  metadata: { key: string; value: string }[];
  connectionTimeout: number;
  requestTimeout: number;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScopes?: string;
}

/**
 * Draft state for importing a server from registry JSON. Owned by the
 * ImportServerJsonPanel wiring layer. `parsed` is typed `unknown` until the
 * registry schema type is added in a follow-up.
 */
export interface InspectorServerJsonDraft {
  rawText: string;
  parsed?: unknown;
  selectedPackageIndex?: number;
  envOverrides: Record<string, string>;
  nameOverride?: string;
}
