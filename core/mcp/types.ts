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
  Resource,
  Prompt,
  Tool,
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

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface CreateTransportOptions {
  /**
   * Optional fetch function. When provided, used as the base for transport HTTP requests
   * (SSE, streamable-http). Enables proxy fetch in browser (CORS bypass).
   */
  fetchFn?: typeof fetch;

  /**
   * Optional callback to handle stderr logs from stdio transports
   */
  onStderr?: (entry: StderrLogEntry) => void;

  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;

  /**
   * Optional callback to track HTTP fetch requests (for SSE and streamable-http transports).
   * Receives entries without category; caller adds category when storing.
   */
  onFetchRequest?: (entry: FetchRequestEntryBase) => void;

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
  resources: Resource[];
  prompts: Prompt[];
  tools: Tool[];
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

// InspectorClient constructor and environment types
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { LoggingLevel, Root } from "@modelcontextprotocol/sdk/types.js";
import type pino from "pino";
import type {
  OAuthNavigation,
  RedirectUrlProvider,
} from "../auth/providers.js";
import type { OAuthStorage } from "../auth/storage.js";

/**
 * Type for the client-like object passed to AppRenderer / @mcp-ui.
 * Structurally compatible with the MCP SDK Client but denotes the app-renderer
 * proxy, not the raw client. Use this type when passing the client to the Apps tab.
 */
export type AppRendererClient = Client;

/**
 * Consolidated environment interface that defines all environment-specific seams.
 * Each environment (Node, browser, tests) provides a complete implementation bundle.
 */
export interface InspectorClientEnvironment {
  /**
   * Factory that creates a client transport for the given server config.
   * Required. Environment provides the implementation:
   * - Node: createTransportNode
   * - Browser: createRemoteTransport
   */
  transport: CreateTransport;

  /**
   * Optional fetch function for HTTP requests (OAuth discovery/token exchange and
   * MCP transport). When provided, used for both auth and transport to bypass CORS.
   * - Node: undefined (uses global fetch)
   * - Browser: createRemoteFetch
   */
  fetch?: typeof fetch;

  /**
   * Optional logger for InspectorClient events (transport, OAuth, etc.).
   * - Node: pino file logger
   * - Browser: createRemoteLogger
   */
  logger?: pino.Logger;

  /**
   * OAuth environment components
   */
  oauth?: {
    /**
     * OAuth storage implementation
     * - Node: NodeOAuthStorage (file-based)
     * - Browser: BrowserOAuthStorage (sessionStorage) or RemoteOAuthStorage (shared state)
     */
    storage?: OAuthStorage;

    /**
     * Navigation handler for redirecting users to authorization URLs
     * - Node: ConsoleNavigation
     * - Browser: BrowserNavigation
     */
    navigation?: OAuthNavigation;

    /**
     * Redirect URL provider
     * - Node: from OAuth callback server
     * - Browser: from window.location or callback route
     */
    redirectUrlProvider?: RedirectUrlProvider;
  };
}

export interface InspectorClientOptions {
  /**
   * Environment-specific implementations (transport, fetch, logger, OAuth components)
   */
  environment: InspectorClientEnvironment;

  /**
   * Client identity (name and version)
   */
  clientIdentity?: {
    name: string;
    version: string;
  };
  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;

  /**
   * Initial logging level to set after connection (if server supports logging)
   * If not provided, logging level will not be set automatically
   */
  initialLoggingLevel?: LoggingLevel;

  /**
   * Whether to advertise sampling capability (default: true)
   */
  sample?: boolean;

  /**
   * Elicitation capability configuration
   * - `true` - support form-based elicitation only (default, for backward compatibility)
   * - `{ form: true }` - support form-based elicitation only
   * - `{ url: true }` - support URL-based elicitation only
   * - `{ form: true, url: true }` - support both form and URL-based elicitation
   * - `false` or `undefined` - no elicitation support
   */
  elicit?:
    | boolean
    | {
        form?: boolean;
        url?: boolean;
      };

  /**
   * Initial roots to configure. If provided (even if empty array), the client will
   * advertise roots capability and handle roots/list requests from the server.
   */
  roots?: Root[];

  /**
   * Whether to enable listChanged notification handlers (default: true)
   * If enabled, InspectorClient will subscribe to list_changed notifications and fire
   * corresponding events (toolsListChanged, resourcesListChanged, promptsListChanged).
   */
  listChangedNotifications?: {
    tools?: boolean; // default: true
    resources?: boolean; // default: true
    prompts?: boolean; // default: true
  };

  /**
   * Whether to enable progress notification handling (default: true)
   * If enabled, InspectorClient will register a handler for progress notifications and dispatch progressNotification events
   */
  progress?: boolean; // default: true

  /**
   * If true, receiving a progress notification resets the request timeout (default: true).
   * Only applies to requests that can receive progress. Set to false for strict timeout caps.
   */
  resetTimeoutOnProgress?: boolean;

  /**
   * Per-request timeout in milliseconds. If not set, the SDK default (60_000) is used.
   */
  timeout?: number;

  /**
   * OAuth configuration (client credentials, scope, etc.)
   * Note: OAuth environment components (storage, navigation, redirectUrlProvider)
   * are in environment.oauth, but clientId/clientSecret/scope are config.
   */
  oauth?: {
    /**
     * Preregistered client ID (optional, will use DCR if not provided)
     * If clientMetadataUrl is provided, this is ignored (CIMD mode)
     */
    clientId?: string;

    /**
     * Preregistered client secret (optional, only if client requires secret)
     * If clientMetadataUrl is provided, this is ignored (CIMD mode)
     */
    clientSecret?: string;

    /**
     * Client metadata URL for CIMD (Client ID Metadata Documents) mode
     * If provided, enables URL-based client IDs (SEP-991)
     * The URL becomes the client_id, and the authorization server fetches it to discover client metadata
     */
    clientMetadataUrl?: string;

    /**
     * OAuth scope (optional, will be discovered if not provided)
     */
    scope?: string;
  };

  /**
   * Optional session ID. If not provided, will be extracted from OAuth state
   * when OAuth flow starts. Passed in saveSession event for FetchRequestLogState.
   */
  sessionId?: string;

  /**
   * When true, advertise receiver-task capability and handle task-augmented
   * sampling/createMessage and elicit; register tasks/list, tasks/get,
   * tasks/result, tasks/cancel handlers. Default false.
   */
  receiverTasks?: boolean;

  /**
   * TTL in ms for receiver tasks when server sends params.task without ttl.
   * Only used when receiverTasks is true. If a function, called at task creation.
   * Default 60_000 when omitted.
   */
  receiverTaskTtlMs?: number | (() => number);
}
