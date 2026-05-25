import type {
  CallToolResult,
  ClientNotification,
  ClientRequest,
  GetPromptResult,
  Implementation,
  JSONRPCErrorResponse,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResultResponse,
  LoggingLevel,
  Prompt,
  ReadResourceResult,
  Resource,
  Root,
  ServerCapabilities,
  ServerNotification,
  ServerRequest,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type pino from "pino";
import type { JsonValue } from "../json/jsonUtils.js";
import type {
  OAuthNavigation,
  RedirectUrlProvider,
} from "../auth/providers.js";
import type { OAuthStorage } from "../auth/storage.js";

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
  eventSourceInit?: Record<string, unknown>;
  requestInit?: Record<string, unknown>;
}

// StreamableHTTP transport config
export interface StreamableHttpServerConfig {
  type: "streamable-http";
  url: string;
  requestInit?: Record<string, unknown>;
}

export type MCPServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | StreamableHttpServerConfig;

export type ServerType = "stdio" | "sse" | "streamable-http";

/**
 * On-disk shape for a single `mcp.json` server entry (post-#1358). The base
 * is the SDK-compatible `MCPServerConfig`; each Inspector-specific extension
 * field lives directly alongside `type` / `url` / `command` rather than
 * under a nested `settings` wrapper. This matches the shape Claude Code /
 * Cursor / Cline write to their own `.mcp.json` files (`headers` as a
 * `Record<string, string>`, `oauth` as a nested object), so a hand-edited
 * file from any of those tools is readable on Inspector's first connect.
 *
 * The in-memory + wire shape is unchanged from #1352: `InspectorServerSettings`
 * keeps its pair-array `headers` and flat `oauth*` fields because the form
 * needs them in that shape to drive controlled-component editing. The
 * conversion between disk-flat and memory-pair-array lives in
 * `serverList.ts` (`mcpConfigToServerEntries` /
 * `serverEntriesToMcpConfig`) and the `/api/servers` route's
 * `buildStoredEntry`.
 *
 * Files written by the pre-#1358 build (one #1352 release of v2/main that
 * never shipped a stable tag) had a nested `settings` block here; that
 * shape is dropped on read with a warn and not re-emitted on next write.
 */
export type StoredMCPServer = MCPServerConfig & {
  /**
   * HTTP headers for SSE / streamable-http transports. Persisted as a flat
   * `Record<string, string>` matching the Claude Code / Cursor / Cline
   * `.mcp.json` convention. Lifted into `InspectorServerSettings.headers`
   * (pair-array form) when read into memory.
   */
  headers?: Record<string, string>;
  /**
   * Default `_meta` keys merged into every outgoing MCP request. Inspector-
   * specific (no analog in the broader mcp.json ecosystem), so the pair-array
   * shape is preserved on disk and in memory.
   */
  metadata?: { key: string; value: string }[];
  /** Inspector-specific connect-time timeout (ms). */
  connectionTimeout?: number;
  /** Inspector-specific request timeout (ms). */
  requestTimeout?: number;
  /**
   * Pre-configured OAuth client credentials for HTTP transports. Nested to
   * match Claude Code's `.mcp.json` shape; lifted into the flat `oauthClientId`
   * / `oauthClientSecret` / `oauthScopes` fields on `InspectorServerSettings`
   * when read into memory.
   */
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
  };
};

export interface MCPConfig {
  mcpServers: Record<string, StoredMCPServer>;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Snapshot of a server's connection state, used by dumb components
 * that display status, retry count, and error details.
 */
export interface ConnectionState {
  status: ConnectionStatus;
  retryCount?: number;
  error?: { message: string; details?: string };
}

export interface ServerEntry {
  /** Stable unique identifier — the MCPConfig.mcpServers map key. */
  id: string;
  /** Display label shown in the card header. May or may not equal id. */
  name: string;
  config: MCPServerConfig;
  /**
   * Optional per-server runtime settings (headers, metadata, timeouts, OAuth
   * credentials). On disk these live as direct keys on the entry (post-#1358);
   * in memory they're grouped here in the pair-array / flat-OAuth shape the
   * form needs for controlled-component editing. Edited via ServerSettingsForm;
   * consumed by the transport / InspectorClient at connect time.
   */
  settings?: InspectorServerSettings;
  info?: Implementation;
  connection: ConnectionState;
}

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

/** Method name for any MessageEntry traffic, plus synthetic "response" for result/error entries. */
export type MessageMethod =
  | ClientRequest["method"]
  | ClientNotification["method"]
  | ServerRequest["method"]
  | ServerNotification["method"]
  | "response";

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
 * Wraps a URL-based elicit request from the server. v1.5 only supports
 * form elicitation; v2 introduces URL elicitation as a discriminated variant
 * of the inline elicitation panel. The wrapper carries the request payload
 * plus the URL the user must visit to satisfy it.
 */
export interface InspectorUrlElicitRequest {
  id: string;
  timestamp: Date;
  /** Free-form prompt shown alongside the URL (server-supplied). */
  message: string;
  /** Authorization or interaction URL the user must visit. */
  url: string;
  /** Optional task association for grouping in the tasks view. */
  taskId?: string;
}

/**
 * Generic envelope for pending server-originated requests surfaced to
 * dumb components. Used by the pending-request panel to list anything
 * the user must act on before the protocol can proceed (sampling, elicitation,
 * URL elicitation, roots list, etc.).
 */
export interface InspectorPendingRequest {
  id: string;
  timestamp: Date;
  kind: "sampling" | "elicitation" | "urlElicitation" | "rootsList";
  /** Display label rendered on the queue row. */
  label: string;
  /** Optional task association so panels can group/route. */
  taskId?: string;
}

/**
 * Single entry rendered in the history view. v2 extracts this from the
 * message log so the HistoryScreen can filter/group entries without needing
 * to re-derive direction or method from raw JSON-RPC frames.
 */
export interface InspectorRequestHistoryItem {
  id: string;
  timestamp: Date;
  direction: "request" | "response" | "notification";
  method: string;
  durationMs?: number;
  /** Surfaces the original log entry for detail panes. */
  messageId: MessageEntry["id"];
}

/**
 * OAuth credentials surfaced by the settings form. The form callback
 * passes this whole object so callers don't have to thread per-field
 * dispatches through stringly-typed key arguments.
 */
export interface OAuthSettings {
  clientId: string;
  clientSecret: string;
  scopes: string;
}

/**
 * Runtime settings for a configured server. A subset of
 * InspectorClientOptions (v1.5) relevant to the settings form:
 * headers, metadata, timeouts, and OAuth credentials.
 */
export interface InspectorServerSettings {
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

// ---------------------------------------------------------------------------
// v1.5 InspectorClient runtime types (#1302)
// These are required by the ported InspectorClient class and its supporting
// modules (oauthManager, transports). v2 had pruned them when it kept only
// the static InspectorClientProtocol interface; restoring them verbatim from
// v1.5 keeps the ported client compilable.
// ---------------------------------------------------------------------------

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

  /**
   * Optional per-server runtime settings. Currently used to source custom
   * HTTP headers (settings.headers) for SSE / streamable-http transports.
   * Stdio ignores this — headers are not applicable.
   */
  settings?: InspectorServerSettings;
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
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };

  /**
   * Whether to enable progress notification handling (default: true)
   * If enabled, InspectorClient will register a handler for progress notifications and dispatch progressNotification events
   */
  progress?: boolean;

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
   * Default `_meta` payload merged into every outgoing request the client
   * issues (tools/list, tools/call, prompts/get, resources/read, etc.). Call-
   * site metadata wins on key collision. Set this from `InspectorServerSettings.metadata`
   * so persisted server-wide metadata reaches the wire on the first request.
   */
  defaultMetadata?: Record<string, string>;

  /**
   * Optional per-server runtime settings forwarded to the transport factory
   * (for HTTP transports, settings.headers becomes the wire headers). The
   * other fields on `InspectorServerSettings` are unpacked by the caller
   * into `timeout`, `defaultMetadata`, and `oauth` on this options object —
   * `serverSettings` itself is only consumed by the transport.
   */
  serverSettings?: InspectorServerSettings;

  /**
   * OAuth configuration (client credentials, scope, etc.)
   * Note: OAuth environment components (storage, navigation, redirectUrlProvider)
   * are in environment.oauth, but clientId/clientSecret/scope are config.
   */
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
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
