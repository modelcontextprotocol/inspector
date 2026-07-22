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
  VersionNegotiationOptions,
} from "@modelcontextprotocol/client";
import type { Client } from "@modelcontextprotocol/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
import type { InspectorLogger } from "../logging/logger.js";
import type { JsonValue } from "../json/jsonUtils.js";
import type {
  ClientConfig,
  EnterpriseManagedAuthIdpConfig,
} from "../client/types.js";
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
  /**
   * Protocol era to negotiate with this server (`"legacy" | "auto" | "modern"`),
   * orthogonal to the transport `type`. Inspector-specific (no analog in the
   * broader mcp.json ecosystem). Omitted on disk when it equals the default
   * (`"legacy"`). (#1626)
   */
  protocolEra?: ServerProtocolEra;
  /**
   * Modern-era per-request log level stamped by default (`"off"` or one of the
   * eight logging levels). Inspector-specific. Omitted on disk when it equals
   * `DEFAULT_MODERN_LOG_LEVEL` (`"debug"`). Only affects modern connections.
   * (#1629)
   */
  modernLogLevel?: ModernLogLevel;
  /** Inspector-specific connect-time timeout (ms). */
  connectionTimeout?: number;
  /** Inspector-specific request timeout (ms). */
  requestTimeout?: number;
  /** Inspector-specific TTL (ms) for tasks created via "Run as task". */
  taskTtl?: number;
  /**
   * When true, the managed list state auto-refreshes on `list_changed`
   * notifications instead of only flagging the list-changed indicator and
   * waiting for the user to pull. Inspector-specific. Omitted on disk when
   * false (the default). (#1402)
   */
  autoRefreshOnListChanged?: boolean;
  /**
   * When true, the tools/resources/prompts lists are fetched one page at a time
   * (a manual "Load next page" control surfaces the server's `nextCursor`)
   * instead of auto-aggregating every page on load. A defensive default for
   * servers with very large lists. Inspector-specific. Omitted on disk when
   * false (the default). (#1721)
   */
  paginatedLists?: boolean;
  /**
   * Per-extension overrides for which extensions the Inspector advertises to
   * this server (keyed by extension id; a present key wins over the registry
   * default). Inspector-specific. Omitted on disk when empty, keeping the file
   * diff minimal for servers that never toggled one. (#1739)
   */
  advertisedExtensions?: Record<string, boolean>;
  /**
   * Maximum number of HTTP fetch requests retained in the Network log for this
   * server (oldest rotate out past the cap). Inspector-specific. Omitted on
   * disk when it equals `DEFAULT_MAX_FETCH_REQUESTS` (the default), keeping the
   * file diff minimal for servers that never tuned it. `0` means unlimited.
   */
  maxFetchRequests?: number;
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
    /** When true, connect via enterprise IdP (EMA) instead of standard resource OAuth. */
    enterpriseManaged?: boolean;
    /** SEP-2350 step-up policy for `403 insufficient_scope` (default `reauthorize`). */
    onInsufficientScope?: OnInsufficientScopePolicy;
  };
  /**
   * Filesystem/URI roots advertised to the server via the `roots` client
   * capability. Inspector-specific (no analog in the broader mcp.json
   * ecosystem). Each root is the SDK `Root` shape `{ uri, name? }`; unlike v1
   * (URI-only), the optional `name` round-trips here. Persisted as-is on disk
   * and lifted onto `InspectorServerSettings.roots` when read into memory.
   */
  roots?: Root[];
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
 * True when a connection has settled into a non-live terminal state — either a
 * clean `"disconnected"` or a crashed `"error"`. Both mean the session is over
 * and any cached server state (tool/resource/prompt lists, message log,
 * subscriptions) should be torn down.
 *
 * Session-teardown consumers must key off this predicate rather than branching
 * on `status === "disconnected"` alone: on a real mid-session crash many SDK
 * transports fire BOTH `onclose` and `onerror` in a transport-dependent order,
 * and the canonical terminal status is now `"error"` regardless of ordering
 * (see InspectorClient's `onclose` handler, #1490). A bare `=== "disconnected"`
 * check would therefore tear down in one ordering but not the other.
 */
export function isTerminalStatus(
  status: ConnectionStatus | undefined,
): boolean {
  return status === "disconnected" || status === "error";
}

/**
 * Snapshot of a server's connection state, used by dumb components
 * that display status, retry count, and error details.
 */
export interface ConnectionState {
  status: ConnectionStatus;
  retryCount?: number;
  error?: { message: string; details?: string };
  /**
   * MCP protocol version negotiated with the server during initialize
   * (e.g. "2025-06-18"). Only present once connected; surfaced in the
   * ServerCard transport row. Populated when #1324 plumbs the value
   * through `useInspectorClient`.
   */
  protocolVersion?: string;
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

/** Who sent a tracked message: the inspector ("client") or the "server". */
export type MessageOrigin = "client" | "server";

/**
 * How a pending sampling/elicitation request reached the Inspector, so the
 * pending-request UI can show era-accurate semantics:
 * - `"server-request"` — a legacy (≤2025-11-25) server→client JSON-RPC request
 *   (`sampling/createMessage` / `elicitation/create`) delivered to our handler.
 * - `"input-required"` — a modern (2026-07-28) MRTR round: the request was
 *   embedded in a tool-call/prompt/resource `input_required` result, and the
 *   user's answer is echoed back to the server as a retry (SEP-2322).
 * - `"task-input-required"` — a modern task (SEP-2663) that reached
 *   `input_required`: the request came from the task's `tasks/get` `inputRequests`
 *   map, and the user's answer is submitted via a `tasks/update` request (NOT a
 *   retry of the original call, unlike MRTR).
 */
export type PendingRequestOrigin =
  | "server-request"
  | "input-required"
  | "task-input-required";

export interface MessageEntry {
  id: string;
  timestamp: Date;
  direction: "request" | "response" | "notification";
  /**
   * Who sent the message — drives the History direction badge (client → server
   * vs client ← server). Set at tracking time: outgoing (transport `send`) is
   * "client", incoming (`onmessage`) is "server". Optional for back-compat with
   * older logs and test fixtures that predate it.
   */
  origin?: MessageOrigin;
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
  /**
   * Set only on the `skipOutputValidation` path: present when the (delivered)
   * result's structuredContent does NOT match the tool's declared outputSchema.
   * The call still succeeds and the result is returned — this is a non-fatal
   * advisory so callers can warn that strict MCP clients would reject the
   * payload (and the app may not render in them).
   */
  outputValidationError?: string;
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
 * Lifecycle status of the single modern-era `subscriptions/listen` stream that
 * backs every resource subscription on a 2026-07-28 server (#1630).
 *
 * - `"connecting"` — a `listen()` request is in flight and hasn't been
 *   acknowledged yet (the optimistic state shown the moment the user subscribes,
 *   so the UI responds to the click without waiting for the ack round-trip).
 * - `"acknowledged"` — the `listen()` request resolved and the server sent
 *   `notifications/subscriptions/acknowledged`; the stream is open and carrying
 *   updates.
 * - `"reconnecting"` — the stream dropped unexpectedly (`closed` resolved
 *   `"remote"`) and a re-listen is in flight (reconnect-by-re-listen; there is
 *   no resumability, so the re-listen re-establishes the full filter).
 * - `"ended"` — the server tore the stream down deliberately (`closed` resolved
 *   `"graceful"`, e.g. on shutdown) or reconnection was abandoned; no automatic
 *   re-listen.
 */
export type ResourceSubscriptionStreamStatus =
  | "connecting"
  | "acknowledged"
  | "reconnecting"
  | "ended";

/**
 * State of the modern-era resource-subscription listen stream (#1630).
 *
 * On the legacy era each `resources/subscribe` is an independent request with no
 * persistent stream, so `active` is `false` and the UI surfaces no stream chrome.
 * On the modern era all subscriptions are a filter over one long-lived
 * `subscriptions/listen` stream; `active` is `true` whenever that stream is being
 * managed (i.e. at least one URI is subscribed), and `honoredUris` is the subset
 * of requested URIs the server acknowledged in its `honoredFilter` (may be a
 * strict subset — a server is allowed to decline some).
 */
export interface ResourceSubscriptionStreamState {
  active: boolean;
  status: ResourceSubscriptionStreamStatus;
  honoredUris: string[];
}

/** The stream state reported on the legacy era (or before any subscription). */
export const INACTIVE_SUBSCRIPTION_STREAM_STATE: ResourceSubscriptionStreamState =
  {
    active: false,
    status: "ended",
    honoredUris: [],
  };

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
  enterpriseManaged?: boolean;
  onInsufficientScope?: OnInsufficientScopePolicy;
}

/**
 * SEP-2350 step-up policy for a `403 insufficient_scope` challenge. `reauthorize`
 * (the SDK default) drives step-up authorization with the accumulated scope union;
 * `throw` surfaces the challenge to the host instead. Forwarded to the
 * StreamableHTTP transport's `onInsufficientScope` option.
 */
export type OnInsufficientScopePolicy = "reauthorize" | "throw";

/**
 * Default TTL (ms) for tasks created via "Run as task". Mirrors v1/v1.5's
 * `MCP_TASK_TTL` config default. Used when a server has no explicit `taskTtl`.
 */
export const DEFAULT_TASK_TTL_MS = 60000;

/**
 * Default maximum number of HTTP fetch requests retained in the Network log
 * (per server). When exceeded, the oldest entries rotate out. A larger value
 * keeps more history at the cost of memory; `0` means unlimited (not
 * recommended). Mirrors `FetchRequestLogState`'s built-in default so the form
 * and the log state agree on the omit-sentinel.
 */
export const DEFAULT_MAX_FETCH_REQUESTS = 1000;

/**
 * Per-server protocol era (SEP §7.8 backward-compat model), an orthogonal
 * dimension to the transport `type`. Drives the SDK Client's
 * `versionNegotiation`:
 *
 * - `"legacy"` — the plain 2025-11-25 `initialize` handshake, byte-identical to
 *   a client without negotiation. **This is the default** per the SDK's
 *   guidance that a debugging tool must not auto-probe (a probe stalls on
 *   silent stdio legacy servers and pollutes recorded transcripts).
 * - `"auto"` — probe `server/discover` at connect and fall back to `initialize`
 *   on any non-modern outcome.
 * - `"modern"` — pin the modern era at exactly `MODERN_PROTOCOL_VERSION`; no
 *   fallback (a non-modern server fails loudly).
 */
export type ServerProtocolEra = "legacy" | "auto" | "modern";

/** The default per-server protocol era when none is configured. */
export const DEFAULT_PROTOCOL_ERA: ServerProtocolEra = "legacy";

/**
 * Per-server modern (2026-07-28) per-request log level (#1629). `logging/setLevel`
 * is gone on the modern era; instead the client opts into logs by stamping
 * `_meta["io.modelcontextprotocol/logLevel"]` on each request. This setting is
 * the level stamped by default on a modern connection — one of the eight logging
 * levels, or `"off"` to not opt in (no server logs). Legacy connections ignore
 * it (they use the session-scoped `logging/setLevel` instead).
 */
export type ModernLogLevel = LoggingLevel | "off";

/**
 * The default modern per-request log level when none is configured. Defaults to
 * opted-in at the most verbose level so a modern connection surfaces server logs
 * out of the box (the Inspector is a debugging tool); set `"off"` per server to
 * opt back out.
 */
export const DEFAULT_MODERN_LOG_LEVEL: ModernLogLevel = "debug";

/** All modern-log-level values, for form options and the runtime guard. */
export const MODERN_LOG_LEVELS: ModernLogLevel[] = [
  "off",
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

/** Runtime guard for the {@link ModernLogLevel} literal (hand-edited files). */
export function isModernLogLevel(value: unknown): value is ModernLogLevel {
  return (
    typeof value === "string" &&
    (MODERN_LOG_LEVELS as string[]).includes(value)
  );
}

/**
 * The modern protocol revision `"modern"` era pins to. The successor to
 * 2025-11-25; the first revision with the per-request-metadata / sessionless
 * model (SEP §7.1).
 */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/**
 * Map a per-server {@link ServerProtocolEra} onto the SDK Client's
 * `versionNegotiation` option. `"modern"` pins {@link MODERN_PROTOCOL_VERSION};
 * `"legacy"`/`"auto"` pass their mode straight through.
 */
export function eraToVersionNegotiation(
  era: ServerProtocolEra,
): VersionNegotiationOptions {
  switch (era) {
    case "auto":
      return { mode: "auto" };
    case "modern":
      return { mode: { pin: MODERN_PROTOCOL_VERSION } };
    case "legacy":
      return { mode: "legacy" };
  }
}

/**
 * Runtime settings for a configured server. A subset of
 * InspectorClientOptions (v1.5) relevant to the settings form:
 * headers, metadata, timeouts, and OAuth credentials.
 */
export interface InspectorServerSettings {
  headers: { key: string; value: string }[];
  metadata: { key: string; value: string }[];
  /**
   * Environment variables for stdio servers, edited as controlled key/value
   * rows (mirrors `headers`). Only meaningful for stdio transports; non-stdio
   * servers keep this an empty list. These do NOT live on disk as a settings
   * field — they round-trip through the SDK config's `env` (the standard
   * mcp.json location). The settings layer mirrors them for the form, and the
   * `/api/servers` PUT route writes an edited list back onto `config.env` when
   * the caller patches settings only. Empty-key rows are dropped on persist.
   */
  env: { key: string; value: string }[];
  /**
   * Working directory for stdio servers (`config.cwd`). Like `env`, this is a
   * mirror of the SDK config field rather than a persisted settings field;
   * empty/unset means "inherit". Only meaningful for stdio transports.
   */
  cwd?: string;
  connectionTimeout: number;
  requestTimeout: number;
  /** TTL (ms) for tasks created via "Run as task". Defaults to 60000. */
  taskTtl: number;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScopes?: string;
  /**
   * SEP-2350 step-up policy for a `403 insufficient_scope` challenge on this
   * server's HTTP transport. Defaults to `reauthorize` when unset.
   */
  oauthOnInsufficientScope?: OnInsufficientScopePolicy;
  /**
   * When true, connect via the configured enterprise IdP (EMA) instead of
   * interactive OAuth to the MCP authorization server. Per-server OAuth
   * fields below are resource AS credentials. (#1509)
   */
  enterpriseManaged?: boolean;
  /**
   * When true, lists auto-refresh on `list_changed` notifications; when
   * false (default), the notification only lights the list-changed indicator
   * and the user pulls the new list via Refresh. (#1402)
   */
  autoRefreshOnListChanged?: boolean;
  /**
   * When true, the tools/resources/prompts lists fetch one page at a time (a
   * manual "Load next page" control) instead of auto-aggregating all pages.
   * Default false. Server-wide; the per-list sidebar toggle edits this. (#1721)
   */
  paginatedLists?: boolean;
  /**
   * Maximum number of HTTP fetch requests retained in the Network log for this
   * server. When exceeded, the oldest entries rotate out (and any deferred
   * response body that arrives after its entry rotated out is dropped — see
   * `FetchRequestLogState`). Concrete value so the form always has something to
   * render; defaults to `DEFAULT_MAX_FETCH_REQUESTS`. `0` means unlimited.
   */
  maxFetchRequests: number;
  /**
   * Roots advertised to the server via the `roots` client capability. Each
   * root carries a required `uri` and an optional `name` (SDK `Root`). The
   * form edits these as controlled rows; empty-uri rows are dropped on
   * persist (see `inspectorSettingsToStoredFields`).
   */
  roots: Root[];
  /**
   * Protocol era to negotiate with this server (orthogonal to the transport
   * `type`). Drives the SDK Client's `versionNegotiation`. Optional so a bare
   * settings node reads back without one; absence means {@link
   * DEFAULT_PROTOCOL_ERA} (`"legacy"`). Persisted on disk as `protocolEra` and
   * omitted when it equals the default, keeping the file diff minimal.
   */
  protocolEra?: ServerProtocolEra;
  /**
   * Modern-era per-request log level stamped by default on this server's
   * connections (#1629). One of the eight logging levels, or `"off"` to not opt
   * in. Absence means {@link DEFAULT_MODERN_LOG_LEVEL} (`"debug"`). Only affects
   * modern (2026-07-28) connections; legacy uses `logging/setLevel`. Persisted
   * on disk as `modernLogLevel` and omitted when it equals the default.
   */
  modernLogLevel?: ModernLogLevel;
  /**
   * Per-extension overrides for which extensions the Inspector advertises to
   * this server in `capabilities.extensions`, keyed by extension id. A present
   * key wins over the registry default in `ADVERTISABLE_EXTENSIONS`; an absent
   * key falls back to it. Toggling an entry is a debugging knob — a server may
   * change tool registration on a client-declared extension. Persisted on disk
   * as `advertisedExtensions` and omitted when empty. (#1739)
   */
  advertisedExtensions?: Record<string, boolean>;
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
   * Optional callback fired asynchronously when a previously tracked
   * fetch's response body has been read. Lets the consumer update the
   * already-dispatched entry without blocking the transport on body
   * reading (critical for SSE responses that include progress events).
   */
  onFetchResponseBody?: (id: string, responseBody: string) => void;

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

  /**
   * When true, wrap HTTP transport fetch with auth-challenge detection so 401/403
   * become {@link AuthChallengeError} before the SDK calls `auth()` on a frozen provider.
   */
  interceptAuthChallenges?: boolean;
}

export interface CreateTransportResult {
  transport: Transport;
}

/**
 * A tool a conforming Streamable HTTP client MUST exclude from `tools/list`
 * because its `x-mcp-header` annotations violate SEP-2243 (the whole tool
 * definition is invalidated). The SDK's `listTools()` drops these silently; the
 * Inspector surfaces them — with the constraint they broke — so a user can see
 * *why* a tool vanished (#1632). Only modern non-stdio connections exclude.
 */
export interface ExcludedTool {
  tool: Tool;
  /** The first violated constraint, from the `x-mcp-header` scan. */
  reason: string;
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
  logger?: InspectorLogger;

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
   * Per-extension overrides for which extensions the Inspector advertises in
   * `capabilities.extensions`, keyed by extension id. A present key wins over
   * the registry default in `ADVERTISABLE_EXTENSIONS`; an absent key falls back
   * to it. Lets a user toggle advertised extensions as a debugging knob —
   * servers legitimately change tool registration on client-declared extensions
   * (#1633). EMA is not configured here (it follows the auth mode). (#1738)
   */
  advertisedExtensions?: Record<string, boolean>;

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
   * Protocol version negotiation for the SDK Client (SEP §7.8 era model).
   * When omitted, the client pins the legacy 2025-11-25 era
   * (`{ mode: "legacy" }`), byte-identical to a client without negotiation.
   * Callers derive this from the per-server {@link ServerProtocolEra} via
   * {@link eraToVersionNegotiation}. (#1626)
   */
  versionNegotiation?: VersionNegotiationOptions;

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
    /** Route to EMA flow when true (resource AS creds in clientId/clientSecret). */
    enterpriseManaged?: boolean;
  };

  /**
   * Global enterprise IdP credentials (from client.json). Used for EMA legs 1–2
   * when {@link oauth.enterpriseManaged} is true on the server.
   */
  enterpriseManagedAuth?: {
    idp: EnterpriseManagedAuthIdpConfig;
  };

  /**
   * Full install-level EMA config from client.json (including when disabled).
   * Used to produce friendly errors when a server expects EMA but IdP is inactive.
   */
  installEnterpriseManagedAuth?: ClientConfig["enterpriseManagedAuth"];

  /**
   * When true, direct transports (TUI/CLI) route MCP 401/403 through
   * `handleAuthChallenge()` via fetch intercept instead of the SDK auth() path.
   * Web remote clients should leave this false (default).
   */
  directAuthRecovery?: boolean;

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
