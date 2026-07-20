import { Client } from "@modelcontextprotocol/client";
import type {
  MCPServerConfig,
  StderrLogEntry,
  ConnectionStatus,
  MessageEntry,
  MessageOrigin,
  FetchRequestEntry,
  FetchRequestEntryBase,
  InspectorServerSettings,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
  AppRendererClient,
  InspectorClientOptions,
  PendingRequestOrigin,
  ResourceSubscriptionStreamState,
} from "./types.js";
// Re-export so v1.5 tests that do `import { InspectorClientOptions } from
// "@inspector/core/mcp/inspectorClient.js"` keep resolving.
export type {
  InspectorClientOptions,
  InspectorClientEnvironment,
  CreateTransport,
  CreateTransportOptions,
  CreateTransportResult,
  AppRendererClient,
} from "./types.js";
import { getServerType as getServerTypeFromConfig } from "./config.js";
import {
  DEFAULT_MODERN_LOG_LEVEL,
  INACTIVE_SUBSCRIPTION_STREAM_STATE,
  isTerminalStatus,
} from "./types.js";
// Fallback client identity, used ONLY when a caller doesn't pass
// `clientIdentity`. Real clients supply their own: the Node clients (CLI, TUI)
// read the single-source version from the root package.json via
// `readInspectorVersion()`, and the web browser — which can't read the
// filesystem — will pass a version sourced from `GET /api/config` (see #1639).
// This stays a neutral placeholder rather than a hardcoded release number that
// would silently drift out of sync with the root package.json version.
const corePackageJson = {
  name: "mcp-inspector",
  version: "0.0.0",
} as const;
import type {
  CreateTransport,
  CreateTransportOptions,
  ServerType,
} from "./types.js";
import {
  MessageTrackingTransport,
  type MessageTrackingCallbacks,
} from "./messageTrackingTransport.js";
import type {
  CallToolRequest,
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
  ServerCapabilities,
  ClientCapabilities,
  Implementation,
  LoggingLevel,
  Tool,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Prompt,
  Root,
  CreateMessageRequest,
  CreateMessageResult,
  CreateTaskResult,
  ElicitRequest,
  ElicitResult,
  ElicitRequestURLParams,
  CallToolResult,
  Task,
  Progress,
  ProgressToken,
  ListToolsRequest,
  ListResourcesRequest,
  ListResourceTemplatesRequest,
  ListPromptsRequest,
  ReadResourceRequest,
  GetPromptRequest,
  CompleteRequest,
  ListRootsRequest,
} from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
import type {
  RequestOptions,
  CacheableRequestOptions,
  CacheMode,
  ProgressCallback,
  VersionNegotiationOptions,
  ProtocolEra,
  DiscoverResult,
  InputRequests,
  InputRequiredOptions,
  StandardSchemaV1,
  McpSubscription,
  SubscriptionFilter,
} from "@modelcontextprotocol/client";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/client";
import {
  isInputRequiredResult,
  withInputRequired,
  LOG_LEVEL_META_KEY,
} from "@modelcontextprotocol/client";
import {
  EmptyResultSchema,
  CallToolResultSchema,
  GetPromptResultSchema,
  ReadResourceResultSchema,
  // Task request schemas — used for `.shape.params` in the 3-arg custom
  // `setRequestHandler` form (tasks/* are excluded from v2's spec-method set).
  ListTasksRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  CancelTaskRequestSchema,
  TaskStatusNotificationSchema,
  // Task result schemas — explicit result schemas for the raw requestor-task
  // requests that replace the removed `client.experimental.tasks.*` helpers.
  CreateTaskResultSchema,
  GetTaskResultSchema,
  CancelTaskResultSchema,
  ListTasksResultSchema,
  // List result schemas — used by the single-page list methods below. SDK v2's
  // high-level `client.listTools()` etc. auto-aggregate ALL pages (returning
  // `nextCursor: undefined`), which defeats the Inspector's pagination-debugging
  // purpose. Drop to raw `client.request` with these explicit schemas so each
  // call fetches exactly one page and surfaces the server's `nextCursor`.
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListPromptsResultSchema,
} from "@modelcontextprotocol/core";
import type { ClientResult } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { validateToolOutput } from "./toolOutputValidation.js";
import { TasksListChangedNotificationSchema } from "./taskNotificationSchemas.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import { UriTemplate } from "@modelcontextprotocol/client";
import {
  InspectorClientEventTarget,
  type TaskWithOptionalCreatedAt,
} from "./inspectorClientEventTarget.js";
import { SamplingCreateMessage } from "./samplingCreateMessage.js";
import { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import {
  getUrlElicitationsFromError,
  UrlElicitationLoopError,
} from "./urlElicitation.js";
import { ToolCallCancelledError } from "./toolCallCancelledError.js";
import type {
  OAuthConnectionState,
  OAuthFlowState,
  OAuthStep,
} from "../auth/types.js";
import {
  AuthRecoveryRequiredError,
  EMA_STEP_UP_PENDING_URL,
  isAuthChallengeError,
  isConnectAuthRecoveryError,
  parseAuthChallengeFromError,
  type AuthChallenge,
  type AuthChallengeOutcome,
  type HandleAuthChallengeOptions,
} from "../auth/challenge.js";
import type { OAuthTokens } from "@modelcontextprotocol/client";
import { silentLogger, type InspectorLogger } from "../logging/logger.js";
import { createFetchTracker } from "./fetchTracking.js";
import { OAuthManager, type OAuthManagerConfig } from "./oauthManager.js";
import { RemoteClientTransport } from "./remote/remoteClientTransport.js";

/** Internal record for a receiver task (server polls us for status/result). */
interface ReceiverTaskRecord {
  task: Task;
  payloadPromise: Promise<ClientResult>;
  resolvePayload: (payload: ClientResult) => void;
  rejectPayload: (reason?: unknown) => void;
  cleanupTimeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Cap on how many times a single `callTool` will surface URL elicitations and
 * retry after a `-32042` (UrlElicitationRequired) response. A spec-compliant
 * flow resolves in one round; the bound only guards against a server that keeps
 * returning the error.
 */
const MAX_URL_ELICITATION_RETRIES = 5;

/**
 * Error used to reject a pending sampling/elicitation request when the tool
 * call driving its MRTR round is aborted (e.g. the user hits Cancel). Its
 * message is not surfaced directly — `callToolWithRetries` maps the abort to a
 * {@link ToolCallCancelledError} by inspecting the controller's reason — but a
 * concrete error is needed to reject the awaiting driver promise.
 */
function createPendingAbortError(): Error {
  return new Error("Pending request aborted");
}

/**
 * The abort reason used by `cancelToolCall()`. It rides along on the
 * `notifications/cancelled` sent to the server and lets `callToolWithRetries`
 * tell a deliberate user cancel apart from other aborts of the same controller
 * (e.g. a disconnect, which aborts with a different reason and should surface as
 * an ordinary error, not a "Tool call cancelled" — #1458).
 */
const TOOL_CALL_CANCELLED_REASON = "Tool call cancelled by user";

/**
 * Fallback poll cadence (ms) for {@link InspectorClient.pollTaskToolCall} when a
 * task does not advertise its own `pollInterval`. Replaces the cadence the
 * removed SDK `experimental.tasks.callToolStream` helper managed internally.
 */
const DEFAULT_TASK_POLL_INTERVAL_MS = 500;

/**
 * Extract the method literal from an MCP notification Zod schema (e.g.
 * `ToolListChangedNotificationSchema`), or `undefined` if the shape isn't
 * recognized. Used by the App-renderer client proxy to translate the SDK-v1
 * schema-first `setNotificationHandler` API — which `@modelcontextprotocol/ext-apps`
 * still uses — into SDK v2's method-string form. Reads the `method` literal off
 * the notification schema's `shape` (the shape both the v1 SDK and v2 core
 * schemas expose).
 */
function notificationMethodFromSchema(schema: unknown): string | undefined {
  if (schema !== null && typeof schema === "object") {
    const literal = (schema as { shape?: { method?: { value?: unknown } } })
      .shape?.method?.value;
    if (typeof literal === "string") return literal;
  }
  return undefined;
}

/**
 * The descriptor for a single tools/call, threaded through the retry loop and
 * each attempt. Bundled into one object so `callToolWithRetries`/`attemptToolCall`
 * don't take a long, transposition-prone positional parameter list.
 */
interface ToolCallRequest {
  tool: Tool;
  args: Record<string, JsonValue>;
  generalMetadata?: Record<string, string>;
  toolSpecificMetadata?: Record<string, string>;
  taskOptions?: { ttl?: number };
  options?: { skipOutputValidation?: boolean };
}

// Backoff for reconnect-by-re-listen on the modern `subscriptions/listen` stream
// (#1630). A `"remote"` drop schedules a re-listen after a capped exponential
// delay so a flapping server can't spin a tight zero-delay reconnect loop; after
// a run of rapid drops we give up (mark the stream ended) rather than reconnect
// forever. A drop that lands more than the reset window after the previous one
// is treated as isolated and starts the backoff over.
const MODERN_RECONNECT_BASE_MS = 500;
const MODERN_RECONNECT_MAX_MS = 15_000;
const MODERN_RECONNECT_MAX_ATTEMPTS = 8;
const MODERN_RECONNECT_RESET_MS = 30_000;

/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - EventTarget interface for React hooks (cross-platform: works in browser and Node.js)
 * - Access to client functionality (prompts, resources, tools)
 */
export class InspectorClient extends InspectorClientEventTarget {
  /**
   * Upper bound on MRTR (`input_required`) rounds for a single logical request
   * before {@link requestWithInputRequired} gives up. We drive the loop
   * ourselves (`inputRequired: { autoFulfill: false }`), so this is the manual
   * counterpart to the SDK auto-driver's default `maxRounds` (10) and guards
   * against a server that keeps returning `input_required` forever.
   */
  private static readonly MRTR_MAX_ROUNDS = 10;
  private client: Client | null = null;
  private appRendererClientProxy: AppRendererClient | null = null;
  // Lazily-built validator used only on the skipOutputValidation path to detect
  // (non-fatally) when a delivered result violates the tool's outputSchema.
  private outputValidator: AjvJsonSchemaValidator | null = null;
  private transport: Transport | MessageTrackingTransport | null = null;
  private baseTransport: Transport | null = null;
  /** True when the cached transport was built with an OAuth authProvider attached. */
  private transportHasAuthProvider = false;
  /** Dedupes concurrent ambient auth challenges (reason + scopes). */
  private ambientAuthChallengeInFlight = new Map<string, Promise<void>>();
  private pipeStderr: boolean;
  private initialLoggingLevel?: LoggingLevel;
  // Modern-era per-request log level (#1629). On 2026-07-28 servers
  // `logging/setLevel` is gone; the client opts into logs per request via the
  // `io.modelcontextprotocol/logLevel` `_meta` key, and the SDK does not attach
  // it automatically. When set, `mergeMeta` stamps this level on every outgoing
  // request so server logs arrive on each request's stream; `undefined` means
  // "don't opt in" (logs stay silently absent). Only honored on the modern era.
  private modernLogLevel?: LoggingLevel;
  private sample: boolean;
  private elicit: boolean | { form?: boolean; url?: boolean };
  private progress: boolean;
  private resetTimeoutOnProgress: boolean;
  private requestTimeout: number | undefined;
  private defaultMetadata: Record<string, string> | undefined;
  private serverSettings: InspectorServerSettings | undefined;
  private versionNegotiation: VersionNegotiationOptions;
  private status: ConnectionStatus = "disconnected";
  // True only while an explicit disconnect() owns the teardown. close() can
  // trigger the transport's onclose synchronously, so this lets onclose defer
  // the canonical status set + `disconnect` event to disconnect() and fire it
  // exactly once (see onclose / disconnect()).
  private disconnecting = false;
  // Server data (resources, resourceTemplates, prompts are in state managers)
  private capabilities?: ServerCapabilities;
  private serverInfo?: Implementation;
  private instructions?: string;
  private protocolVersion?: string;
  // Era model (SEP §7.8). Populated after connect from the SDK Client's
  // negotiation accessors. `protocolEra` is the negotiated era ("legacy" |
  // "modern"); `discoverResult` is the `server/discover` payload on a
  // probed/pinned connection (undefined on a plain legacy connect).
  private protocolEra?: ProtocolEra;
  private discoverResult?: DiscoverResult;
  // The capabilities this Inspector client advertises to the server during the
  // initialize handshake. Built once in setupClient() and snapshotted here so
  // UI surfaces (Server Info modal) can display them without poking at the
  // SDK Client's private state.
  private clientCapabilities: ClientCapabilities = {};
  // Sampling requests
  private pendingSamples: SamplingCreateMessage[] = [];
  // Elicitation requests
  private pendingElicitations: ElicitationCreateMessage[] = [];
  // Roots (undefined means roots capability not enabled, empty array means enabled but no roots)
  private roots: Root[] | undefined;
  // Content cache
  // ListChanged notification configuration
  private listChangedNotifications: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
  // Resource subscriptions. The set of subscribed URIs is the era-agnostic
  // source of truth for the UI (the `resourceSubscriptionsChange` list). How a
  // subscription reaches the wire forks by era: legacy sends one
  // `resources/subscribe` per URI; modern (2026-07-28) has no such method — all
  // subscriptions are a filter over one long-lived `subscriptions/listen` stream
  // (#1630, SEP §7.4).
  private subscribedResources: Set<string> = new Set();
  // Modern-era listen stream backing the subscriptions above. A single
  // `McpSubscription` whose filter's `resourceSubscriptions` mirrors
  // `subscribedResources`; mutating the set re-lists (close old, open new), and
  // an unexpected `"remote"` close re-lists (reconnect-by-re-listen — the stream
  // is not resumable). `null` when no URI is subscribed or on the legacy era.
  private modernSubscription: McpSubscription | null = null;
  // Monotonic guard so a stale re-list/reconnect (whose `listen()` or `closed`
  // resolves after a newer refresh already started) can detect it lost the race
  // and bail without clobbering the current stream.
  private modernListenGeneration = 0;
  // Last dispatched modern stream state; `active: false` on the legacy era.
  private modernStreamState: ResourceSubscriptionStreamState =
    INACTIVE_SUBSCRIPTION_STREAM_STATE;
  // Reconnect-by-re-listen backoff state (#1630): consecutive rapid reconnect
  // attempts, the timestamp of the last one (to reset the run once drops space
  // out), and the pending re-listen timer.
  private modernReconnectAttempts = 0;
  private modernLastReconnectMs = 0;
  private modernReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // Task ids the user explicitly cancelled. A cancel makes the in-flight
  // `callToolStream` reject with a generic -32603 error, which the stream's
  // error path would otherwise report as a *failed* task — flashing "failed"
  // in the UI until a refresh fetches the server's true "cancelled" state.
  // Recording the id lets that path label the terminal task "cancelled"
  // instead, so it lands in the right state immediately (#1455). Cleared on
  // disconnect.
  private cancelledTaskIds: Set<string> = new Set();
  // Abort controller for the in-flight ordinary (non-task) tool call. Aborting
  // it makes the SDK send a `notifications/cancelled` for that request (the MCP
  // cancellation flow) and reject the pending call, which `callTool` surfaces as
  // a `ToolCallCancelledError`. Undefined when no ordinary call is in flight.
  // Task-augmented calls have a server-side task and are cancelled via
  // `cancelRequestorTask` instead, so they don't use this (#1458).
  private activeToolCallAbortController?: AbortController;
  // Receiver tasks (server-initiated: server sends createMessage/elicit with params.task, server polls us)
  private receiverTasks: boolean;
  private receiverTaskTtlMs: number | (() => number);
  private receiverTaskRecords: Map<string, ReceiverTaskRecord> = new Map();
  // OAuth support (config owned by oauthManager; client delegates and uses !!oauthManager for "is OAuth configured")
  private oauthManager: OAuthManager | null = null;
  private logger: InspectorLogger;
  private transportClientFactory: CreateTransport;
  private fetchFn?: typeof fetch;
  private effectiveAuthFetch: typeof fetch;
  // Session ID (for OAuth state and saveSession event; persistence is in FetchRequestLogState)
  private sessionId?: string;
  private transportConfig: MCPServerConfig;
  /** null until first transport is built; then true for in-process OAuth runners. */
  private directAuthRecoveryActive: boolean | null = null;
  /**
   * Opt-in from {@link InspectorClientOptions.directAuthRecovery}: when true and
   * the live transport is direct (not {@link RemoteClientTransport}), RPCs use
   * fetch intercept + {@link withDirectAuthRecovery}.
   */
  private readonly directAuthRecovery: boolean;

  constructor(
    transportConfig: MCPServerConfig,
    options: InspectorClientOptions,
  ) {
    super();
    this.transportConfig = transportConfig;
    // Extract environment components
    this.transportClientFactory = options.environment.transport;
    this.fetchFn = options.environment.fetch;
    this.logger = options.environment.logger ?? silentLogger;

    // Initialize content cache
    this.pipeStderr = options.pipeStderr ?? false;
    this.initialLoggingLevel = options.initialLoggingLevel;
    this.sample = options.sample ?? true;
    this.elicit = options.elicit ?? true;
    this.receiverTasks = options.receiverTasks ?? false;
    this.receiverTaskTtlMs = options.receiverTaskTtlMs ?? 60_000;
    this.progress = options.progress ?? true;
    this.resetTimeoutOnProgress = options.resetTimeoutOnProgress ?? true;
    this.requestTimeout = options.timeout;
    this.defaultMetadata =
      options.defaultMetadata && Object.keys(options.defaultMetadata).length > 0
        ? options.defaultMetadata
        : undefined;
    this.serverSettings = options.serverSettings;
    // Seed the modern per-request log level from the server setting (#1629), so
    // a modern connection opts into logs by default without the user touching
    // the Logs-tab control. Absence means DEFAULT_MODERN_LOG_LEVEL; `"off"`
    // clears the opt-in. Only stamped on modern connections (see mergeMeta) —
    // legacy uses `logging/setLevel`.
    const settingLevel =
      options.serverSettings?.modernLogLevel ?? DEFAULT_MODERN_LOG_LEVEL;
    this.modernLogLevel = settingLevel === "off" ? undefined : settingLevel;
    // Default to the legacy 2025-11-25 era when the caller doesn't pin one, per
    // the SDK guidance that a debugging tool must not auto-probe (#1626).
    this.versionNegotiation = options.versionNegotiation ?? { mode: "legacy" };
    this.directAuthRecovery = options.directAuthRecovery ?? false;
    // Only set roots if explicitly provided (even if empty array) - this enables roots capability
    this.roots = options.roots;
    // Initialize listChangedNotifications config (default: all enabled)
    this.listChangedNotifications = {
      tools: options.listChangedNotifications?.tools ?? true,
      resources: options.listChangedNotifications?.resources ?? true,
      prompts: options.listChangedNotifications?.prompts ?? true,
    };

    // Effective auth fetch: base fetch + tracking with category 'auth'
    this.effectiveAuthFetch = this.buildEffectiveAuthFetch();

    this.sessionId = options.sessionId;

    // Merge OAuth config with environment components; create internal OAuth manager (owns config)
    if (options.oauth || options.environment.oauth) {
      const oauthConfig: OAuthManagerConfig = {
        // Environment components (storage, navigation, redirectUrlProvider)
        ...options.environment.oauth,
        // Config values (clientId, clientSecret, clientMetadataUrl, scope)
        ...options.oauth,
      };
      this.oauthManager = new OAuthManager({
        getServerUrl: () => this.getServerUrl(),
        effectiveAuthFetch: this.effectiveAuthFetch,
        getEventTarget: () => this,
        onBeforeOAuthRedirect: (sessionId: string) => {
          this.sessionId = sessionId;
          this.saveSession();
          return Promise.resolve();
        },
        initialConfig: oauthConfig,
        enterpriseManagedAuth: options.enterpriseManagedAuth,
        installEnterpriseManagedAuth: options.installEnterpriseManagedAuth,
        dispatchOAuthComplete: (detail) =>
          this.dispatchTypedEvent("oauthComplete", detail),
        dispatchOAuthAuthorizationRequired: (detail) =>
          this.dispatchTypedEvent("oauthAuthorizationRequired", detail),
        dispatchOAuthError: (detail) =>
          this.dispatchTypedEvent("oauthError", detail),
      });
    }

    // Transport is created in connect() (single place for create / wrap / attach).

    // Build client capabilities
    const clientOptions: {
      capabilities?: ClientCapabilities;
      versionNegotiation?: VersionNegotiationOptions;
      inputRequired?: InputRequiredOptions;
    } = {
      // Per-server protocol era (SEP §7.8), threaded from config via
      // `eraToVersionNegotiation` and defaulted to `{ mode: "legacy" }` in the
      // constructor. "legacy" keeps the wire byte-identical to a 2025 client;
      // "auto"/"modern" opt into 2026-era negotiation (#1626).
      versionNegotiation: this.versionNegotiation,
      // Drive MRTR (SEP-2322) manually instead of letting the SDK auto-fulfil
      // and hide the retry loop (#1704). Unconditional and safe on every era:
      // legacy servers never return `input_required`, so this is a no-op there;
      // on modern connections the three multi-round-trip methods opt in via
      // `allowInputRequired` in `requestWithInputRequired`, and no other method
      // can receive an `input_required` result. The negotiated era is unknown
      // at construction time, so gating here is impossible anyway.
      inputRequired: { autoFulfill: false },
    };
    const capabilities: ClientCapabilities = {};
    if (this.sample) {
      capabilities.sampling = {};
    }
    // Handle elicitation capability with mode support
    if (this.elicit) {
      const elicitationCap: NonNullable<ClientCapabilities["elicitation"]> = {};

      if (this.elicit === true) {
        // Backward compatibility: `elicit: true` means form support only
        elicitationCap.form = {};
      } else {
        // Explicit mode configuration
        if (this.elicit.form) {
          elicitationCap.form = {};
        }
        if (this.elicit.url) {
          elicitationCap.url = {};
        }
      }

      // Only add elicitation capability if at least one mode is enabled
      if (Object.keys(elicitationCap).length > 0) {
        capabilities.elicitation = elicitationCap;
      }
    }
    // Advertise roots capability if roots option was provided (even if empty array)
    if (this.roots !== undefined) {
      capabilities.roots = { listChanged: true };
    }
    // Receiver tasks: advertise so server can send task-augmented createMessage/elicit and poll us
    if (this.receiverTasks) {
      capabilities.tasks = {
        list: {},
        cancel: {},
        requests: {
          sampling: { createMessage: {} },
          elicitation: { create: {} },
        },
      };
    }
    if (options.oauth?.enterpriseManaged) {
      capabilities.extensions = {
        "io.modelcontextprotocol/enterprise-managed-authorization": {},
      };
    }
    if (Object.keys(capabilities).length > 0) {
      clientOptions.capabilities = capabilities;
    }
    this.clientCapabilities = capabilities;

    this.appRendererClientProxy = null;
    this.client = new Client(
      options.clientIdentity ?? {
        name: corePackageJson.name.split("/")[1] ?? corePackageJson.name,
        version: corePackageJson.version,
      },
      Object.keys(clientOptions).length > 0 ? clientOptions : undefined,
    );
  }

  private buildEffectiveAuthFetch(): typeof fetch {
    const base = this.fetchFn ?? fetch;
    // Capture auth response bodies (OAuth discovery, DCR, token exchange) so
    // they're inspectable in the Network tab. Token-exchange responses carry
    // `access_token` / `refresh_token`; the Network UI masks those (and other
    // known secret fields) behind a click-to-reveal toggle so they aren't
    // surfaced at a glance during a screen-share. Masking is a display
    // concern, kept in the UI layer rather than mutating the captured entry,
    // so the raw body stays available for the user who explicitly reveals it.
    return createFetchTracker(base, {
      trackRequest: (entry) =>
        this.dispatchFetchRequest({ ...entry, category: "auth" }),
      updateResponseBody: (id, body) =>
        this.dispatchFetchRequestBodyUpdate(id, body),
    });
  }

  private createMessageTrackingCallbacks(): MessageTrackingCallbacks {
    return {
      trackRequest: (message: JSONRPCRequest, origin: MessageOrigin) => {
        const entry: MessageEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          direction: "request",
          origin,
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackResponse: (
        message: JSONRPCResultResponse | JSONRPCErrorResponse,
        origin: MessageOrigin,
      ) => {
        const entry: MessageEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          direction: "response",
          origin,
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackNotification: (
        message: JSONRPCNotification,
        origin: MessageOrigin,
      ) => {
        const entry: MessageEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          direction: "notification",
          origin,
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
    };
  }

  private attachTransportListeners(baseTransport: Transport): void {
    baseTransport.onclose = () => {
      // An explicit disconnect() owns the teardown and will set the canonical
      // status + fire `disconnect` itself. Defer to it so the event fires
      // exactly once whether or not the SDK calls onclose synchronously inside
      // close() — without this, an onclose that runs while status is held at
      // "error" would fire `disconnect`, then disconnect()'s own guard would
      // fire it again (#1490 re-review).
      if (this.disconnecting) return;
      // Already fully torn down — nothing to do (avoids a duplicate
      // `disconnect` event after an explicit disconnect()).
      if (this.status === "disconnected") return;
      // Do NOT let a trailing `onclose` downgrade a crash's "error" status to
      // "disconnected". On a real mid-session crash many SDK transports fire
      // BOTH `onclose` and `onerror` in a transport-dependent order; with the
      // old `!== "disconnected"` guard the final status differed by ordering
      // ("disconnected" when onerror landed first, "error" when onclose did).
      // Treating "error" as terminal here makes "error" the canonical resting
      // status in both orderings (#1490). We still emit the `disconnect` event
      // below so session-teardown consumers fire identically either way; only
      // the persistent status value is held at "error".
      if (this.status !== "error") {
        this.status = "disconnected";
        this.dispatchTypedEvent("statusChange", this.status);
      }
      this.dispatchTypedEvent("disconnect");
    };
    baseTransport.onerror = (error: Error) => {
      // Suppress ONLY the handshake case. These listeners are attached before
      // the handshake runs (see connect()), so an SDK transport that reports a
      // connect-time error via `onerror` — in addition to rejecting connect()
      // — would otherwise dispatch the `error` event for a failure the awaited
      // connect() rejection already surfaces, double-reporting it. "connecting"
      // is precisely that state: the only one with a pending awaited connect()
      // that will reject.
      //
      // We deliberately do NOT guard on `!== "connected"`: on a real
      // mid-session crash many transports fire BOTH `onclose` and `onerror`,
      // and the order is transport-dependent. If `onclose` lands first it flips
      // status to "disconnected", so a "connected"-only guard would swallow the
      // reason that the trailing `onerror` carries (its sole surface). Firing
      // from any non-"connecting" state captures the reason regardless of
      // ordering.
      if (this.status === "connecting") return;
      this.status = "error";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("error", error);
    };
  }

  /**
   * Build RequestOptions for SDK client calls (timeout, resetTimeoutOnProgress, onprogress).
   * When timeout is unset, SDK uses DEFAULT_REQUEST_TIMEOUT_MSEC (60s).
   *
   * When progress is enabled, we pass a per-request onprogress so the SDK routes progress and
   * runs timeout reset. The SDK injects progressToken: messageId; we do not expose the caller's
   * token to the server. We collect it from metadata and inject it into dispatched progressNotification
   * events only, so listeners can correlate progress with the request that triggered it.
   *
   * @param progressToken Optional token from request metadata; injected into progressNotification
   * events when provided (not sent to server).
   */
  /**
   * Merge per-call metadata with this client's `defaultMetadata` (from
   * `InspectorClientOptions.defaultMetadata`, set from
   * `InspectorServerSettings.metadata`). Call-time keys override defaults.
   * Returns `undefined` when the combined map is empty so callers can skip
   * injecting an empty `_meta` field.
   */
  private mergeMeta(
    callMetadata?: Record<string, string>,
  ): Record<string, string> | undefined {
    const defaults = this.defaultMetadata;
    // Modern-era per-request log level (#1629): stamp the opt-in `_meta` key on
    // every request so the server emits `notifications/message` on this
    // request's stream. Gated on the negotiated era — legacy servers use
    // `logging/setLevel` instead, so we never stamp it there. Placed before the
    // call-time keys so an explicit per-call `logLevel` (if ever passed) wins.
    const logMeta =
      this.protocolEra === "modern" && this.modernLogLevel
        ? { [LOG_LEVEL_META_KEY]: this.modernLogLevel }
        : undefined;
    const merged = {
      ...(defaults ?? {}),
      ...(logMeta ?? {}),
      ...(callMetadata ?? {}),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private getRequestOptions(
    progressToken?: ProgressToken,
    signal?: AbortSignal,
  ): RequestOptions {
    const opts: RequestOptions = {
      resetTimeoutOnProgress: this.resetTimeoutOnProgress,
    };
    if (this.requestTimeout !== undefined) {
      opts.timeout = this.requestTimeout;
    }
    // When provided, aborting this signal makes the SDK send a
    // `notifications/cancelled` for the request and reject it (#1458).
    if (signal) {
      opts.signal = signal;
    }
    if (this.progress) {
      const token = progressToken;
      const onprogress: ProgressCallback = (progress: Progress) => {
        const payload: Progress & { progressToken?: ProgressToken } = {
          ...progress,
          ...(token != null && { progressToken: token }),
        };
        this.dispatchTypedEvent("progressNotification", payload);
      };
      opts.onprogress = onprogress;
    }
    return opts;
  }

  /**
   * {@link getRequestOptions} plus the per-call `cacheMode` for the SDK's
   * cacheable verbs (the high-level `client.listTools()` / `listPrompts()` /
   * `listResources()` / `listResourceTemplates()` used by the `listAll*`
   * aggregate methods below). `cacheMode` is only honored by those wrappers —
   * the single-page `client.request` path ignores it — so it lives here rather
   * than in `getRequestOptions`. Omitted when unset so the SDK default
   * (`'use'`) applies.
   */
  private getCacheableRequestOptions(
    cacheMode?: CacheMode,
  ): CacheableRequestOptions {
    const opts: CacheableRequestOptions = this.getRequestOptions();
    if (cacheMode !== undefined) {
      opts.cacheMode = cacheMode;
    }
    return opts;
  }

  /**
   * Build the `params` for the aggregate `listAll*` verbs: merge call metadata
   * with `defaultMetadata` and wrap as `{ _meta }`, or `undefined` when empty
   * (so the SDK skips an empty `_meta`). Shared by all four `listAll*` methods
   * so the merge/omit branch is defined once.
   */
  private aggregateListParams(
    metadata?: Record<string, string>,
  ): { _meta: Record<string, string> } | undefined {
    const effectiveMeta = this.mergeMeta(metadata);
    return effectiveMeta ? { _meta: effectiveMeta } : undefined;
  }

  private isHttpOAuthConfig(): boolean {
    const serverType = getServerTypeFromConfig(this.transportConfig);
    return (
      (serverType === "sse" || serverType === "streamable-http") &&
      !!this.oauthManager
    );
  }

  /**
   * True when task status is completed, failed, or cancelled.
   * We use this private helper instead of the SDK's experimental isTerminal()
   * to avoid depending on experimental API and to get a type predicate so
   * TypeScript narrows status to "completed" | "failed" | "cancelled" after the check.
   */
  private static isTerminalTaskStatus(
    status: Task["status"],
  ): status is "completed" | "failed" | "cancelled" {
    return (
      status === "completed" || status === "failed" || status === "cancelled"
    );
  }

  /**
   * Route a receiver (server-initiated) task-augmented `sampling/createMessage`
   * or `elicitation/create` response around the v2 Client's result validation.
   *
   * SDK v2's `Client` wraps every spec request handler (`_wrapHandler`) to
   * validate the result it returns — for sampling/elicitation it checks the
   * value against `CreateMessageResult` / `ElicitResult` and rejects anything
   * else with a `-32602`. The 2025-11-25 task flow answers a task-augmented
   * request with a `CreateTaskResult` (`{ task }`), which that validation
   * rejects — breaking server-initiated tasks that worked on the legacy client.
   *
   * There is no public seam to opt a handler out of result validation, so we
   * swap the wrapped entry in the Protocol's private `_requestHandlers` map for
   * one that dispatches the task-augmented branch straight through the raw
   * handler (whose `{ task }` return then rides the legacy codec's pass-through
   * `encodeResult` to the wire), while ordinary (non-task) requests keep the
   * validating path. Mirrors the bypass a legacy server needs to emit `{ task }`.
   * Delete once the SDK models task-augmented results natively (see #1624 stack).
   */
  private installReceiverTaskResponseBypass(
    method: "sampling/createMessage" | "elicitation/create",
    rawHandler: (
      request: CreateMessageRequest & ElicitRequest,
    ) => Promise<CreateMessageResult> | Promise<ElicitResult>,
  ): void {
    if (!this.client) return;
    // SDK gap: `Client` exposes no public way to (a) read a registered request
    // handler or (b) opt one out of the result validation its `_wrapHandler`
    // installs, so we reach the private `_requestHandlers` map through a
    // narrowed cast. A public "register a raw/unvalidated handler" API — or a
    // handler-result type that includes `CreateTaskResult` — would remove both
    // this cast and the ones on the sampling/elicit returns above.
    const internal = this.client as unknown as {
      _requestHandlers: Map<
        string,
        (request: unknown, ctx: unknown) => unknown
      >;
    };
    const validating = internal._requestHandlers.get(method);
    if (!validating) return;
    internal._requestHandlers.set(method, (request, ctx) => {
      const task = (request as { params?: { task?: unknown } })?.params?.task;
      if (this.receiverTasks && task != null) {
        return rawHandler(request as CreateMessageRequest & ElicitRequest);
      }
      return validating(request, ctx);
    });
  }

  private createReceiverTask(opts: {
    ttl?: number;
    initialStatus: Task["status"];
    statusMessage?: string;
    pollInterval?: number;
  }): ReceiverTaskRecord {
    const taskId = crypto.randomUUID();
    const ttlMs =
      opts.ttl ??
      (typeof this.receiverTaskTtlMs === "function"
        ? this.receiverTaskTtlMs()
        : this.receiverTaskTtlMs);
    const now = new Date().toISOString();
    const task: Task = {
      taskId,
      status: opts.initialStatus,
      ttl: ttlMs,
      createdAt: now,
      lastUpdatedAt: now,
      ...(opts.pollInterval != null && { pollInterval: opts.pollInterval }),
      ...(opts.statusMessage != null && { statusMessage: opts.statusMessage }),
    };
    let resolvePayload!: (payload: ClientResult) => void;
    let rejectPayload!: (reason?: unknown) => void;
    const payloadPromise = new Promise<ClientResult>((resolve, reject) => {
      resolvePayload = resolve;
      rejectPayload = reject;
    });
    const record: ReceiverTaskRecord = {
      task,
      payloadPromise,
      resolvePayload,
      rejectPayload,
    };
    record.cleanupTimeoutId = setTimeout(() => {
      record.cleanupTimeoutId = undefined;
      this.receiverTaskRecords.delete(taskId);
    }, ttlMs);
    this.receiverTaskRecords.set(taskId, record);
    return record;
  }

  private emitReceiverTaskStatus(task: Task): void {
    if (!this.client) return;
    try {
      const notification = TaskStatusNotificationSchema.parse({
        method: "notifications/tasks/status" as const,
        params: task,
      });
      this.client.notification(notification).catch((err) => {
        this.logger.warn(
          { err, taskId: task.taskId },
          "receiver task status notification failed",
        );
      });
    } catch (err) {
      this.logger.warn(
        { err, taskId: task.taskId },
        "receiver task status notification failed",
      );
    }
  }

  private upsertReceiverTask(updatedTask: Task): void {
    const record = this.receiverTaskRecords.get(updatedTask.taskId);
    if (record) {
      record.task = updatedTask;
      this.emitReceiverTaskStatus(updatedTask);
    }
  }

  private getReceiverTask(taskId: string): ReceiverTaskRecord | undefined {
    return this.receiverTaskRecords.get(taskId);
  }

  private listReceiverTasks(): Task[] {
    return Array.from(this.receiverTaskRecords.values()).map((r) => r.task);
  }

  private async getReceiverTaskPayload(taskId: string): Promise<ClientResult> {
    const record = this.receiverTaskRecords.get(taskId);
    if (!record) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown taskId: ${taskId}`,
      );
    }
    return record.payloadPromise;
  }

  private cancelReceiverTask(taskId: string): Task {
    const record = this.receiverTaskRecords.get(taskId);
    if (!record) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown taskId: ${taskId}`,
      );
    }
    if (InspectorClient.isTerminalTaskStatus(record.task.status)) {
      return record.task;
    }
    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...record.task,
      status: "cancelled",
      lastUpdatedAt: now,
    };
    record.task = updatedTask;
    record.rejectPayload(new Error("Task cancelled"));
    if (record.cleanupTimeoutId != null) {
      clearTimeout(record.cleanupTimeoutId);
      record.cleanupTimeoutId = undefined;
    }
    this.emitReceiverTaskStatus(updatedTask);
    return updatedTask;
  }

  /**
   * Drop the cached MCP transport without a full disconnect() teardown.
   * Used when a pre-auth connect failed or tokens arrived after an unauthenticated
   * transport was created, so the next connect() can attach authProvider.
   */
  private async dropCachedTransport(): Promise<void> {
    if (!this.baseTransport && !this.transport) {
      this.transportHasAuthProvider = false;
      return;
    }
    try {
      await this.client?.close();
    } catch {
      // Ignore errors on close
    }
    this.baseTransport = null;
    this.transport = null;
    this.transportHasAuthProvider = false;
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    if (this.status === "connected") {
      return;
    }

    const oauthManager = this.oauthManager;
    if (
      this.baseTransport &&
      this.isHttpOAuthConfig() &&
      oauthManager &&
      !this.transportHasAuthProvider &&
      !oauthManager.isEnterpriseManaged() &&
      (await oauthManager.isOAuthAuthorized())
    ) {
      await this.dropCachedTransport();
    }

    // Create transport (single place for create / wrap / attach).
    if (!this.baseTransport) {
      const transportOptions: CreateTransportOptions = {
        fetchFn: this.fetchFn,
        pipeStderr: this.pipeStderr,
        onStderr: (entry: StderrLogEntry) => {
          this.dispatchStderrLog(entry);
        },
        onFetchRequest: (entry: FetchRequestEntryBase) => {
          this.dispatchFetchRequest({ ...entry, category: "transport" });
        },
        onFetchResponseBody: (id: string, body: string) => {
          this.dispatchFetchRequestBodyUpdate(id, body);
        },
        ...(this.serverSettings && { settings: this.serverSettings }),
      };
      if (this.isHttpOAuthConfig() && oauthManager) {
        if (oauthManager.isEnterpriseManaged()) {
          await oauthManager.trySilentEnterpriseManagedAuth();
          const provider = await oauthManager.createOAuthProviderForTransport();
          const tokens = await provider.tokens();
          if (!tokens?.access_token) {
            const err = new Error(
              "Unauthorized: EMA resource access token unavailable",
            ) as Error & { status?: number; code?: number };
            err.status = 401;
            err.code = 401;
            throw err;
          }
          transportOptions.authProvider = provider;
        } else if (await oauthManager.isOAuthAuthorized()) {
          // Without stored tokens, omit authProvider so connect() surfaces a plain
          // 401 instead of the SDK opening a browser before the app callback
          // server is listening (TUI/CLI run authenticate() explicitly).
          transportOptions.authProvider =
            await oauthManager.createOAuthProviderForTransport();
        }
      }
      if (
        this.directAuthRecovery &&
        this.directAuthRecoveryActive !== false &&
        this.isHttpOAuthConfig() &&
        oauthManager &&
        transportOptions.authProvider
      ) {
        transportOptions.interceptAuthChallenges = true;
      }
      this.transportHasAuthProvider = !!transportOptions.authProvider;
      const { transport: baseTransport } = this.transportClientFactory(
        this.transportConfig,
        transportOptions,
      );
      this.baseTransport = baseTransport;
      if (this.directAuthRecovery) {
        this.directAuthRecoveryActive = !(
          baseTransport instanceof RemoteClientTransport
        );
      }
      if (
        baseTransport instanceof RemoteClientTransport &&
        oauthManager &&
        this.isHttpOAuthConfig()
      ) {
        baseTransport.setAuthRecovery({
          handleAuthChallenge: (challenge, options) =>
            oauthManager.handleAuthChallenge(challenge, options),
          pushAuthState: () => this.pushRemoteAuthState(),
        });
        baseTransport.setOnAuthChallenge((challenge) => {
          void this.handleAmbientAuthChallenge(challenge);
        });
      }
      const messageTracking = this.createMessageTrackingCallbacks();
      this.transport = new MessageTrackingTransport(
        baseTransport,
        messageTracking,
      );
      this.attachTransportListeners(this.baseTransport);
    }

    if (!this.transport) {
      throw new Error("Transport not initialized");
    }

    try {
      this.status = "connecting";
      this.dispatchTypedEvent("statusChange", this.status);

      // Optional connect-time timeout from per-server settings. The MCP SDK
      // has no connect-time timeout option, so we wrap the handshake in a
      // Promise.race. On timeout, tear the transport down so the next
      // connect() starts clean and the upstream socket isn't left hanging.
      const connectTimeoutMs = this.serverSettings?.connectionTimeout ?? 0;
      const connectPromise = this.client.connect(this.transport);
      const runConnect = async (): Promise<void> => {
        if (connectTimeoutMs > 0) {
          connectPromise.catch(() => {});
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Connection timed out after ${connectTimeoutMs} ms`,
                  ),
                ),
              connectTimeoutMs,
            );
          });
          try {
            await Promise.race([connectPromise, timeoutPromise]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        } else {
          await connectPromise;
        }
      };

      try {
        await this.invokeMcpClient(runConnect);
      } catch (err) {
        if (connectTimeoutMs > 0) {
          await this.disconnect().catch(() => {});
        }
        throw err;
      }
      this.status = "connected";
      this.dispatchTypedEvent("statusChange", this.status);

      // Always fetch server info (capabilities, serverInfo, instructions) - this is just cached data from initialize.
      // Must run BEFORE the "connect" event: the managed list-state managers
      // refresh on "connect" and gate their list RPC on getCapabilities() (see
      // #1395). If "connect" fired first, that gate would read undefined
      // capabilities and wipe tools/prompts/resources to empty on every connect.
      await this.fetchServerInfo();

      this.dispatchTypedEvent("connect");

      // Set initial logging level if configured and server supports it
      if (this.initialLoggingLevel && this.capabilities?.logging) {
        await this.client.setLoggingLevel(
          this.initialLoggingLevel,
          this.getRequestOptions(),
        );
      }

      // Set up sampling request handler if sampling capability is enabled
      if (this.sample && this.client) {
        const samplingHandler = (
          request: CreateMessageRequest,
        ): Promise<CreateMessageResult> => {
          const paramsTask = (request.params as { task?: { ttl?: number } })
            ?.task;
          if (this.receiverTasks && paramsTask != null) {
            const record = this.createReceiverTask({
              ttl: paramsTask.ttl,
              initialStatus: "input_required",
              statusMessage: "Awaiting user input",
            });
            void (async () => {
              const samplingRequest = new SamplingCreateMessage(
                request,
                (result) => {
                  record.resolvePayload(result);
                  const now = new Date().toISOString();
                  const updated: Task = {
                    ...record.task,
                    status: "completed",
                    lastUpdatedAt: now,
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (error) => {
                  record.rejectPayload(error);
                  const now = new Date().toISOString();
                  const updated: Task = {
                    ...record.task,
                    status: "failed",
                    lastUpdatedAt: now,
                    statusMessage:
                      error instanceof Error ? error.message : String(error),
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (id) => this.removePendingSample(id),
              );
              this.addPendingSample(samplingRequest);
            })();
            // Task-augmented (2025-11-25) response: the server sent a
            // task-augmented `sampling/createMessage`, so we reply with a
            // `CreateTaskResult` (`{ task }`) rather than a `CreateMessageResult`.
            // The v2 Client validates a spec handler's result and would reject
            // `{ task }` with -32602; `installReceiverTaskResponseBypass` below
            // routes this task-augmented branch around that validation so the
            // legacy `{ task }` response reaches the wire. `taskResult` is typed
            // as `CreateTaskResult` so its shape IS checked; the unavoidable
            // `as unknown as CreateMessageResult` bridges the SDK gap — the 2-arg
            // `setRequestHandler` overload types a sampling handler's return as
            // `CreateMessageResult` only and doesn't model the (deprecated but
            // wire-valid) task-augmented `CreateTaskResult`. A handler-result
            // union `CreateMessageResult | CreateTaskResult` on the SDK side
            // would remove this cast.
            const taskResult: CreateTaskResult = { task: record.task };
            return Promise.resolve(
              taskResult as unknown as CreateMessageResult,
            );
          }
          return this.enqueuePendingSample(request, "server-request");
        };
        this.client.setRequestHandler(
          "sampling/createMessage",
          samplingHandler,
        );
        if (this.receiverTasks) {
          this.installReceiverTaskResponseBypass(
            "sampling/createMessage",
            samplingHandler,
          );
        }
      }

      // Set up elicitation request handler if elicitation capability is enabled
      if (this.elicit && this.client) {
        const elicitHandler = (
          request: ElicitRequest,
        ): Promise<ElicitResult> => {
          const paramsTask = (request.params as { task?: { ttl?: number } })
            ?.task;
          if (this.receiverTasks && paramsTask != null) {
            const record = this.createReceiverTask({
              ttl: paramsTask.ttl,
              initialStatus: "input_required",
              statusMessage: "Awaiting user input",
            });
            void (async () => {
              const elicitationRequest = new ElicitationCreateMessage(
                request,
                (result) => {
                  record.resolvePayload(result);
                  const now = new Date().toISOString();
                  const updated: Task = {
                    ...record.task,
                    status: "completed",
                    lastUpdatedAt: now,
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (id) => this.removePendingElicitation(id),
                (error) => {
                  record.rejectPayload(error);
                  const now = new Date().toISOString();
                  const updated: Task = {
                    ...record.task,
                    status: "failed",
                    lastUpdatedAt: now,
                    statusMessage: error.message,
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
              );
              this.addPendingElicitation(elicitationRequest);
            })();
            // Task-augmented (2025-11-25) response — see the sampling handler
            // above. Reply with a `CreateTaskResult` (`{ task }`), routed around
            // the v2 Client's result validation by
            // `installReceiverTaskResponseBypass` below. `taskResult` is typed so
            // its shape is checked; the `as unknown as ElicitResult` bridges the
            // same SDK gap as the sampling handler — the 2-arg `setRequestHandler`
            // overload types an elicitation handler's return as `ElicitResult`
            // only and doesn't model the task-augmented `CreateTaskResult`.
            const taskResult: CreateTaskResult = { task: record.task };
            return Promise.resolve(taskResult as unknown as ElicitResult);
          }
          return this.enqueuePendingElicitation(request, "server-request");
        };
        this.client.setRequestHandler("elicitation/create", elicitHandler);
        if (this.receiverTasks) {
          this.installReceiverTaskResponseBypass(
            "elicitation/create",
            elicitHandler,
          );
        }
      }

      // Set up roots/list request handler if roots capability is enabled
      if (this.roots !== undefined && this.client) {
        this.client.setRequestHandler("roots/list", async () => {
          return { roots: this.roots ?? [] };
        });
      }

      // Set up receiver-task request handlers (server polls us for tasks/list,
      // tasks/get, tasks/result, tasks/cancel). SDK v2 removed tasks from the
      // spec-method set, so these register through the 3-arg custom form with an
      // explicit params schema (from the deprecated-but-importable task request
      // schemas). The `result` schema is intentionally omitted so the SDK does
      // not validate our responder return — matching v1, where only the
      // requester validated (our receiver `Task` may omit fields a strict result
      // schema would require).
      if (this.receiverTasks && this.client) {
        this.client.setRequestHandler(
          "tasks/list",
          { params: ListTasksRequestSchema.shape.params },
          async () => ({ tasks: this.listReceiverTasks() }),
        );
        this.client.setRequestHandler(
          "tasks/get",
          { params: GetTaskRequestSchema.shape.params },
          async (params) => {
            const record = this.getReceiverTask(params.taskId);
            if (!record) {
              throw new ProtocolError(
                ProtocolErrorCode.InvalidParams,
                `Unknown taskId: ${params.taskId}`,
              );
            }
            return record.task;
          },
        );
        this.client.setRequestHandler(
          "tasks/result",
          { params: GetTaskPayloadRequestSchema.shape.params },
          async (params) => this.getReceiverTaskPayload(params.taskId),
        );
        this.client.setRequestHandler(
          "tasks/cancel",
          { params: CancelTaskRequestSchema.shape.params },
          async (params) => this.cancelReceiverTask(params.taskId),
        );
      }

      // Set up notification handler for roots/list_changed from server
      if (this.client) {
        this.client.setNotificationHandler(
          "notifications/roots/list_changed",
          async () => {
            // Dispatch event to notify UI that server's roots may have changed
            // Note: rootsChange is a CustomEvent with Root[] payload, not a signal event
            // We'll reload roots when the UI requests them, so we don't need to pass data here
            // For now, we'll just dispatch an empty array as a signal to reload
            this.dispatchTypedEvent("rootsChange", this.roots || []);
          },
        );
      }

      // Set up listChanged notification handlers based on config
      if (this.client) {
        // Tools listChanged handler
        // Only register if both client config and server capability are enabled
        if (
          this.listChangedNotifications.tools &&
          this.capabilities?.tools?.listChanged
        ) {
          this.client.setNotificationHandler(
            "notifications/tools/list_changed",
            async () => {
              // Always fire notification event (for tracking)
              this.dispatchTypedEvent("toolsListChanged");
              // Tools are managed by state managers; they can listen to toolsListChanged and refresh
            },
          );
        }
        // Note: If handler should not be registered, we don't set it
        // The SDK client will ignore notifications for which no handler is registered

        // Resources listChanged handler (state managers listen and refresh)
        if (
          this.listChangedNotifications.resources &&
          this.capabilities?.resources?.listChanged
        ) {
          this.client.setNotificationHandler(
            "notifications/resources/list_changed",
            async () => {
              this.dispatchTypedEvent("resourcesListChanged");
              this.dispatchTypedEvent("resourceTemplatesListChanged");
            },
          );
        }

        // Prompts listChanged handler (state managers listen and refresh)
        if (
          this.listChangedNotifications.prompts &&
          this.capabilities?.prompts?.listChanged
        ) {
          this.client.setNotificationHandler(
            "notifications/prompts/list_changed",
            async () => {
              this.dispatchTypedEvent("promptsListChanged");
            },
          );
        }

        // Tasks list_changed and status handlers (when server advertises tasks
        // capability). Both are custom (2025-11-25) notification methods absent
        // from v2's spec-notification set, so they register through the 3-arg
        // custom form with an explicit params schema.
        if (this.capabilities?.tasks) {
          this.client.setNotificationHandler(
            "notifications/tasks/list_changed",
            { params: TasksListChangedNotificationSchema.shape.params },
            async () => {
              this.dispatchTypedEvent("tasksListChanged");
            },
          );
          this.client.setNotificationHandler(
            "notifications/tasks/status",
            { params: TaskStatusNotificationSchema.shape.params },
            async (params) => {
              const task = params as Task;
              this.dispatchTypedEvent("taskStatusChange", {
                taskId: task.taskId,
                task,
              });
            },
          );
        }

        // Resource updated notification handler (only if server supports subscriptions)
        if (this.capabilities?.resources?.subscribe === true) {
          this.client.setNotificationHandler(
            "notifications/resources/updated",
            async (notification) => {
              const uri = notification.params.uri;
              // Only process if we're subscribed to this resource
              if (this.subscribedResources.has(uri)) {
                this.dispatchTypedEvent("resourceUpdated", { uri });
              }
            },
          );
        }

        // Elicitation complete notification (URL mode only): server notifies when out-of-band
        // elicitation completes; we resolve the corresponding pending elicitation
        const urlElicitEnabled =
          this.elicit &&
          typeof this.elicit === "object" &&
          this.elicit.url === true;
        if (urlElicitEnabled) {
          this.client.setNotificationHandler(
            "notifications/elicitation/complete",
            async (notification) => {
              const { elicitationId } = notification.params;
              const pending = this.pendingElicitations.find(
                (e) =>
                  e.request.params?.mode === "url" &&
                  e.request.params?.elicitationId === elicitationId,
              );
              if (pending) {
                // Resolve (not just remove): for the error-path retry loop this
                // unblocks `awaitUrlElicitation`, and for request-path it sends
                // the `accept` response the server is still awaiting. No-op once
                // the user already clicked "I've completed it".
                pending.completeIfPending();
              }
            },
          );
        }

        // Progress: we use per-request onprogress (see getRequestOptions). We do not register
        // a progress notification handler so the Protocol's _onprogress stays; timeout reset
        // and routing work, and we inject the caller's progressToken into dispatched events.
      }
    } catch (error) {
      if (!isConnectAuthRecoveryError(error)) {
        this.status = "error";
        this.dispatchTypedEvent("statusChange", this.status);
      }
      if (this.baseTransport && !this.transportHasAuthProvider) {
        await this.dropCachedTransport();
      }
      // Deliberately do NOT dispatch the `error` event here: this is the
      // awaited `connect()` path, so re-throwing hands the reason straight to
      // the caller. The `error` event is reserved for non-awaited transitions
      // (the transport `onerror` above), where there is no promise to reject.
      // Dispatching here too would double-report a handshake failure.
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server.
   * @param safeDisconnectTimeout If > 0, poll every 10ms until SDK _responseHandlers is empty or this many ms have elapsed, then close. Default 0 = close immediately.
   */
  async disconnect(safeDisconnectTimeout = 0): Promise<void> {
    // Claim ownership of the teardown so a synchronous onclose (fired from
    // within close() below) defers its status set + `disconnect` event to the
    // canonical block at the end of this method. Reset before that block so
    // its dispatch is unaffected; any later async onclose early-returns on the
    // "disconnected" status guard. Guarantees a single `disconnect` event even
    // when disconnecting from a held-"error" status (#1490 re-review).
    this.disconnecting = true;
    try {
      if (this.client) {
        if (safeDisconnectTimeout > 0) {
          // This is pretty creepy, but there are test cases where client calls return but there
          // are still response handlers pending. Usually a single macrotask delay is enough to
          // clear them, but not always (it's been >10ms in some cases). The pending handlers
          // themselves get the error (and in cases where those aren't awaited, the errors fly
          // out of the test). This workaround where we directly access the handlers (otherwise
          // private member of the SDK client) is creepy, but the least ugly working solution.
          // We will re-valuate this with the v2 SDK. Currenly only tests that do quick disconnects
          // use this setting.
          //
          const protocol = this.client as unknown as {
            _responseHandlers?: Map<unknown, unknown>;
          };
          const handlers = protocol._responseHandlers;
          const deadline = Date.now() + safeDisconnectTimeout;
          while (
            handlers?.size !== undefined &&
            handlers.size > 0 &&
            Date.now() < deadline
          ) {
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        try {
          await this.client.close();
        } catch {
          // Ignore errors on close
        }
      }
    } finally {
      // Release ownership before the canonical dispatch below so it runs
      // normally; the "disconnected" status it sets makes any later async
      // onclose early-return.
      this.disconnecting = false;
    }
    // Null out transport so next connect() creates a fresh one.
    this.baseTransport = null;
    this.transport = null;
    this.transportHasAuthProvider = false;
    // Update status - any onclose fired during close() above deferred to us
    // (see `disconnecting`), so this is the single place the explicit-disconnect
    // path settles the status and emits `disconnect`.
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("disconnect");
    }

    // Clear server state on disconnect (list state is in state managers).
    // Settle any outstanding elicitations as cancelled before dropping them, so
    // an error-path `awaitUrlElicitation` (which blocks `callTool`) doesn't hang
    // forever when the queue is cleared on teardown.
    this.pendingSamples = [];
    for (const elicitation of this.pendingElicitations) {
      elicitation.cancel();
    }
    this.pendingElicitations = [];
    // Clear resource subscriptions on disconnect. Tear down the modern listen
    // stream (best-effort — the transport is already going away) and bump the
    // generation so any in-flight re-listen/reconnect bails (#1630).
    this.subscribedResources.clear();
    this.modernListenGeneration++;
    this.clearModernReconnectTimer();
    this.modernReconnectAttempts = 0;
    const closingSubscription = this.modernSubscription;
    this.modernSubscription = null;
    closingSubscription?.close().catch(() => {});
    this.modernStreamState = INACTIVE_SUBSCRIPTION_STREAM_STATE;
    this.dispatchTypedEvent(
      "resourceSubscriptionStreamChange",
      INACTIVE_SUBSCRIPTION_STREAM_STATE,
    );
    this.cancelledTaskIds.clear();
    // Abort any in-flight ordinary tool call so its promise settles instead of
    // hanging past teardown; drop the controller reference either way.
    this.activeToolCallAbortController?.abort("Disconnected");
    this.activeToolCallAbortController = undefined;
    // Clear receiver tasks: stop TTL timers and drop records
    for (const record of this.receiverTaskRecords.values()) {
      if (record.cleanupTimeoutId != null) {
        clearTimeout(record.cleanupTimeoutId);
      }
    }
    this.receiverTaskRecords.clear();
    this.appRendererClientProxy = null;
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.protocolVersion = undefined;
    this.protocolEra = undefined;
    this.discoverResult = undefined;
    // Drop the modern per-request log-level opt-in so it doesn't leak into the
    // next connection's `_meta` (#1629).
    this.modernLogLevel = undefined;
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent(
      "pendingElicitationsChange",
      this.pendingElicitations,
    );
    this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
    this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
    this.dispatchTypedEvent("instructionsChange", this.instructions);
    this.dispatchTypedEvent("protocolVersionChange", this.protocolVersion);
    this.dispatchTypedEvent("protocolEraChange", this.protocolEra);
    this.dispatchTypedEvent("discoverResultChange", this.discoverResult);
  }

  /**
   * Returns a client proxy for use by AppRenderer / @mcp-ui. Delegates to the
   * internal MCP Client. Returns null when not connected. Use this instead of
   * accessing the raw client so behavior can be adapted here later if needed.
   */
  getAppRendererClient(): AppRendererClient | null {
    if (!this.client || this.status !== "connected") return null;
    if (this.appRendererClientProxy !== null)
      return this.appRendererClientProxy;
    const target = this.client;
    this.appRendererClientProxy = new Proxy(this.client, {
      get(proxyTarget, prop, receiver) {
        const value = Reflect.get(proxyTarget, prop, receiver);
        if (prop === "setNotificationHandler" && typeof value === "function") {
          return (schemaOrMethod: unknown, ...rest: unknown[]) => {
            // `@modelcontextprotocol/ext-apps` still peers on SDK v1 and
            // subscribes to list-changed notifications with the v1 schema-first
            // API `setNotificationHandler(NotificationSchema, handler)`. SDK v2
            // requires a method STRING as the first argument and throws
            // "'[object Object]' is not a spec notification method" on a schema —
            // which broke App rendering during the initial connect handshake.
            // Translate a schema-first call to the method-string form; native
            // string-first calls (ours) pass through untouched. Remove when
            // ext-apps#702 ships a v2 peer.
            const method =
              typeof schemaOrMethod === "string"
                ? schemaOrMethod
                : (notificationMethodFromSchema(schemaOrMethod) ??
                  schemaOrMethod);
            return (value as (...a: unknown[]) => unknown).apply(target, [
              method,
              ...rest,
            ]);
          };
        }
        return value;
      },
    }) as AppRendererClient;
    return this.appRendererClientProxy;
  }

  /**
   * Send a ping request to the server. Resolves when the server responds.
   */
  async ping(): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    await this.client.request(
      { method: "ping" },
      EmptyResultSchema,
      this.getRequestOptions(),
    );
  }

  /**
   * Get the current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Get the MCP server configuration used to create this client
   */
  getTransportConfig(): MCPServerConfig {
    return this.transportConfig;
  }

  /**
   * Get the server type (stdio, sse, or streamable-http)
   */
  getServerType(): ServerType {
    return getServerTypeFromConfig(this.transportConfig);
  }

  /**
   * Get task capabilities from server
   * @returns Task capabilities or undefined if not supported
   */
  getTaskCapabilities(): { list: boolean; cancel: boolean } | undefined {
    if (!this.capabilities?.tasks) {
      return undefined;
    }
    return {
      list: !!this.capabilities.tasks.list,
      cancel: !!this.capabilities.tasks.cancel,
    };
  }

  /**
   * Get requestor task status by taskId (tasks we created on the server)
   * @param taskId Task identifier
   * @returns Task status
   */
  async getRequestorTask(taskId: string): Promise<Task> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    // SDK v2 removed `client.experimental.tasks.*`; drive the 2025-11-25
    // `tasks/get` wire method directly with its explicit (deprecated-but-
    // importable) result schema. `GetTaskResult` is the flattened task object.
    const task = (await this.client.request(
      { method: "tasks/get", params: { taskId } },
      GetTaskResultSchema,
      this.getRequestOptions(),
    )) as Task;

    // Dispatch client-origin event (taskStatusChange is server-only)
    this.dispatchTypedEvent("requestorTaskUpdated", {
      taskId: task.taskId,
      task: task,
    });
    return task;
  }

  /**
   * Get requestor task result by taskId (tasks we created on the server)
   * @param taskId Task identifier
   * @returns Task result
   */
  async getRequestorTaskResult(taskId: string): Promise<CallToolResult> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    // `tasks/result` returns the task's stored payload; for a task-augmented
    // tool call that payload is a CallToolResult, so validate with
    // CallToolResultSchema (replacing the removed experimental helper).
    return await this.client.request(
      { method: "tasks/result", params: { taskId } },
      CallToolResultSchema,
      this.getRequestOptions(),
    );
  }

  /**
   * Cancel a running requestor task (task we created on the server)
   * @param taskId Task identifier
   * @returns Cancel result
   */
  async cancelRequestorTask(taskId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    // Mark before awaiting: cancelling unblocks the in-flight callToolStream,
    // whose error message may arrive before this resolves — the stream's error
    // path reads this set to label the task "cancelled" rather than "failed".
    this.cancelledTaskIds.add(taskId);
    await this.client.request(
      { method: "tasks/cancel", params: { taskId } },
      CancelTaskResultSchema,
      this.getRequestOptions(),
    );

    // Dispatch event
    this.dispatchTypedEvent("taskCancelled", { taskId });
  }

  /**
   * Cancel the in-flight ordinary (non-task) tool call started by
   * {@link callTool}. Aborting its request makes the SDK send a
   * `notifications/cancelled` to the server (the MCP cancellation flow) and
   * reject the pending call, which `callTool` surfaces as a
   * {@link ToolCallCancelledError}.
   *
   * Task-augmented calls have a server-side task and are cancelled via
   * {@link cancelRequestorTask} instead — this is a no-op for them (and whenever
   * no ordinary call is in flight).
   *
   * @returns `true` if a call was in flight to cancel, `false` otherwise.
   */
  cancelToolCall(): boolean {
    const controller = this.activeToolCallAbortController;
    if (!controller) {
      return false;
    }
    // Drop the reference up front so a rapid second cancel is a clean no-op and
    // can't re-abort a call that's already terminating.
    this.activeToolCallAbortController = undefined;
    // The reason string rides along on the `notifications/cancelled` the SDK
    // sends to the server (and lets the call's catch distinguish this deliberate
    // cancel from other aborts of the same controller, e.g. a disconnect).
    controller.abort(TOOL_CALL_CANCELLED_REASON);
    return true;
  }

  /**
   * List all requestor tasks with optional pagination (tasks we created on the server)
   * @param cursor Optional pagination cursor
   * @returns List of tasks with optional next cursor
   */
  async listRequestorTasks(
    cursor?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const result = await this.client.request(
      { method: "tasks/list", params: cursor ? { cursor } : {} },
      ListTasksResultSchema,
      this.getRequestOptions(),
    );
    return { tasks: result.tasks as Task[], nextCursor: result.nextCursor };
  }

  /**
   * Surface a sampling request through the pending-request UI and resolve with
   * the user's answer. Shared by the inbound `sampling/createMessage` handler
   * (legacy server→client request) and the MRTR driver (a modern
   * `input_required` round embeds the request in a tool-call result). `origin`
   * tags which of the two so the UI can show era-accurate semantics.
   *
   * Sampling has no decline/cancel action (unlike elicitation): the panel
   * either sends a `CreateMessageResult` (resolve — echoed to the server) or
   * Rejects (reject — which fails the tool call). A `signal` abort likewise
   * rejects so the MRTR driver can abort the originating call. `signal` is only
   * passed by the MRTR driver (the tool call's abort signal) — while the driver
   * awaits an answer there is no in-flight SDK request to carry it.
   */
  private enqueuePendingSample(
    request: CreateMessageRequest,
    origin: PendingRequestOrigin,
    signal?: AbortSignal,
  ): Promise<CreateMessageResult> {
    // A Promise's resolve/reject is idempotent (first settle wins, later ones
    // no-op), so the respond/reject/abort paths need no extra guard against a
    // double settle.
    return new Promise<CreateMessageResult>((resolvePromise, rejectPromise) => {
      const sample = new SamplingCreateMessage(
        request,
        resolvePromise,
        rejectPromise,
        (id) => this.removePendingSample(id),
        origin,
      );
      this.addPendingSample(sample);
      this.wirePendingAbort(signal, () => {
        this.removePendingSample(sample.id);
        rejectPromise(createPendingAbortError());
      });
    });
  }

  /**
   * Surface an elicitation request through the pending-request UI and resolve
   * with the user's answer. Shared by the inbound `elicitation/create` handler
   * and the MRTR driver — see {@link enqueuePendingSample} for the `origin` /
   * `signal` semantics. A declined/cancelled elicitation resolves with the
   * corresponding `ElicitResult` (echoed to the server on retry); only a
   * genuine failure or a `signal` abort rejects.
   */
  private enqueuePendingElicitation(
    request: ElicitRequest,
    origin: PendingRequestOrigin,
    signal?: AbortSignal,
  ): Promise<ElicitResult> {
    // See {@link enqueuePendingSample} — Promise settle is idempotent.
    return new Promise<ElicitResult>((resolvePromise, rejectPromise) => {
      const elicitation = new ElicitationCreateMessage(
        request,
        resolvePromise,
        (id) => this.removePendingElicitation(id),
        rejectPromise,
        origin,
      );
      this.addPendingElicitation(elicitation);
      this.wirePendingAbort(signal, () => {
        this.removePendingElicitation(elicitation.id);
        rejectPromise(createPendingAbortError());
      });
    });
  }

  /**
   * Reject a still-pending request when `signal` aborts (e.g. the user cancels
   * the tool call while its MRTR round is awaiting an answer). No-op when
   * `signal` is absent — the legacy inbound-handler path passes none.
   */
  private wirePendingAbort(
    signal: AbortSignal | undefined,
    onAbort: () => void,
  ): void {
    if (!signal) return;
    /* v8 ignore next 4 -- unreachable in the MRTR flow: an abort during the
       SDK request leg rejects `client.request` before we reach the pending
       enqueue, so the signal is never already-aborted here; kept as a defensive
       guard because addEventListener("abort") would not fire on a pre-aborted
       signal. */
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  /**
   * Drive a multi-round-trip request (SEP-2322 "MRTR") for one of the modern
   * multi-round-trip methods (`tools/call`, `prompts/get`, `resources/read`).
   *
   * The client is constructed with `inputRequired: { autoFulfill: false }`, so
   * an `input_required` result is handed back here (via `allowInputRequired`)
   * instead of the SDK silently fulfilling and retrying. We surface each
   * embedded request through the SAME pending-request UI the legacy
   * server→client path uses (`fulfilInputRequests`), gather the bare results,
   * and retry the ORIGINAL request with `inputResponses` + the echoed
   * `requestState` on a fresh JSON-RPC id (`client.request` mints it). The loop
   * runs until the server returns a complete result, bounded by
   * {@link MRTR_MAX_ROUNDS}.
   *
   * On legacy connections a server never returns `input_required`, so the first
   * response is always complete and this is a single `client.request` call.
   */
  private async requestWithInputRequired<TSchema extends StandardSchemaV1>(
    method: "tools/call" | "prompts/get" | "resources/read",
    params: Record<string, unknown>,
    resultSchema: TSchema,
    requestOptions: RequestOptions,
  ): Promise<StandardSchemaV1.InferOutput<TSchema>> {
    const client = this.client;
    /* v8 ignore next 3 -- defensive: every caller (callTool/getPrompt/
       readResource) already verified this.client is non-null before reaching
       here, so this guard cannot trip in practice. */
    if (!client) {
      throw new Error("Client is not connected");
    }
    const wrapped = withInputRequired(resultSchema);
    const signal = requestOptions.signal;
    let round = 0;
    let nextParams = params;
    while (true) {
      const outcome = await client.request(
        { method, params: nextParams },
        wrapped,
        {
          ...requestOptions,
          allowInputRequired: true,
        },
      );
      if (!isInputRequiredResult(outcome)) {
        return outcome;
      }
      round += 1;
      if (round > InspectorClient.MRTR_MAX_ROUNDS) {
        throw new Error(
          `Multi-round-trip "${method}" exceeded ${InspectorClient.MRTR_MAX_ROUNDS} input_required rounds without completing.`,
        );
      }
      const inputResponses = await this.fulfilInputRequests(
        outcome.inputRequests,
        signal,
      );
      // Retry re-issues the ORIGINAL params plus THIS round's answers and the
      // server's opaque state token; the SDK assigns a fresh JSON-RPC id.
      nextParams = {
        ...params,
        ...(inputResponses ? { inputResponses } : {}),
        ...(outcome.requestState !== undefined
          ? { requestState: outcome.requestState }
          : {}),
      };
    }
  }

  /**
   * Fulfil the embedded requests of one MRTR `input_required` round, keyed by
   * the server-assigned identifiers echoed back in `inputResponses`. Sequential
   * (one modal at a time) to keep the single-slot pending UI coherent. Returns
   * `undefined` for a `requestState`-only round (no embedded requests); an empty
   * `inputRequests` map yields an empty `{}`, which the retry echoes harmlessly.
   */
  private async fulfilInputRequests(
    inputRequests: InputRequests | undefined,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    if (!inputRequests) return undefined;
    const responses: Record<string, unknown> = {};
    for (const [key, embedded] of Object.entries(inputRequests)) {
      responses[key] = await this.fulfilEmbeddedInputRequest(embedded, signal);
    }
    return responses;
  }

  /**
   * Fulfil a single embedded MRTR request. `roots/list` is auto-answered from
   * the configured roots (consistent with the legacy `roots/list` handler — no
   * pending UX); `elicitation/create` and `sampling/createMessage` surface
   * through the pending-request UI tagged `"input-required"`.
   */
  private async fulfilEmbeddedInputRequest(
    request: CreateMessageRequest | ElicitRequest | ListRootsRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    switch (request.method) {
      case "roots/list":
        return { roots: this.roots ?? [] };
      case "elicitation/create":
        return this.enqueuePendingElicitation(
          request,
          "input-required",
          signal,
        );
      case "sampling/createMessage":
        return this.enqueuePendingSample(request, "input-required", signal);
      /* v8 ignore next 6 -- defensive: an SDK server rejects an unknown embedded
         method before it reaches the wire, so this only guards against a
         non-conformant hand-rolled server; not reproducible against the
         SDK-based test servers. */
      default:
        throw new Error(
          `Unsupported embedded input_required request method: ${
            (request as { method: string }).method
          }`,
        );
    }
  }

  /**
   * Get all pending sampling requests
   */
  getPendingSamples(): SamplingCreateMessage[] {
    return [...this.pendingSamples];
  }

  /**
   * Add a pending sampling request
   */
  private addPendingSample(sample: SamplingCreateMessage): void {
    this.pendingSamples.push(sample);
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent("newPendingSample", sample);
  }

  /**
   * Remove a pending sampling request by ID
   */
  removePendingSample(id: string): void {
    const index = this.pendingSamples.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.pendingSamples.splice(index, 1);
      this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    }
  }

  /**
   * Get all pending elicitation requests
   */
  getPendingElicitations(): ElicitationCreateMessage[] {
    return [...this.pendingElicitations];
  }

  /**
   * Add a pending elicitation request
   */
  private addPendingElicitation(elicitation: ElicitationCreateMessage): void {
    this.pendingElicitations.push(elicitation);
    this.dispatchTypedEvent(
      "pendingElicitationsChange",
      this.pendingElicitations,
    );
    this.dispatchTypedEvent("newPendingElicitation", elicitation);
  }

  /**
   * Remove a pending elicitation request by ID
   */
  removePendingElicitation(id: string): void {
    const index = this.pendingElicitations.findIndex((e) => e.id === id);
    if (index !== -1) {
      this.pendingElicitations.splice(index, 1);
      this.dispatchTypedEvent(
        "pendingElicitationsChange",
        this.pendingElicitations,
      );
    }
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): ServerCapabilities | undefined {
    return this.capabilities;
  }

  /**
   * Get the capabilities this client advertises to the server. Snapshotted
   * from the initialize-time build in setupClient(); does not reflect later
   * registerCapabilities() calls on the underlying SDK Client.
   */
  getClientCapabilities(): ClientCapabilities {
    return this.clientCapabilities;
  }

  /**
   * Get server info (name, version)
   */
  getServerInfo(): Implementation | undefined {
    return this.serverInfo;
  }

  /**
   * Get server instructions
   */
  getInstructions(): string | undefined {
    return this.instructions;
  }

  /**
   * Get the MCP protocol version negotiated with the server. On a legacy
   * connect this is the version from the initialize handshake (e.g.
   * "2025-06-18"); on a modern connect it's the negotiated modern revision.
   * Undefined when not connected.
   */
  getProtocolVersion(): string | undefined {
    return this.protocolVersion;
  }

  /**
   * The protocol era negotiated with the server (SEP §7.8): `"legacy"` for the
   * 2025-11-25 initialize handshake, `"modern"` for the 2026-era sessionless
   * model. Populated for every era once connected — including a plain legacy
   * (`mode: "legacy"`) connect, which the SDK reports as `"legacy"`. Undefined
   * only when not connected (before connect / after disconnect). (#1626)
   */
  getProtocolEra(): ProtocolEra | undefined {
    return this.protocolEra;
  }

  /**
   * The `server/discover` result captured on a probed (`"auto"`) or pinned
   * (`"modern"`) connect — server identity, capabilities, and supported
   * versions learned up front without an initialize handshake. Undefined when
   * not connected or on a plain legacy connect. Persistable and feedable back
   * to the SDK as `connect(transport, { prior })` for a zero-round-trip
   * reconnect. (#1626)
   */
  getDiscoverResult(): DiscoverResult | undefined {
    return this.discoverResult;
  }

  /**
   * The per-server settings this client was constructed with (headers,
   * timeouts, roots, OAuth, the auto-refresh-on-list-changed option, etc.).
   * Read by the managed list state to decide whether to auto-refresh on
   * `list_changed` notifications (#1402).
   */
  getServerSettings(): InspectorServerSettings | undefined {
    return this.serverSettings;
  }

  /**
   * Replace the in-memory per-server settings on a live client. Lets a settings
   * edit (e.g. toggling auto-refresh-on-list-changed) take effect on the
   * current connection without a reconnect — the managed list state reads
   * `getServerSettings()` at notification time, so the next `list_changed`
   * notification honors the new value (#1444). Connection-time inputs
   * (transport, OAuth, timeouts) still only apply on the next connect.
   */
  setServerSettings(settings: InspectorServerSettings): void {
    this.serverSettings = settings;
  }

  /**
   * Set the logging level for the MCP server (legacy era only).
   *
   * On legacy servers logging is session-scoped: one `logging/setLevel` request
   * sets the level for all subsequent `notifications/message`. Modern servers
   * removed this method — use {@link setModernLogLevel} there instead.
   *
   * @param level Logging level to set
   * @throws Error if client is not connected or server doesn't support logging
   */
  async setLoggingLevel(level: LoggingLevel): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    if (!this.capabilities?.logging) {
      throw new Error("Server does not support logging");
    }
    await this.client.setLoggingLevel(level, this.getRequestOptions());
  }

  /**
   * Set (or clear) the modern-era per-request log level (#1629).
   *
   * On 2026-07-28 servers `logging/setLevel` is gone and there is no
   * session-scoped level: the client opts into logs per request by stamping the
   * `io.modelcontextprotocol/logLevel` `_meta` key, and the server MUST NOT emit
   * `notifications/message` for requests that omit it. This stores the level so
   * {@link mergeMeta} stamps it on every subsequent request; pass `undefined` to
   * stop opting in (logs then stay silently absent). Takes effect immediately —
   * no request is sent, and it is a no-op on the wire until the next request.
   *
   * @param level Level to stamp on every request, or `undefined` to opt out.
   */
  setModernLogLevel(level: LoggingLevel | undefined): void {
    this.modernLogLevel = level;
  }

  /** The modern-era per-request log level, or `undefined` when not opted in. */
  getModernLogLevel(): LoggingLevel | undefined {
    return this.modernLogLevel;
  }

  /**
   * Fetch a single page of tools without updating the client's internal list.
   */
  async listTools(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ tools: Tool[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ListToolsRequest["params"] = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.invokeMcpClient(() =>
      this.client!.request(
        { method: "tools/list", params },
        ListToolsResultSchema,
        this.getRequestOptions(metadata?.progressToken),
      ),
    );
    const tools = [...(response.tools || [])];
    return { tools, nextCursor: response.nextCursor };
  }

  /**
   * Aggregate ALL pages of `tools/list` via the SDK's high-level
   * `client.listTools()` — the cache-aware verb. Unlike the single-page
   * {@link listTools} (raw `client.request`, for pagination debugging), this is
   * the path the managed tool list uses on refresh: the SDK walks every page,
   * applies the SEP-2243 `x-mcp-header` exclusion, and consults/writes its
   * response cache. `cacheMode` selects the disposition (`'use'` serves a
   * still-fresh cached list without a round trip; `'refresh'` always fetches
   * and re-stores; `'bypass'` fetches without touching the cache) — only
   * meaningful on modern servers that send `ttlMs` hints; a no-op on legacy
   * (nothing is cached, so every call hits the wire regardless).
   */
  async listAllTools(options?: {
    cacheMode?: CacheMode;
    metadata?: Record<string, string>;
  }): Promise<{ tools: Tool[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const response = await this.invokeMcpClient(() =>
      this.client!.listTools(
        this.aggregateListParams(options?.metadata),
        this.getCacheableRequestOptions(options?.cacheMode),
      ),
    );
    return { tools: [...response.tools] };
  }

  /**
   * Call a tool. Caller must provide the Tool (e.g. from a state manager).
   * @param tool The tool to call (use tool.name for the request)
   * @param args Tool arguments
   * @param generalMetadata Optional general metadata
   * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
   * @param taskOptions Optional task options (e.g. ttl) for task-augmented requests
   * @returns Tool call response
   */
  async callTool(
    tool: Tool,
    args: Record<string, JsonValue>,
    generalMetadata?: Record<string, string>,
    toolSpecificMetadata?: Record<string, string>,
    taskOptions?: { ttl?: number },
    options?: { skipOutputValidation?: boolean },
  ): Promise<ToolCallInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    if (tool.execution?.taskSupport === "required") {
      throw new Error(
        `Tool "${tool.name}" requires task support. Use callToolStream() instead of callTool().`,
      );
    }

    const request: ToolCallRequest = {
      tool,
      args,
      generalMetadata,
      toolSpecificMetadata,
      taskOptions,
      options,
    };
    // Track this call so `cancelToolCall()` can abort it. Aborting makes the SDK
    // send a `notifications/cancelled` to the server (the MCP cancellation flow)
    // and reject the pending request, which we surface as a
    // `ToolCallCancelledError`. This single slot is shared by *every* `callTool`
    // caller (last-writer-wins), so `cancelToolCall()` targets the most recently
    // started ordinary call — fine today since the Cancel button only surfaces
    // for the single Tools-screen call. Cleared in `finally`, but only if still
    // ours so a later overlapping call's controller isn't clobbered (#1458).
    const abortController = new AbortController();
    this.activeToolCallAbortController = abortController;
    try {
      return await this.callToolWithRetries(request, abortController);
    } finally {
      if (this.activeToolCallAbortController === abortController) {
        this.activeToolCallAbortController = undefined;
      }
    }
  }

  /**
   * The URL-elicitation retry loop for {@link callTool}, factored out so the
   * caller can wrap it in the abort-controller lifecycle (`try`/`finally`). On a
   * user cancellation (the call's abort signal fired with the cancel reason) the
   * SDK has already sent `notifications/cancelled`, so we throw a
   * {@link ToolCallCancelledError} without recording a failed call — the cancel
   * was intentional, not a failure.
   */
  private async callToolWithRetries(
    request: ToolCallRequest,
    abortController: AbortController,
  ): Promise<ToolCallInvocation> {
    const { tool, args, generalMetadata, toolSpecificMetadata } = request;
    // Retry-loop state for the URL-elicitation error path: a `-32042`
    // (UrlElicitationRequired) response means the server needs the user to
    // complete one or more URL elicitations before the call can succeed. We
    // surface them, wait for completion, then re-issue the same call. The
    // counter bounds a server that keeps returning `-32042` so we can't spin
    // forever (each accepted round is one attempt). `presentedUrls` guards the
    // loop: a retry that re-requests a URL we already handled can't progress, so
    // we abort with a UrlElicitationLoopError rather than re-prompt.
    let urlElicitationAttempt = 0;
    const presentedUrls = new Set<string>();
    while (true) {
      try {
        return await this.attemptToolCall(request, abortController.signal);
      } catch (error) {
        // The controller was aborted. A deliberate `cancelToolCall()` (matched
        // by reason) means the SDK already sent `notifications/cancelled` if the
        // abort landed during a `client.request` leg — so surface a clean
        // cancellation, not a generic failure, and don't record it in history.
        // If instead the abort lands while an MRTR round is awaiting an embedded
        // pending request (between `client.request` legs), there is no in-flight
        // SDK request, so nothing is sent on the wire — `wirePendingAbort` just
        // rejects the pending request and the driver abandons the retry; the
        // outcome here is identical. Any other abort (e.g. a disconnect, which
        // aborts with a different reason) falls through to the normal error path
        // (#1458).
        if (
          abortController.signal.aborted &&
          abortController.signal.reason === TOOL_CALL_CANCELLED_REASON
        ) {
          throw new ToolCallCancelledError(tool.name);
        }
        const urlElicitations = getUrlElicitationsFromError(error);
        if (
          urlElicitations &&
          urlElicitations.length > 0 &&
          urlElicitationAttempt < MAX_URL_ELICITATION_RETRIES
        ) {
          // Loop guard: the server repeated a URL we already handled this call.
          const repeated = urlElicitations.find((e) =>
            presentedUrls.has(e.url),
          );
          if (repeated) {
            const loopError = new UrlElicitationLoopError(repeated.url);
            this.dispatchFailedToolCall(
              tool,
              args,
              generalMetadata,
              toolSpecificMetadata,
              loopError.message,
            );
            throw loopError;
          }
          urlElicitationAttempt++;
          for (const e of urlElicitations) {
            presentedUrls.add(e.url);
          }
          const action = await this.runUrlElicitations(urlElicitations);
          if (action === "accept") {
            continue;
          }
          // The user declined/cancelled a required URL elicitation, so the
          // original call can't proceed. Surface it as a failed call with a
          // clear reason instead of the raw "-32042" message.
          const abortError = new Error(
            `Tool call cancelled: required URL elicitation was ${
              action === "decline" ? "declined" : "cancelled"
            }.`,
          );
          this.dispatchFailedToolCall(
            tool,
            args,
            generalMetadata,
            toolSpecificMetadata,
            abortError.message,
          );
          throw abortError;
        }
        // Not a URL-elicitation error (or the non-spec no-list variant, or
        // retries exhausted): record + rethrow so the caller can surface it.
        // The App distinguishes the no-list `-32042` case (a dedicated toast)
        // via getUrlElicitationsFromError on the thrown error.
        if (urlElicitations && urlElicitations.length > 0) {
          // A non-empty list here means the retry cap was hit (the live path
          // returns or continues). Log the give-up so a server that keeps
          // demanding new URL elicitations is diagnosable rather than looking
          // like an ordinary failure.
          this.logger.warn(
            { tool: tool.name, attempts: urlElicitationAttempt },
            `Tool "${tool.name}" still required URL elicitations after ${MAX_URL_ELICITATION_RETRIES} attempts; giving up.`,
          );
        }
        this.dispatchFailedToolCall(
          tool,
          args,
          generalMetadata,
          toolSpecificMetadata,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }
  }

  /**
   * Run a single tools/call attempt: convert args, issue the request, validate,
   * and return a successful {@link ToolCallInvocation}. Throws on any error
   * (including a `-32042` UrlElicitationRequired response); {@link callTool}'s
   * retry loop owns the elicitation handling and failure bookkeeping.
   */
  private async attemptToolCall(
    request: ToolCallRequest,
    signal?: AbortSignal,
  ): Promise<ToolCallInvocation> {
    const {
      tool,
      args,
      generalMetadata,
      toolSpecificMetadata,
      taskOptions,
      options,
    } = request;
    const client = this.client;
    if (!client) {
      throw new Error("Client is not connected");
    }
    let convertedArgs: Record<string, JsonValue> = args;
    const stringArgs: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        stringArgs[key] = value;
      }
    }
    if (Object.keys(stringArgs).length > 0) {
      const convertedStringArgs = convertToolParameters(tool, stringArgs);
      convertedArgs = { ...args, ...convertedStringArgs };
    }

    // Merge general metadata with tool-specific metadata; tool-specific wins.
    const callMetadata: Record<string, string> | undefined =
      generalMetadata || toolSpecificMetadata
        ? { ...(generalMetadata || {}), ...(toolSpecificMetadata || {}) }
        : undefined;

    const timestamp = new Date();
    // Fold in this client's defaultMetadata so server-wide _meta reaches
    // the wire even when the caller passed nothing.
    const metadata = this.mergeMeta(callMetadata);

    const callParams: {
      name: string;
      arguments: Record<string, JsonValue>;
      _meta?: Record<string, string>;
      task?: { ttl: number };
    } = {
      name: tool.name,
      arguments: convertedArgs,
      _meta: metadata,
    };
    if (taskOptions?.ttl != null) {
      callParams.task = { ttl: taskOptions.ttl };
    }

    const requestOptions = this.getRequestOptions(
      metadata?.progressToken,
      signal,
    );
    // Route through the MRTR driver (`requestWithInputRequired`) so a modern
    // `input_required` result pauses at the pending-request UI and retries with
    // the user's answer (#1704). Both eras use `client.request` with
    // `CallToolResultSchema`; on legacy this is a single round. We deliberately
    // do NOT use `client.callTool` (which would auto-fulfil / reject on an
    // `input_required` result) — its only extra behavior over `request` is
    // structuredContent output validation, which we already re-implement below
    // via `validateToolOutput`. MCP Apps passthrough (skipOutputValidation)
    // simply skips that check; both paths yield a CallToolResult once the
    // driver returns a complete (non-`input_required`) result.
    const result = await this.invokeMcpClient(
      () =>
        this.requestWithInputRequired(
          "tools/call",
          callParams,
          CallToolResultSchema,
          requestOptions,
        ),
      { method: "tools/call", toolName: tool.name },
    );

    // Output-schema validation. SDK v2's `callTool` relaxed some checks (e.g. it
    // no longer rejects a structuredContent with undeclared properties against a
    // strict `additionalProperties: false` schema), so we run our own Ajv check
    // to preserve the Inspector's v1 behavior:
    //  - default path: strict — a schema violation rejects the call (matching
    //    what a strict host would do), so the caller sees the error.
    //  - skipOutputValidation (MCP Apps passthrough): non-fatal — surface it as
    //    an advisory so a schema-violating-but-real result still reaches the app.
    const outputValidationError = this.validateToolOutput(tool, result);
    if (outputValidationError && !options?.skipOutputValidation) {
      // Match the prior contract: on v1 a strict output-schema violation
      // surfaced as the SDK's typed `McpError`/`ProtocolError` (code
      // InvalidParams), not a bare Error — so downstream code that branches on
      // `instanceof ProtocolError` / `error.code` keeps working.
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        outputValidationError,
      );
    }

    const invocation: ToolCallInvocation = {
      toolName: tool.name,
      params: args,
      result,
      timestamp,
      success: true,
      metadata,
      outputValidationError,
    };

    this.dispatchTypedEvent("toolCallResultChange", {
      toolName: tool.name,
      params: args,
      result: invocation.result,
      timestamp,
      success: true,
      metadata,
      outputValidationError,
    });

    return invocation;
  }

  /**
   * Record a failed tools/call as a `toolCallResultChange` event (history + the
   * Tools panel) without throwing. {@link callTool} calls this before rethrowing
   * so a failure — whether a transport error, a declined URL elicitation, or a
   * non-spec `-32042` — lands in the request history exactly once.
   */
  private dispatchFailedToolCall(
    tool: Tool,
    args: Record<string, JsonValue>,
    generalMetadata: Record<string, string> | undefined,
    toolSpecificMetadata: Record<string, string> | undefined,
    errorMessage: string,
  ): void {
    const callMetadata: Record<string, string> | undefined =
      generalMetadata || toolSpecificMetadata
        ? { ...(generalMetadata || {}), ...(toolSpecificMetadata || {}) }
        : undefined;
    const metadata = this.mergeMeta(callMetadata);
    this.dispatchTypedEvent("toolCallResultChange", {
      toolName: tool.name,
      params: args,
      result: null,
      timestamp: new Date(),
      success: false,
      error: errorMessage,
      metadata,
    });
  }

  /**
   * Surface the URL elicitations carried by a `-32042` error, one at a time and
   * in order (per the spec's "URL mode with elicitation required error" flow),
   * returning as soon as the user declines/cancels one. Returns `"accept"` only
   * when every elicitation was accepted, which is {@link callTool}'s signal to
   * retry the original call.
   */
  private async runUrlElicitations(
    elicitations: ElicitRequestURLParams[],
  ): Promise<ElicitResult["action"]> {
    for (const params of elicitations) {
      const action = await this.awaitUrlElicitation(params);
      if (action !== "accept") {
        return action;
      }
    }
    return "accept";
  }

  /**
   * Add one error-path URL elicitation to the pending queue (so it renders in
   * the same modal as request-path elicitations) and resolve with the user's
   * action. Unlike the request-path handler there is no server request to
   * answer — accepting it just unblocks the retry; the server's optional
   * `notifications/elicitation/complete` resolves it as accepted too (via
   * `completeIfPending`).
   */
  private awaitUrlElicitation(
    params: ElicitRequestURLParams,
  ): Promise<ElicitResult["action"]> {
    return new Promise<ElicitResult["action"]>((resolve) => {
      const request = {
        method: "elicitation/create",
        params,
      } as ElicitRequest;
      const message = new ElicitationCreateMessage(
        request,
        (result) => resolve(result.action),
        (id) => this.removePendingElicitation(id),
      );
      this.addPendingElicitation(message);
    });
  }

  /**
   * Non-fatally validate a delivered tool result against the tool's outputSchema
   * (used by the skipOutputValidation path). Delegates to the pure
   * {@link validateToolOutput} helper with this client's lazily-built Ajv
   * validator. Returns an advisory message, or undefined when valid.
   */
  private validateToolOutput(
    tool: Tool,
    result: CallToolResult,
  ): string | undefined {
    this.outputValidator ??= new AjvJsonSchemaValidator();
    return validateToolOutput(this.outputValidator, tool, result);
  }

  /**
   * Poll a task-augmented tool call to completion. Replaces the removed
   * `client.experimental.tasks.callToolStream` helper: it sends the
   * task-augmented `tools/call` (the server responds with a task handle, i.e. a
   * `CreateTaskResult`), then polls `tasks/get` until the task reaches a
   * terminal status, yielding the same `taskCreated | taskStatus | result |
   * error` message shapes the caller's `for await` loop consumes — so all the
   * downstream event dispatch and terminal-state handling stays unchanged.
   */
  private async *pollTaskToolCall(
    params: CallToolRequest["params"],
    requestOptions: RequestOptions,
  ): AsyncGenerator<
    | { type: "taskCreated"; task: Task }
    | { type: "taskStatus"; task: Task }
    | { type: "result"; result: CallToolResult }
    | { type: "error"; error: ProtocolError }
  > {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const client = this.client;
    // The server streams `notifications/progress` for a task AFTER the
    // task-augmented `tools/call` has already returned its `{ task }` handle. But
    // SDK v2 deletes a request's progress subscription the moment that request
    // resolves, so those later ticks would be dropped. Capture the subscription
    // id the SDK registers for this request (the only new key in the private
    // `_progressHandlers` map) so we can keep the caller's `onprogress` alive
    // through the poll and clean it up when the task terminates.
    // SDK gap: `Client` exposes no public API to keep a progress subscription
    // alive across a resolved request (or to subscribe to progress by token), so
    // we reach the private `_progressHandlers` map through a narrowed cast. A
    // public "durable progress subscription" hook would remove this cast.
    const progressHandlers = (
      client as unknown as {
        _progressHandlers: Map<number, ProgressCallback>;
      }
    )._progressHandlers;
    const keysBeforeRequest = new Set(progressHandlers.keys());
    // Create the task-augmented tool call. A task-capable server returns a task
    // handle (`CreateTaskResult` = `{ task }`), but a server that completes
    // synchronously (or for which the tool forbids/ignores task augmentation)
    // may return an immediate `CallToolResult` instead — accept either with a
    // union schema and branch on the presence of `task`.
    //
    // NOTE: this task path does NOT opt into `allowInputRequired`, so a
    // task-augmented tool that returns `input_required` is not MRTR-driven here.
    // Driving MRTR over the tasks extension is out of scope for #1704.
    const requestPromise = client.request(
      { method: "tools/call", params },
      CreateTaskResultSchema.or(CallToolResultSchema),
      requestOptions,
    );
    // The SDK registers the progress handler synchronously while constructing
    // the request promise (before this await), so the new key is present now.
    // ASSUMES SERIAL CONSTRUCTION: `find` takes the first key not present in the
    // pre-request snapshot, which is unambiguous only because no OTHER request
    // registers a progress handler between the snapshot and this request's
    // synchronous registration. Tool calls are user-driven and serial, so that
    // holds today; if concurrent task-augmented calls are ever constructed in
    // the same microtask window, two subscription ids could cross-wire and this
    // must move to an SDK-supported correlation (see the delete-when-native note
    // on `installReceiverTaskResponseBypass`).
    const progressSubscriptionId = requestOptions.onprogress
      ? [...progressHandlers.keys()].find((k) => !keysBeforeRequest.has(k))
      : undefined;
    const created = await requestPromise;
    if (!("task" in created) || created.task == null) {
      // Immediate result — no task was created; yield it directly.
      yield { type: "result", result: created as CallToolResult };
      return;
    }
    let task = created.task as Task;
    yield { type: "taskCreated", task };

    // Revive the (now-deleted) progress subscription for the poll so task-
    // execution progress ticks reach the caller's `onprogress`.
    if (progressSubscriptionId != null && requestOptions.onprogress) {
      progressHandlers.set(progressSubscriptionId, requestOptions.onprogress);
    }
    try {
      // Poll `tasks/get` until the task reaches a terminal status. Honour the
      // server-advertised `pollInterval` when present, else the default cadence.
      while (!InspectorClient.isTerminalTaskStatus(task.status)) {
        const pollInterval =
          typeof task.pollInterval === "number" && task.pollInterval > 0
            ? task.pollInterval
            : DEFAULT_TASK_POLL_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        task = (await client.request(
          { method: "tasks/get", params: { taskId: task.taskId } },
          GetTaskResultSchema,
          this.getRequestOptions(),
        )) as Task;
        yield { type: "taskStatus", task };
      }
    } finally {
      if (progressSubscriptionId != null) {
        progressHandlers.delete(progressSubscriptionId);
      }
    }

    if (task.status === "completed") {
      const result = await client.request(
        { method: "tasks/result", params: { taskId: task.taskId } },
        CallToolResultSchema,
        this.getRequestOptions(),
      );
      yield { type: "result", result };
    } else {
      // failed | cancelled — surface as an error the caller's loop labels as
      // "cancelled" (via cancelledTaskIds) or "failed". Carry a ProtocolError so
      // the `error` payload matches the event map's type (the SDK helper this
      // replaces also yielded a protocol-error-shaped value).
      yield {
        type: "error",
        error: new ProtocolError(
          ProtocolErrorCode.InternalError,
          task.statusMessage ?? `Task ${task.status}`,
        ),
      };
    }
  }

  /**
   * Call a tool with task support (streaming).
   * Caller must provide the Tool (e.g. from a state manager).
   * @param tool The tool to call (use tool.name for the request)
   * @param args Tool arguments
   * @param generalMetadata Optional general metadata
   * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
   * @param taskOptions Optional task options (e.g. ttl) for task-augmented requests
   * @returns Tool call response
   */
  async callToolStream(
    tool: Tool,
    args: Record<string, JsonValue>,
    generalMetadata?: Record<string, string>,
    toolSpecificMetadata?: Record<string, string>,
    taskOptions?: { ttl?: number },
  ): Promise<ToolCallInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      let convertedArgs: Record<string, JsonValue> = args;
      const stringArgs: Record<string, string> = {};
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string") {
          stringArgs[key] = value;
        }
      }
      if (Object.keys(stringArgs).length > 0) {
        const convertedStringArgs = convertToolParameters(tool, stringArgs);
        convertedArgs = { ...args, ...convertedStringArgs };
      }

      // Merge general metadata with tool-specific metadata; tool-specific wins.
      const callMetadata: Record<string, string> | undefined =
        generalMetadata || toolSpecificMetadata
          ? { ...(generalMetadata || {}), ...(toolSpecificMetadata || {}) }
          : undefined;

      const timestamp = new Date();
      const metadata = this.mergeMeta(callMetadata);

      // Call the streaming API
      const streamParams: Record<string, unknown> = {
        name: tool.name,
        arguments: convertedArgs,
      };
      if (metadata) {
        streamParams._meta = metadata;
      }
      if (taskOptions?.ttl != null) {
        streamParams.task = { ttl: taskOptions.ttl };
      }

      let finalResult: CallToolResult | undefined;
      let taskId: string | undefined;
      let error: Error | undefined;

      // Correlate progress → task. getRequestOptions already wires onprogress to
      // dispatch the generic progressNotification (keyed by the caller's
      // progressToken). Wrap it so each tick that arrives after the task is
      // created also dispatches requestorTaskProgress tagged with the taskId
      // this stream owns — the only place that mapping is known. Ticks before
      // taskCreated (rare) just fall through to the generic event.
      //
      // Gate on `this.progress`, mirroring getRequestOptions: when progress is
      // globally disabled there's no inner handler to wrap, and we must not
      // attach one here either — doing so would request a progress token (and
      // emit requestorTaskProgress) for task calls only, bypassing the toggle
      // that governs every other call path.
      const requestOptions = this.getRequestOptions(metadata?.progressToken);
      if (this.progress) {
        const innerOnProgress = requestOptions.onprogress;
        requestOptions.onprogress = (progress: Progress) => {
          innerOnProgress?.(progress);
          if (taskId) {
            this.dispatchTypedEvent("requestorTaskProgress", {
              taskId,
              progress,
            });
          }
        };
      }

      const stream = this.pollTaskToolCall(
        streamParams as CallToolRequest["params"],
        requestOptions,
      );

      // Iterate through the async generator
      for await (const message of stream) {
        switch (message.type) {
          case "taskCreated":
            taskId = message.task.taskId;
            this.dispatchTypedEvent("toolCallTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task,
            });
            this.dispatchTypedEvent("requestorTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task,
            });
            break;

          case "taskStatus":
            if (!taskId) {
              taskId = message.task.taskId;
            }
            this.dispatchTypedEvent("toolCallTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task,
            });
            this.dispatchTypedEvent("requestorTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task,
            });
            break;

          case "result":
            finalResult = message.result as CallToolResult;
            if (taskId) {
              const completedTask: TaskWithOptionalCreatedAt = {
                taskId,
                ttl: null,
                status: "completed",
                statusMessage: "Task completed" as string,
                lastUpdatedAt: new Date().toISOString(),
              };
              this.dispatchTypedEvent("toolCallTaskUpdated", {
                taskId,
                task: completedTask,
                result: finalResult,
              });
              this.dispatchTypedEvent("requestorTaskUpdated", {
                taskId,
                task: completedTask,
                result: finalResult,
              });
            }
            break;

          case "error": {
            const errorMessage =
              message.error.message || "Task execution failed";
            error = new Error(errorMessage);
            if (taskId) {
              // A user-cancelled task surfaces here as a generic error; report
              // it as "cancelled" (not "failed") so the UI lands on the true
              // terminal state immediately, matching what a refresh would show
              // (#1455).
              const cancelled = this.cancelledTaskIds.has(taskId);
              // Consume the marker — task ids are single-use, so this keeps the
              // set from growing across a long session of cancellations (the
              // disconnect-clear stays the backstop for cancels whose task
              // completed before the cancel landed and never hit this path).
              this.cancelledTaskIds.delete(taskId);
              const terminalTask: TaskWithOptionalCreatedAt = {
                taskId,
                ttl: null,
                status: cancelled ? "cancelled" : "failed",
                statusMessage: cancelled
                  ? "Client cancelled task execution."
                  : errorMessage,
                lastUpdatedAt: new Date().toISOString(),
              };
              this.dispatchTypedEvent("toolCallTaskUpdated", {
                taskId,
                task: terminalTask,
                error: message.error,
              });
              this.dispatchTypedEvent("requestorTaskUpdated", {
                taskId,
                task: terminalTask,
                error: message.error,
              });
            }
            break;
          }
        }
      }

      // If we got an error, throw it
      if (error) {
        throw error;
      }

      // If we didn't get a result, something went wrong
      // This can happen if the task completed but result wasn't in the stream
      // Try to get it from the task result endpoint
      if (!finalResult && taskId) {
        try {
          finalResult = await this.client.request(
            { method: "tasks/result", params: { taskId } },
            CallToolResultSchema,
            this.getRequestOptions(), // no metadata for fallback
          );
        } catch (resultError) {
          throw new Error(
            `Tool call did not return a result: ${resultError instanceof Error ? resultError.message : String(resultError)}`,
          );
        }
      }
      if (!finalResult) {
        throw new Error("Tool call did not return a result");
      }

      const invocation: ToolCallInvocation = {
        toolName: tool.name,
        params: args,
        result: finalResult,
        timestamp,
        success: true,
        metadata,
      };

      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: tool.name,
        params: args,
        result: invocation.result,
        timestamp,
        success: true,
        metadata,
      });

      return invocation;
    } catch (error) {
      // Merge general metadata with tool-specific metadata for error case
      const callMetadata: Record<string, string> | undefined =
        generalMetadata || toolSpecificMetadata
          ? { ...(generalMetadata || {}), ...(toolSpecificMetadata || {}) }
          : undefined;

      const timestamp = new Date();
      const metadata = this.mergeMeta(callMetadata);

      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: tool.name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata,
      });

      throw error;
    }
  }

  /**
   * List available resources with pagination support (stateless; state managers hold the list).
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing resources array and optional nextCursor
   */
  async listResources(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ resources: Resource[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ListResourcesRequest["params"] = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.invokeMcpClient(() =>
      this.client!.request(
        { method: "resources/list", params },
        ListResourcesResultSchema,
        this.getRequestOptions(metadata?.progressToken),
      ),
    );
    return {
      resources: response.resources || [],
      nextCursor: response.nextCursor,
    };
  }

  /**
   * Aggregate ALL pages of `resources/list` via the SDK's high-level
   * cache-aware `client.listResources()`. See {@link listAllTools} for the
   * `cacheMode` semantics; this is the path the managed resource list uses on
   * refresh.
   */
  async listAllResources(options?: {
    cacheMode?: CacheMode;
    metadata?: Record<string, string>;
  }): Promise<{ resources: Resource[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const response = await this.invokeMcpClient(() =>
      this.client!.listResources(
        this.aggregateListParams(options?.metadata),
        this.getCacheableRequestOptions(options?.cacheMode),
      ),
    );
    return { resources: [...response.resources] };
  }

  /**
   * Read a resource by URI
   * @param uri Resource URI
   * @param metadata Optional metadata to include in the request
   * @returns Resource content
   */
  async readResource(
    uri: string,
    metadata?: Record<string, string>,
  ): Promise<ResourceReadInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ReadResourceRequest["params"] = {
      uri,
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
    };
    // MRTR-driven (#1704): a modern `resources/read` can return `input_required`
    // (embedding an elicitation/sampling request); the driver pauses at the
    // pending-request UI and retries with the answer. Legacy is a single round.
    const result = await this.invokeMcpClient(
      () =>
        this.requestWithInputRequired(
          "resources/read",
          params,
          ReadResourceResultSchema,
          this.getRequestOptions(metadata?.progressToken),
        ),
      { method: "resources/read" },
    );
    const invocation: ResourceReadInvocation = {
      result,
      timestamp: new Date(),
      uri,
      metadata: effectiveMeta,
    };
    this.dispatchTypedEvent("resourceContentChange", {
      uri,
      content: invocation,
      timestamp: invocation.timestamp,
    });
    return invocation;
  }

  /**
   * Read a resource from a template by expanding the template URI with parameters
   * This encapsulates the business logic of template expansion and associates the
   * loaded resource with its template in InspectorClient state
   * @param templateName The name/ID of the resource template
   * @param params Parameters to fill in the template variables
   * @param metadata Optional metadata to include in the request
   * @returns The resource content along with expanded URI and template name
   * @throws Error if template is not found or URI expansion fails
   */
  async readResourceFromTemplate(
    uriTemplate: string,
    params: Record<string, string>,
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplateReadInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    const uriTemplateString = uriTemplate;

    // Expand the template's uriTemplate using the provided params
    let expandedUri: string;
    try {
      const uriTemplate = new UriTemplate(uriTemplateString);
      expandedUri = uriTemplate.expand(params);
    } catch (error) {
      throw new Error(
        `Failed to expand URI template "${uriTemplate}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Always fetch fresh content: Call readResource with expanded URI
    const readInvocation = await this.readResource(expandedUri, metadata);

    // Create the template invocation object. Use the merged metadata recorded
    // by readResource so the template-level history matches what was sent.
    const invocation: ResourceTemplateReadInvocation = {
      uriTemplate: uriTemplateString,
      expandedUri,
      result: readInvocation.result,
      timestamp: readInvocation.timestamp,
      params,
      metadata: readInvocation.metadata,
    };

    this.dispatchTypedEvent("resourceTemplateContentChange", {
      uriTemplate: uriTemplateString,
      content: invocation,
      params,
      timestamp: invocation.timestamp,
    });

    return invocation;
  }

  /**
   * List resource templates with pagination support (stateless; state managers hold the list).
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing resourceTemplates array and optional nextCursor
   */
  async listResourceTemplates(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ resourceTemplates: ResourceTemplate[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ListResourceTemplatesRequest["params"] = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.invokeMcpClient(
      () =>
        this.client!.request(
          { method: "resources/templates/list", params },
          ListResourceTemplatesResultSchema,
          this.getRequestOptions(metadata?.progressToken),
        ),
      { method: "resources/templates/list" },
    );
    return {
      resourceTemplates: response.resourceTemplates || [],
      nextCursor: response.nextCursor,
    };
  }

  /**
   * Aggregate ALL pages of `resources/templates/list` via the SDK's high-level
   * cache-aware `client.listResourceTemplates()`. See {@link listAllTools} for
   * the `cacheMode` semantics; this is the path the managed resource-template
   * list uses on refresh.
   */
  async listAllResourceTemplates(options?: {
    cacheMode?: CacheMode;
    metadata?: Record<string, string>;
  }): Promise<{ resourceTemplates: ResourceTemplate[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const response = await this.invokeMcpClient(
      () =>
        this.client!.listResourceTemplates(
          this.aggregateListParams(options?.metadata),
          this.getCacheableRequestOptions(options?.cacheMode),
        ),
      { method: "resources/templates/list" },
    );
    return { resourceTemplates: [...response.resourceTemplates] };
  }

  /**
   * List available prompts with pagination support
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing prompts array and optional nextCursor
   */
  async listPrompts(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ prompts: Prompt[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ListPromptsRequest["params"] = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.invokeMcpClient(() =>
      this.client!.request(
        { method: "prompts/list", params },
        ListPromptsResultSchema,
        this.getRequestOptions(metadata?.progressToken),
      ),
    );
    return {
      prompts: response.prompts || [],
      nextCursor: response.nextCursor,
    };
  }

  /**
   * Aggregate ALL pages of `prompts/list` via the SDK's high-level
   * cache-aware `client.listPrompts()`. See {@link listAllTools} for the
   * `cacheMode` semantics; this is the path the managed prompt list uses on
   * refresh.
   */
  async listAllPrompts(options?: {
    cacheMode?: CacheMode;
    metadata?: Record<string, string>;
  }): Promise<{ prompts: Prompt[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const response = await this.invokeMcpClient(() =>
      this.client!.listPrompts(
        this.aggregateListParams(options?.metadata),
        this.getCacheableRequestOptions(options?.cacheMode),
      ),
    );
    return { prompts: [...response.prompts] };
  }

  /**
   * Get a prompt by name
   * @param name Prompt name
   * @param args Optional prompt arguments
   * @param metadata Optional metadata to include in the request
   * @returns Prompt content
   */
  async getPrompt(
    name: string,
    args?: Record<string, JsonValue>,
    metadata?: Record<string, string>,
  ): Promise<PromptGetInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    // Convert all arguments to strings for prompt arguments
    const stringArgs = args ? convertPromptArguments(args) : {};

    const effectiveMeta = this.mergeMeta(metadata);
    const params: GetPromptRequest["params"] = {
      name,
      arguments: stringArgs,
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
    };

    // MRTR-driven (#1704): a modern `prompts/get` can return `input_required`;
    // the driver pauses at the pending-request UI and retries with the answer.
    // Legacy is a single round.
    const result = await this.invokeMcpClient(
      () =>
        this.requestWithInputRequired(
          "prompts/get",
          params,
          GetPromptResultSchema,
          this.getRequestOptions(metadata?.progressToken),
        ),
      { method: "prompts/get", toolName: name },
    );

    const invocation: PromptGetInvocation = {
      result,
      timestamp: new Date(),
      name,
      params: Object.keys(stringArgs).length > 0 ? stringArgs : undefined,
      metadata: effectiveMeta,
    };

    this.dispatchTypedEvent("promptContentChange", {
      name,
      content: invocation,
      timestamp: invocation.timestamp,
    });

    return invocation;
  }

  /**
   * Request completions for a resource template variable or prompt argument
   * @param ref Resource template reference or prompt reference
   * @param argumentName Name of the argument/variable to complete
   * @param argumentValue Current (partial) value of the argument
   * @param context Optional context with other argument values
   * @param metadata Optional metadata to include in the request
   * @returns Completion result with values array
   * @throws Error if client is not connected or request fails (except MethodNotFound)
   */
  async getCompletions(
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context?: Record<string, string>,
    metadata?: Record<string, string>,
  ): Promise<{ values: string[]; total?: number; hasMore?: boolean }> {
    if (!this.client) {
      return { values: [] };
    }

    try {
      const effectiveMeta = this.mergeMeta(metadata);
      const params: CompleteRequest["params"] = {
        ref,
        argument: {
          name: argumentName,
          value: argumentValue,
        },
        ...(context ? { context: { arguments: context } } : {}),
        ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      };

      const response = await this.invokeMcpClient(
        () =>
          this.client!.complete(
            params,
            this.getRequestOptions(metadata?.progressToken),
          ),
        {
          method: "completion/complete",
          toolName: ref.type === "ref/prompt" ? ref.name : ref.uri,
        },
      );

      return {
        values: response.completion.values || [],
        total: response.completion.total,
        hasMore: response.completion.hasMore,
      };
    } catch (error) {
      // Handle MethodNotFound gracefully (server doesn't support completions)
      if (
        (error instanceof ProtocolError &&
          error.code === ProtocolErrorCode.MethodNotFound) ||
        (error instanceof Error &&
          (error.message.includes("Method not found") ||
            error.message.includes("does not support completions")))
      ) {
        return { values: [] };
      }

      // Re-throw other errors
      throw new Error(
        `Failed to get completions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Fetch server info (capabilities, serverInfo, instructions) from cached initialize response
   * This does not send any additional MCP requests - it just reads cached data
   * Always called on connect
   */
  private async fetchServerInfo(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      // Get server capabilities (cached from initialize response)
      this.capabilities = this.client.getServerCapabilities();
      this.dispatchTypedEvent("capabilitiesChange", this.capabilities);

      // Get server info (name, version) and instructions (cached from initialize response)
      this.serverInfo = this.client.getServerVersion();
      this.instructions = this.client.getInstructions();
      this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
      if (this.instructions !== undefined) {
        this.dispatchTypedEvent("instructionsChange", this.instructions);
      }

      // Era model (SEP §7.8): the SDK Client owns negotiation and exposes the
      // outcome. `getProtocolEra()` is populated for every era once connected —
      // a plain legacy connect reports `"legacy"`. `getDiscoverResult()` is
      // populated only when "auto"/"modern" actually probed server/discover.
      this.protocolEra = this.client.getProtocolEra();
      this.dispatchTypedEvent("protocolEraChange", this.protocolEra);
      this.discoverResult = this.client.getDiscoverResult();
      this.dispatchTypedEvent("discoverResultChange", this.discoverResult);

      // The SDK's negotiated-version accessor works for both eras (the
      // initialize handshake on legacy, the discover/pin on modern), so it
      // supersedes the older MessageTrackingTransport capture.
      this.protocolVersion = this.client.getNegotiatedProtocolVersion();
      this.dispatchTypedEvent("protocolVersionChange", this.protocolVersion);
    } catch {
      // Ignore errors in fetching server info
    }
  }

  private dispatchStderrLog(entry: StderrLogEntry): void {
    this.dispatchTypedEvent("stderrLog", entry);
  }

  private dispatchFetchRequest(entry: FetchRequestEntry): void {
    this.logger.info(
      {
        component: "InspectorClient",
        category: entry.category,
        fetchRequest: {
          url: entry.url,
          method: entry.method,
          headers: entry.requestHeaders,
          body: entry.requestBody ?? "[no body]",
        },
        fetchResponse: entry.error
          ? { error: entry.error }
          : {
              status: entry.responseStatus,
              statusText: entry.responseStatusText,
              headers: entry.responseHeaders,
              body: entry.responseBody,
            },
      },
      `${entry.category} fetch`,
    );
    this.dispatchTypedEvent("fetchRequest", entry);
  }

  private dispatchFetchRequestBodyUpdate(
    id: string,
    responseBody: string,
  ): void {
    this.dispatchTypedEvent("fetchRequestBodyUpdate", { id, responseBody });
  }

  /**
   * Get current session ID (from OAuth state authId)
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Set session ID (typically extracted from OAuth state)
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Dispatch saveSession so FetchRequestLogState (or other listeners) can persist.
   * Call before OAuth redirect; listeners use sessionStorage with this sessionId.
   */
  saveSession(): void {
    if (!this.sessionId) return;
    this.dispatchTypedEvent("saveSession", { sessionId: this.sessionId });
  }

  /**
   * Get current roots
   */
  getRoots(): Root[] {
    return this.roots !== undefined ? [...this.roots] : [];
  }

  /**
   * Set roots and notify server if it supports roots/listChanged
   * Note: This will enable roots capability if it wasn't already enabled
   */
  async setRoots(roots: Root[]): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    // Enable roots capability if not already enabled
    if (this.roots === undefined) {
      this.roots = [];
    }
    this.roots = [...roots];
    this.dispatchTypedEvent("rootsChange", this.roots);

    // Send notification to server - clients can send this notification to any server
    // The server doesn't need to advertise support for it
    try {
      await this.client.notification({
        method: "notifications/roots/list_changed",
      });
    } catch (error) {
      // Log but don't throw - roots were updated locally even if notification failed
      this.logger.error(
        { error },
        "Failed to send roots/list_changed notification",
      );
    }
  }

  /**
   * Get list of currently subscribed resource URIs
   */
  getSubscribedResources(): string[] {
    return Array.from(this.subscribedResources);
  }

  /**
   * Check if a resource is currently subscribed
   */
  isSubscribedToResource(uri: string): boolean {
    return this.subscribedResources.has(uri);
  }

  /**
   * Check if the server supports resource subscriptions
   */
  supportsResourceSubscriptions(): boolean {
    return this.capabilities?.resources?.subscribe === true;
  }

  /**
   * The negotiated protocol era once connected (SEP §7.8). Modern (2026-07-28)
   * connections manage resource subscriptions through a `subscriptions/listen`
   * stream instead of `resources/subscribe`; every other era is legacy.
   */
  private isModernEra(): boolean {
    return this.protocolEra === "modern";
  }

  /**
   * Current state of the modern-era `subscriptions/listen` stream (#1630).
   * `active: false` on the legacy era (there is no persistent stream).
   */
  getResourceSubscriptionStreamState(): ResourceSubscriptionStreamState {
    return this.modernStreamState;
  }

  private setModernStreamState(next: ResourceSubscriptionStreamState): void {
    this.modernStreamState = next;
    this.dispatchTypedEvent("resourceSubscriptionStreamChange", next);
  }

  private dispatchSubscriptionsChange(): void {
    this.dispatchTypedEvent(
      "resourceSubscriptionsChange",
      Array.from(this.subscribedResources),
    );
  }

  /**
   * The `subscriptions/listen` filter for the current modern subscriptions:
   * the subscribed URIs, plus the list-change opt-ins the Inspector already
   * tracks (config ∩ server capability) so the single stream also carries
   * list-change notifications — the spec models one listen stream for every
   * opted-in notification type (SEP §7.4).
   */
  private buildSubscriptionFilter(): SubscriptionFilter {
    const filter: SubscriptionFilter = {
      resourceSubscriptions: Array.from(this.subscribedResources),
    };
    if (
      this.listChangedNotifications.tools &&
      this.capabilities?.tools?.listChanged
    ) {
      filter.toolsListChanged = true;
    }
    if (
      this.listChangedNotifications.resources &&
      this.capabilities?.resources?.listChanged
    ) {
      filter.resourcesListChanged = true;
    }
    if (
      this.listChangedNotifications.prompts &&
      this.capabilities?.prompts?.listChanged
    ) {
      filter.promptsListChanged = true;
    }
    return filter;
  }

  /**
   * (Re-)establish the modern `subscriptions/listen` stream to match the current
   * `subscribedResources` set (#1630). Because the stream is not resumable,
   * every filter change re-lists: the existing stream is closed and a fresh
   * `listen()` opened. With no subscribed URIs the stream is left closed.
   *
   * `modernListenGeneration` guards against races — if a newer refresh starts
   * while this one awaits its acknowledgement, the just-opened stream is
   * discarded rather than overwriting the newer one.
   */
  /** Cancel a pending reconnect re-listen, if any (#1630). */
  private clearModernReconnectTimer(): void {
    if (this.modernReconnectTimer !== undefined) {
      clearTimeout(this.modernReconnectTimer);
      this.modernReconnectTimer = undefined;
    }
  }

  private async refreshModernSubscription(
    fromReconnect = false,
  ): Promise<void> {
    if (!this.client) return;
    // A user-initiated (subscribe/unsubscribe) refresh is a clean slate: clear
    // any pending reconnect and reset the backoff run so the next drop starts
    // from the base delay.
    if (!fromReconnect) {
      this.clearModernReconnectTimer();
      this.modernReconnectAttempts = 0;
    }
    const generation = ++this.modernListenGeneration;

    // Tear down the current stream before opening a replacement (re-listen).
    const previous = this.modernSubscription;
    this.modernSubscription = null;
    if (previous) {
      await previous.close().catch(() => {});
    }

    // Nothing subscribed → keep the stream closed.
    if (this.subscribedResources.size === 0) {
      this.setModernStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
      return;
    }

    const subscription = await this.client.listen(
      this.buildSubscriptionFilter(),
      this.getRequestOptions(),
    );

    // A newer refresh superseded us while awaiting the ack — discard this one.
    if (generation !== this.modernListenGeneration) {
      await subscription.close().catch(() => {});
      return;
    }

    this.modernSubscription = subscription;
    this.setModernStreamState({
      active: true,
      status: "acknowledged",
      honoredUris: subscription.honoredFilter.resourceSubscriptions ?? [],
    });

    // Observe termination; an unexpected drop reconnects by re-listing.
    void subscription.closed.then((reason) =>
      this.onModernSubscriptionClosed(subscription, reason, generation),
    );
  }

  /**
   * Handle termination of a modern listen stream (#1630). `"remote"` is an
   * unexpected drop — reconnect by re-listing (no resumability, so the re-listen
   * re-establishes the full filter). `"local"` (we closed it) and `"graceful"`
   * (server shutdown) are expected and leave the stream ended.
   */
  private onModernSubscriptionClosed(
    subscription: McpSubscription,
    reason: "local" | "graceful" | "remote",
    generation: number,
  ): void {
    // Ignore a superseded stream (a newer refresh already replaced it).
    if (
      generation !== this.modernListenGeneration ||
      this.modernSubscription !== subscription
    ) {
      return;
    }
    this.modernSubscription = null;

    const shouldReconnect =
      reason === "remote" &&
      !isTerminalStatus(this.status) &&
      this.subscribedResources.size > 0;
    if (!shouldReconnect) {
      this.setModernStreamState({
        active: false,
        status: "ended",
        honoredUris: [],
      });
      return;
    }

    // Reconnect-by-re-listen with capped exponential backoff (#1630). A drop
    // long after the previous one starts the run over; a burst of rapid drops
    // escalates the delay and, past the cap, gives up rather than loop forever.
    const now = Date.now();
    if (now - this.modernLastReconnectMs > MODERN_RECONNECT_RESET_MS) {
      this.modernReconnectAttempts = 0;
    }
    this.modernLastReconnectMs = now;
    this.modernReconnectAttempts += 1;

    if (this.modernReconnectAttempts > MODERN_RECONNECT_MAX_ATTEMPTS) {
      // Too many rapid reconnects — stop and mark ended. Re-subscribing (a user
      // action) resets the backoff and re-establishes the stream.
      this.setModernStreamState({
        active: this.subscribedResources.size > 0,
        status: "ended",
        honoredUris: [],
      });
      return;
    }

    this.setModernStreamState({
      active: true,
      status: "reconnecting",
      honoredUris: [],
    });
    const delay = Math.min(
      MODERN_RECONNECT_BASE_MS * 2 ** (this.modernReconnectAttempts - 1),
      MODERN_RECONNECT_MAX_MS,
    );
    this.clearModernReconnectTimer();
    this.modernReconnectTimer = setTimeout(() => {
      this.modernReconnectTimer = undefined;
      // Disconnect/unsubscribe may have raced the timer — bail if the reconnect
      // is no longer wanted.
      if (isTerminalStatus(this.status) || this.subscribedResources.size === 0) {
        return;
      }
      this.refreshModernSubscription(true).catch(() => {
        // Re-listen failed; leave the stream ended so the UI stops showing
        // "reconnecting" for a stream that isn't coming back on its own.
        this.setModernStreamState({
          active: this.subscribedResources.size > 0,
          status: "ended",
          honoredUris: [],
        });
      });
    }, delay);
  }

  /**
   * Subscribe to a resource to receive update notifications.
   *
   * Legacy era: sends `resources/subscribe`. Modern era (2026-07-28): adds the
   * URI to the `subscriptions/listen` filter and re-lists (#1630). In both eras
   * `notifications/resources/updated` is delivered through the same handler.
   *
   * @param uri - The URI of the resource to subscribe to
   * @throws Error if client is not connected or server doesn't support subscriptions
   */
  async subscribeToResource(uri: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    if (!this.supportsResourceSubscriptions()) {
      throw new Error("Server does not support resource subscriptions");
    }
    try {
      if (this.isModernEra()) {
        // Already subscribed → the filter is unchanged, so skip the re-listen
        // (which would needlessly tear down and reopen the server stream).
        if (this.subscribedResources.has(uri)) return;
        this.subscribedResources.add(uri);
        try {
          await this.refreshModernSubscription();
        } catch (error) {
          // Roll back the optimistic add so the set stays consistent with the
          // (unchanged) stream filter.
          this.subscribedResources.delete(uri);
          throw error;
        }
      } else {
        await this.client.subscribeResource({ uri }, this.getRequestOptions());
        this.subscribedResources.add(uri);
      }
      this.dispatchSubscriptionsChange();
    } catch (error) {
      throw new Error(
        `Failed to subscribe to resource: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Unsubscribe from a resource.
   *
   * Legacy era: sends `resources/unsubscribe`. Modern era: drops the URI from
   * the `subscriptions/listen` filter and re-lists (closing the stream once the
   * last URI is removed) (#1630).
   *
   * @param uri - The URI of the resource to unsubscribe from
   * @throws Error if client is not connected
   */
  async unsubscribeFromResource(uri: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      if (this.isModernEra()) {
        // Not subscribed → the filter is unchanged, so skip the re-listen.
        if (!this.subscribedResources.delete(uri)) return;
        // The removal is the user's intent; keep it even if the re-listen fails
        // (the stale URI simply lingers in the server's honored filter).
        this.dispatchSubscriptionsChange();
        await this.refreshModernSubscription();
      } else {
        await this.client.unsubscribeResource(
          { uri },
          this.getRequestOptions(),
        );
        this.subscribedResources.delete(uri);
        this.dispatchSubscriptionsChange();
      }
    } catch (error) {
      throw new Error(
        `Failed to unsubscribe from resource: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ============================================================================
  // OAuth Support (delegated to oauthManager)
  // ============================================================================

  private ensureOAuthManager(): OAuthManager {
    if (!this.oauthManager) {
      throw new Error("OAuth not configured. Call setOAuthConfig() first.");
    }
    return this.oauthManager;
  }

  /**
   * Get server URL from transport config (full URL including path, for OAuth discovery)
   */
  private getServerUrl(): string {
    if (
      this.transportConfig.type === "sse" ||
      this.transportConfig.type === "streamable-http"
    ) {
      return this.transportConfig.url;
    }
    // Stdio transports don't have a URL - OAuth not applicable
    throw new Error(
      "OAuth is only supported for HTTP-based transports (SSE, streamable-http)",
    );
  }

  /**
   * Set OAuth configuration
   */
  setOAuthConfig(config: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    scope?: string;
  }): void {
    if (!this.oauthManager) {
      throw new Error(
        "OAuth config must be set at creation. Pass oauth in constructor.",
      );
    }
    this.oauthManager.setOAuthConfig(config);
  }

  /**
   * Initiates OAuth flow. Can be called directly by user or automatically
   * triggered by 401 errors.
   */
  async authenticate(): Promise<URL | undefined> {
    return this.ensureOAuthManager().authenticate();
  }

  /**
   * Satisfy a mid-session auth challenge (token refresh, step-up, or interactive re-auth).
   */
  async handleAuthChallenge(
    challenge: AuthChallenge,
    options?: HandleAuthChallengeOptions,
  ): Promise<AuthChallengeOutcome> {
    return this.ensureOAuthManager().handleAuthChallenge(challenge, options);
  }

  /**
   * Re-read OAuth storage and test whether a challenge is already satisfied.
   * See {@link OAuthManager.checkAuthChallengeSatisfied}.
   */
  async checkAuthChallengeSatisfied(
    challenge: AuthChallenge,
  ): Promise<boolean> {
    return this.ensureOAuthManager().checkAuthChallengeSatisfied(challenge);
  }

  /**
   * Push recovered OAuth auth state to the remote backend (same MCP session).
   */
  async pushRemoteAuthState(): Promise<void> {
    if (!(this.baseTransport instanceof RemoteClientTransport)) {
      return;
    }
    await this.baseTransport.pushAuthState();
  }

  /**
   * Handle an ambient (SSE) auth challenge when no command-scoped send is active.
   * Recovers session tokens on the remote backend; does not retry RPCs.
   */
  async handleAmbientAuthChallenge(challenge: AuthChallenge): Promise<void> {
    const key = this.ambientAuthChallengeKey(challenge);
    const existing = this.ambientAuthChallengeInFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.runAmbientAuthChallenge(challenge);
    this.ambientAuthChallengeInFlight.set(key, promise);
    try {
      await promise;
    } finally {
      if (this.ambientAuthChallengeInFlight.get(key) === promise) {
        this.ambientAuthChallengeInFlight.delete(key);
      }
    }
  }

  private async runAmbientAuthChallenge(
    challenge: AuthChallenge,
  ): Promise<void> {
    try {
      this.dispatchTypedEvent("authChallengeAmbient", { challenge });
      const oauthManager = this.oauthManager;
      if (!oauthManager) {
        return;
      }

      const outcome = await oauthManager.handleAuthChallenge(challenge);
      if (outcome.kind === "satisfied") {
        if (this.baseTransport instanceof RemoteClientTransport) {
          await this.pushRemoteAuthState();
        } else {
          await this.reconnectAfterAuthRecovery();
        }
        this.dispatchTypedEvent("authChallengeRecovered", { challenge });
      } else if (outcome.kind === "step_up_confirm") {
        this.dispatchTypedEvent("authChallengeInteractive", {
          challenge: outcome.challenge,
          authorizationUrl: EMA_STEP_UP_PENDING_URL,
        });
      } else if (outcome.kind === "interactive") {
        this.dispatchTypedEvent("authChallengeInteractive", {
          challenge: outcome.challenge,
          authorizationUrl: outcome.authorizationUrl,
        });
      } else {
        this.dispatchTypedEvent("oauthError", { error: outcome.error });
      }
    } catch (error) {
      this.dispatchTypedEvent("oauthError", {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private ambientAuthChallengeKey(challenge: AuthChallenge): string {
    const requiredScopes = [...(challenge.requiredScopes ?? [])]
      .sort()
      .join(" ");
    const authorizationScopes = [...(challenge.authorizationScopes ?? [])]
      .sort()
      .join(" ");
    return `${challenge.reason}:${requiredScopes}:${authorizationScopes}`;
  }

  /**
   * Full disconnect + reconnect after ambient auth recovery on direct transports.
   */
  private async reconnectAfterAuthRecovery(): Promise<void> {
    await this.disconnect().catch(() => {});
    await this.dropCachedTransport();
    await this.connect();
  }

  /** Direct (non-remote) OAuth transports recover via fetch intercept + handleAuthChallenge. */
  private usesDirectAuthRecovery(): boolean {
    return this.directAuthRecovery && this.directAuthRecoveryActive === true;
  }

  private async withDirectAuthRecovery<T>(
    operation: () => Promise<T>,
    context?: { method?: string; toolName?: string },
    attempt = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= 1 || !this.usesDirectAuthRecovery()) {
        throw err;
      }
      if (!isAuthChallengeError(err)) {
        throw err;
      }
      const challenge = parseAuthChallengeFromError(err, context);
      /* v8 ignore next 3 -- defensive: parseAuthChallengeFromError shares isAuthChallengeError's checks, so it always returns a truthy challenge once that guard passes */
      if (!challenge) {
        throw err;
      }

      if (context?.method || context?.toolName) {
        this.dispatchTypedEvent("authChallengeCommand", { challenge });
      } else {
        this.dispatchTypedEvent("authChallengeAmbient", { challenge });
      }
      const outcome = await this.handleAuthChallenge(challenge);
      if (outcome.kind === "satisfied") {
        // Reconnect aborts activeToolCallAbortController; clear it so callTool
        // retries are not immediately rejected with "Disconnected".
        if (this.activeToolCallAbortController) {
          this.activeToolCallAbortController = undefined;
        }
        await this.reconnectAfterAuthRecovery();
        this.dispatchTypedEvent("authChallengeRecovered", { challenge });
        return this.withDirectAuthRecovery(operation, context, attempt + 1);
      }
      if (outcome.kind === "step_up_confirm") {
        throw new AuthRecoveryRequiredError(
          EMA_STEP_UP_PENDING_URL,
          outcome.challenge,
          { emaStepUpConfirm: true },
        );
      }
      if (outcome.kind === "interactive") {
        throw new AuthRecoveryRequiredError(
          outcome.authorizationUrl,
          outcome.challenge,
        );
      }
      this.dispatchTypedEvent("oauthError", { error: outcome.error });
      throw outcome.error;
    }
  }

  private async invokeMcpClient<T>(
    operation: () => Promise<T>,
    context?: { method?: string; toolName?: string },
  ): Promise<T> {
    if (!this.usesDirectAuthRecovery()) {
      return operation();
    }
    return this.withDirectAuthRecovery(operation, context);
  }

  /**
   * Completes OAuth flow with authorization code from the redirect callback.
   * Direct transports reconnect after token exchange so the live MCP session
   * picks up the new Bearer token (mirrors silent recovery reconnect).
   */
  async completeOAuthFlow(
    authorizationCode: string,
    iss?: string,
  ): Promise<void> {
    await this.ensureOAuthManager().completeOAuthFlow(authorizationCode, iss);
    if (this.usesDirectAuthRecovery()) {
      await this.reconnectAfterAuthRecovery();
    }
  }

  /**
   * Navigate to the authorization server for interactive recovery.
   */
  async beginInteractiveAuthorization(authorizationUrl: URL): Promise<void> {
    return this.ensureOAuthManager().beginInteractiveAuthorization(
      authorizationUrl,
    );
  }

  /** Remote Hono session id when using {@link RemoteClientTransport}. */
  getRemoteBackendSessionId(): string | undefined {
    if (this.baseTransport instanceof RemoteClientTransport) {
      return this.baseTransport.getRemoteBackendSessionId();
    }
    return undefined;
  }

  /**
   * Finish OAuth after a full-page redirect and reconnect (or reattach) the MCP session.
   */
  async resumeAfterOAuth(
    authorizationCode: string,
    options?: { remoteSessionId?: string; iss?: string },
  ): Promise<void> {
    await this.completeOAuthFlow(authorizationCode, options?.iss);

    const remoteSessionId = options?.remoteSessionId;
    const transport = this.baseTransport;

    if (remoteSessionId && transport instanceof RemoteClientTransport) {
      try {
        await transport.attachToSession(remoteSessionId);
        await transport.pushAuthState();
        if (this.status !== "connected") {
          await this.connect();
        }
        return;
      } catch {
        // Session expired during OAuth round trip — fall back to fresh connect.
      }
    }

    if (this.status !== "connected") {
      await this.connect();
    }
  }

  /**
   * Gets current OAuth tokens (if authorized)
   */
  async getOAuthTokens(): Promise<OAuthTokens | undefined> {
    if (!this.oauthManager) {
      return undefined;
    }
    return this.oauthManager.getOAuthTokens();
  }

  /**
   * Clears OAuth tokens and client information
   */
  async clearOAuthTokens(): Promise<void> {
    await this.oauthManager?.clearOAuthTokens();
  }

  /**
   * Checks if client is currently OAuth authorized
   */
  async isOAuthAuthorized(): Promise<boolean> {
    if (!this.oauthManager) {
      return false;
    }
    return this.oauthManager.isOAuthAuthorized();
  }

  /**
   * In-memory OAuth flow snapshot. Undefined when no flow has run on this
   * client instance; use {@link getOAuthState} for persisted authorization state.
   */
  getOAuthFlowState(): OAuthFlowState | undefined {
    return this.oauthManager?.getOAuthFlowState();
  }

  /** Current step when an OAuth flow is active. */
  getOAuthFlowStep(): OAuthStep | undefined {
    return this.oauthManager?.getOAuthFlowStep();
  }

  /**
   * Persisted OAuth authorization snapshot for this HTTP server (storage +
   * config). Undefined for stdio transports or when OAuth is not configured.
   */
  async getOAuthState(): Promise<OAuthConnectionState | undefined> {
    if (!this.isHttpOAuthConfig() || !this.oauthManager) {
      return undefined;
    }
    return this.oauthManager.getOAuthState();
  }
}
