import { Client } from "@modelcontextprotocol/client";
// The protocol's own schemas for the reserved `_meta` members, so the client
// validates against the SDK rather than a restatement of it that can drift.
import {
  ProgressTokenSchema,
  RequestMetaSchema,
} from "@modelcontextprotocol/core";
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
  ExcludedTool,
  RequestMetadata,
} from "./types.js";
import {
  scanXMcpHeaderDeclarations,
  mcpParamHeadersForTool,
} from "../json/xMcpHeader.js";
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
  INACTIVE_SUBSCRIPTION_STREAM_STATE,
  isTerminalStatus,
  resolveModernLogLevel,
} from "./types.js";
import { cleanRoots } from "./serverList.js";
import {
  isNeverAcknowledgedSubscriptionClose,
  subscriptionFailureMessage,
  NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE,
} from "./subscriptionAck.js";
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
  JSONRPCMessage,
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
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  RELATED_TASK_META_KEY,
} from "@modelcontextprotocol/client";
import {
  TASKS_EXTENSION_KEY,
  MODERN_TASK_HANDLE_META,
  MODERN_PROTOCOL_VERSION,
  ModernGetTaskResultSchema,
  ModernUpdateTaskResultSchema,
  ModernCancelTaskResultSchema,
  normalizeModernTask,
  readInputRequests,
  isModernCreateTaskResult,
  type ModernDetailedTask,
} from "./modernTaskSchemas.js";
import { buildClientExtensions } from "./extensions.js";
import {
  GetSkillResultSchema,
  ListSkillsResultSchema,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  type SkillEntry,
} from "./skillsSchemas.js";
import { getSkillsExtension, type SkillsExtensionSupport } from "./skills.js";
import {
  getElicitationUiResourceUri,
  isFormElicitation,
  supportsAppElicitation,
  validateAppElicitResult,
  type AppElicitationRenderer,
} from "./appElicitation.js";
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
  // Per-primitive item schemas — the salvage fallback validates a list's
  // entries one at a time with these when the whole-result parse rejects
  // (#1909, see `listAllSalvaging`). Tools go through `toolItemSchemaForEra`
  // instead, since the neutral schema is looser than the negotiated era's.
  ResourceSchema,
  ResourceTemplateSchema,
  PromptSchema,
} from "@modelcontextprotocol/core";
import type { ClientResult } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { z } from "zod/v4";
import { validateToolOutput } from "./toolOutputValidation.js";
import {
  LIST_MAX_PAGES,
  ModernResultEnvelopeSchema,
  isSalvageableRejection,
  listPaginationExceeded,
  toolItemSchemaForEra,
  nextCursorOf,
  lenientListPageSchema,
  rawItemsOf,
  salvageListItems,
  summarizeMalformed,
  type MalformedListItem,
} from "./listSalvage.js";
import { TasksListChangedNotificationSchema } from "./taskNotificationSchemas.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import { expandUriTemplateStrict } from "./uriTemplate.js";
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
  findNestedAuthError,
  isAuthChallengeError,
  isConnectAuthRecoveryError,
  parseAuthChallengeFromError,
  type AuthChallenge,
  type AuthChallengeOutcome,
  type HandleAuthChallengeOptions,
} from "../auth/challenge.js";
import { withOAuthEndpointOverrides } from "../auth/endpointOverrides.js";
import { withRfc8414OidcCompat } from "../auth/oidcDiscoveryCompat.js";
import type { TokenRevocationOutcome } from "../auth/revocation.js";
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
  /**
   * Aborted when the task reaches a terminal state some way other than the
   * user answering — a `tasks/cancel`, or session teardown. Whatever is
   * collecting the answer (the native pending-request entry, or an app-rendered
   * elicitation and its bridge) is torn down from this, so a cancelled task
   * cannot leave a modal on screen waiting for an answer nothing will read.
   */
  abort: AbortController;
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
 * Close a modern listen stream best-effort, absorbing both failure modes a
 * third-party `close()` can produce: a rejected promise and a synchronous
 * throw. All three stream closes go through here, and every one of them has
 * already dropped its reference to the stream — so in each case an escaping
 * failure abandons a stream that may still be open on the server. What it does
 * *besides* that differs per site, because the shape of the call does:
 *
 * - `resetSubscriptionStream` — fire-and-forget (`void`), and the last statement
 *   of the method. Because this helper is `async`, even a synchronous throw
 *   becomes a rejection of the promise it returns, which the `void` then drops:
 *   the caller is unaffected, and the harm is an *unhandled rejection* — fatal
 *   to a Node process by default, a console error in the browser. That, not
 *   skipped teardown, is what the wrapping buys at this site.
 * - `refreshModernSubscription`'s re-listen close — awaited, with the
 *   replacement `listen()` after it, so an escaping failure skips the re-listen
 *   and leaves a non-empty subscription set with no stream. On the reconnect
 *   caller it is instead absorbed into the backoff run and retried.
 * - the superseded-generation discard — awaited, but `return` follows, so
 *   nothing local is skipped; the failure only propagates out of
 *   `refreshModernSubscription` to whichever caller a newer refresh had already
 *   superseded. Self-healing on the reconnect path; on the two user-initiated
 *   paths it is a report of a failure that did not happen — for
 *   `unsubscribeFromResource`, whose removal is kept regardless, a "Failed to
 *   unsubscribe" for an unsubscribe that stuck. Both of those gate their
 *   failure handling on still owning the re-listen, so a superseded call
 *   reports its error without editing a filter or a badge that is no longer
 *   its own (see `subscribeToResource`'s catch for the reasoning).
 *
 * Note what the generation bump proves in that last case is that a newer
 * refresh had *started*, not that it succeeded — it may yet fail at its own
 * `listen()`, making an escaping failure here a second one rather than a
 * redundant one.
 *
 * Wrapped identically all the same, so the rule is one rule (#1630, #1797).
 */
async function closeSubscriptionBestEffort(
  subscription: Pick<McpSubscription, "close">,
): Promise<void> {
  try {
    await subscription.close();
  } catch {
    // Best-effort: there is nothing to do about a stream that won't close.
  }
}

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
  generalMetadata?: RequestMetadata;
  toolSpecificMetadata?: RequestMetadata;
  taskOptions?: { ttl?: number };
  options?: { skipOutputValidation?: boolean };
}

// Backoff for reconnect-by-re-listen on the modern `subscriptions/listen` stream
// (#1630). A `"remote"` drop schedules a re-listen after a capped exponential
// delay (based on the count of *consecutive failed* re-lists) so a flapping
// server can't spin a tight zero-delay loop; a successful acknowledgement resets
// the count, and past the cap we give up (mark the stream ended) rather than
// retry a persistently-failing re-list forever.
/**
 * A one-word name for a JSON value's type, for diagnostics that must not
 * disclose the value itself.
 */
function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Whether a `_meta.progressToken` value is one the protocol allows.
 *
 * Delegates to the SDK's own `ProgressTokenSchema` rather than restating it.
 * A hand-rolled check drifts: this was `Number.isInteger` until review pointed
 * out that zod 4's `.int()` rejects anything past `Number.MAX_SAFE_INTEGER`,
 * so an unsafe integer passed here and was rejected by the server instead.
 */
function isProgressToken(value: unknown): value is ProgressToken {
  return ProgressTokenSchema.safeParse(value).success;
}

/**
 * Drop the reserved `_meta` members whose value the protocol will not accept.
 *
 * Most of `_meta` is arbitrary JSON (#1910), but a few keys are **reserved**
 * and carry their own schema — `progressToken` (a string or a safe integer;
 * zod's `.int()` rejects anything past `Number.MAX_SAFE_INTEGER`) and
 * `io.modelcontextprotocol/related-task` (`{ taskId: string }`) in the pinned
 * SDK. Before the widening every value was a string, so only `progressToken`
 * could even be wrong; now any of them can, and one bad reserved member makes a
 * conforming server reject the **whole request** rather than ignore the key.
 *
 * Validated with the SDK's `RequestMetaSchema` instead of a hand-maintained
 * list, which is the point: the schema is loose, so unknown keys pass through
 * untouched, and a member the SDK constrains in a later release is covered here
 * without anyone remembering to add it. Zod reports the offending top-level key
 * as `issue.path[0]`, so only that member is removed — siblings survive, and
 * the request stays well-formed because every reserved member is optional.
 */
function dropInvalidReservedMeta(
  meta: RequestMetadata,
  logger: InspectorLogger,
): RequestMetadata {
  const result = RequestMetaSchema.safeParse(meta);
  if (result.success) return meta;

  const cleaned = { ...meta };
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || !(key in cleaned)) continue;
    // The key and the reason, never the value: `_meta` can carry credentials,
    // and this logger is persisted by real clients (the TUI writes it to
    // `~/.mcp-inspector/auth.log`).
    logger.warn(
      { key, received: describeJsonType(cleaned[key]) },
      "Dropping reserved `_meta` member — it does not match the protocol schema.",
    );
    delete cleaned[key];
  }
  return cleaned;
}

const MODERN_RECONNECT_BASE_MS = 500;
const MODERN_RECONNECT_MAX_MS = 15_000;
const MODERN_RECONNECT_MAX_ATTEMPTS = 8;

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
  // Correlation for `markResponseRejected` (#1953): the method of each
  // outbound request still awaiting a response, and — once one is answered —
  // the id of the most recently answered request per method. Entries are
  // dropped as responses arrive, so this holds at most one id per method
  // rather than growing with the session.
  private outboundRequestMethods = new Map<string | number, string>();
  private lastAnsweredRequestByMethod = new Map<string, string | number>();
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
  private readonly sample: boolean;
  private readonly elicit: boolean | { form?: boolean; url?: boolean };
  private progress: boolean;
  private resetTimeoutOnProgress: boolean;
  private requestTimeout: number | undefined;
  private defaultMetadata: RequestMetadata | undefined;
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
  // Tools the SDK excludes from `tools/list` for invalid `x-mcp-header`
  // annotations (SEP-2243), recomputed on every aggregate tools refresh and
  // surfaced so the Tools tab can show why a tool vanished (#1632).
  private excludedTools: ExcludedTool[] = [];
  // Entries the Inspector dropped from a list result because they failed the
  // spec schema for that primitive, keyed by list method. Populated only by the
  // salvage fallback in `listAllSalvaging` — empty against a conforming server
  // (#1909).
  private malformedListItems = new Map<string, MalformedListItem[]>();
  // The capabilities this Inspector client advertises to the server during the
  // initialize handshake. Built once in setupClient() and snapshotted here so
  // UI surfaces (Server Info modal) can display them without poking at the
  // SDK Client's private state.
  private clientCapabilities: ClientCapabilities = {};
  // The client identity ({name, version}) passed to the SDK Client. Reused to
  // build the modern per-request envelope for raw tasks/* requests.
  private clientInfo: Implementation;
  // Sampling requests
  private pendingSamples: SamplingCreateMessage[] = [];
  // Elicitation requests
  private pendingElicitations: ElicitationCreateMessage[] = [];
  // Roots (undefined means roots capability not enabled, empty array means enabled but no roots)
  private roots: Root[] | undefined;
  /**
   * Whether `capabilities.roots` was advertised at `initialize`, read off the
   * capability object actually sent rather than re-derived from the constructor
   * option. Fixed for the client's lifetime, because the capability is
   * negotiated at construction and the SDK refuses `registerCapabilities` after
   * connect.
   *
   * The `roots/list` registration gates on *this*, not on `this.roots`, which
   * `setRoots()` can make defined later: the SDK throws "Client does not support
   * roots capability" from `setRequestHandler` when the capability was never
   * advertised, and that throw would land before the handshake on every
   * subsequent `connect()` — wedging the client permanently (#1797).
   */
  private readonly rootsCapabilityAdvertised: boolean;
  /**
   * Whether `capabilities.elicitation` was advertised, on the same terms as
   * {@link rootsCapabilityAdvertised}. Not the same question as `this.elicit`
   * being truthy: `{}` / `{ form: false, url: false }` are valid options that
   * enable no mode, so nothing is advertised — and registering
   * `elicitation/create` anyway throws "Client does not support elicitation
   * capability" before the handshake, leaving the client unable to connect
   * at all (#1797).
   */
  private readonly elicitationCapabilityAdvertised: boolean;
  /** As above, for `capabilities.sampling`. */
  private readonly samplingCapabilityAdvertised: boolean;
  /** As above, for `capabilities.tasks` (the receiver-side `tasks/*` polls). */
  private readonly tasksCapabilityAdvertised: boolean;
  /** As above, for `capabilities.elicitation.url` (the URL-mode completion). */
  private readonly urlElicitationCapabilityAdvertised: boolean;
  /**
   * As above, for `capabilities.roots.listChanged` — the predicate the SDK
   * asserts before letting us *send* `roots/list_changed`, which is narrower
   * than the `capabilities.roots` presence it asserts before letting us
   * *register* `roots/list`. They coincide today (roots are only ever
   * advertised as `{ listChanged: true }`), but reading each assertion's own
   * predicate is what keeps a future conditional advertisement from silently
   * un-gating one of them.
   */
  private readonly rootsListChangedCapabilityAdvertised: boolean;
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
  // is not resumable). `null` on the legacy era, and on the modern era whenever
  // the filter is empty — which is *not* the same as "no URI subscribed": the
  // stream also carries the list-change opt-ins, so a tools-only server opens it
  // with no subscriptions at all (#1920).
  private modernSubscription: McpSubscription | null = null;
  // Monotonic guard so a stale re-list/reconnect (whose `listen()` or `closed`
  // resolves after a newer refresh already started) can detect it lost the race
  // and bail without clobbering the current stream.
  private modernListenGeneration = 0;
  // Last dispatched modern stream state; `active: false` on the legacy era.
  private modernStreamState: ResourceSubscriptionStreamState =
    INACTIVE_SUBSCRIPTION_STREAM_STATE;
  // Reconnect-by-re-listen backoff state (#1630): the count of consecutive
  // *failed* re-lists (reset to 0 on any successful acknowledgement) and the
  // pending re-listen timer.
  private modernReconnectAttempts = 0;
  private modernReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // Set when the last `listen()` was rejected because the server answered it
  // with a bare graceful-closure result instead of acknowledging (#2097). That
  // condition is deterministic, so the reconnect machinery must not treat it as
  // a drop to retry; the flag is what carries the distinction from the rejection
  // site to the two failure handlers. Cleared by any user-initiated refresh (a
  // subscribe/unsubscribe is a fresh attempt, and the server may have changed).
  private modernNeverAcknowledged = false;
  // Task ids the user explicitly cancelled. A cancel makes the in-flight
  // `callToolStream` reject with a generic -32603 error, which the stream's
  // error path would otherwise report as a *failed* task — flashing "failed"
  // in the UI until a refresh fetches the server's true "cancelled" state.
  // Recording the id lets that path label the terminal task "cancelled"
  // instead, so it lands in the right state immediately (#1455). Cleared on
  // disconnect.
  private cancelledTaskIds: Set<string> = new Set();
  // Per-task abort controllers for a modern task paused at `input_required`.
  // While the poll loop blocks on the pending elicitation (the modal), the tool
  // call's own abort path isn't in play — so `cancelRequestorTask` aborts this
  // controller to reject the pending request, close the modal, and let the poll
  // observe the cancellation. Keyed by taskId; created/removed by the poll loops.
  private taskInputAbortControllers = new Map<string, AbortController>();
  // Pending raw-wire requests (modern tasks/* — see rawWireRequest). Keyed by a
  // string JSON-RPC id we mint; the SDK Client only mints numeric ids, so ours
  // never collide with (or reach) it. Resolved by the transport's
  // consume-response hook and rejected on disconnect.
  private pendingRawWireRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private rawWireRequestCounter = 0;
  // Abort controller for the in-flight ordinary (non-task) tool call. Aborting
  // it hands the SDK the MCP cancellation flow for that request and rejects the
  // pending call, which `callTool` surfaces as a `ToolCallCancelledError`. Which
  // signal reaches the server is the transport's business, not ours: a
  // per-request-stream transport on a 2026-era connection has that request's
  // stream aborted, and everything else gets `notifications/cancelled` (#2140).
  // Undefined when no ordinary call is in flight.
  // Task-augmented calls have a server-side task and are cancelled via
  // `cancelRequestorTask` instead, so they don't use this (#1458).
  private activeToolCallAbortController?: AbortController;
  // Receiver tasks (server-initiated: server sends createMessage/elicit with params.task, server polls us)
  private readonly receiverTasks: boolean;
  // Per-extension advertise overrides (#1738); undefined key falls back to the
  // registry default in ADVERTISABLE_EXTENSIONS.
  private readonly advertisedExtensions?: Record<string, boolean>;
  /**
   * Host-supplied renderer for app-rendered form elicitations (#1854), or
   * undefined on a client that cannot host MCP Apps. Its presence is what
   * advertises the nested MCP Apps `elicitation` capability, so this is the one
   * fact both the advertisement and the routing gate read.
   */
  private readonly appElicitationRenderer?: AppElicitationRenderer;

  /**
   * Monotonic counter behind the request-scoped id handed to the renderer. The
   * association MUST be per request (a map keyed by this id owns the resource
   * URI, renderer instance and promise on the host side) so two concurrent
   * elicitations cannot resolve through each other's bridges.
   */
  private appElicitationSeq = 0;
  /**
   * Per-instance prefix for {@link appElicitationSeq}.
   *
   * A counter alone is not enough: a host may hold ONE renderer across
   * replacement clients (the web client rebuilds its `InspectorClient` on a
   * settings change), and every fresh instance would otherwise mint
   * `app-elicitation-1` for its first request. Settling that id would then
   * resolve — or discard — whichever connection's request the host happened to
   * be keying.
   */
  private readonly appElicitationPrefix = `app-elicitation-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  /**
   * Abort controllers for app-rendered elicitations still awaiting an answer.
   * Aborted alongside the native pending queue on disconnect, so a rendered app
   * cannot outlive the connection that asked for it.
   */
  private activeAppElicitations = new Set<AbortController>();
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
   * Nesting depth of in-flight silent auth recoveries. `withDirectAuthRecovery`
   * bounds retries per call (`attempt >= 1`), but a satisfied outcome recovers
   * by running a *nested* `connect()`, which starts its own recovery with a
   * fresh counter — so a server that keeps answering 401 with freshly refreshed
   * tokens would recurse without bound. Counted across the nesting boundary and
   * capped at {@link InspectorClient.MAX_NESTED_AUTH_RECOVERIES}.
   */
  private authRecoveryDepth = 0;
  /**
   * Cap on nested silent recoveries. One is the normal case (challenge →
   * refresh → reconnect); a couple more absorb a legitimately re-challenged
   * reconnect. Beyond that the credentials are not fixing the challenge, so the
   * challenge is surfaced to the caller instead of recovered again.
   */
  private static readonly MAX_NESTED_AUTH_RECOVERIES = 3;
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
    this.advertisedExtensions = options.advertisedExtensions;
    this.appElicitationRenderer = options.appElicitation;
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
    this.modernLogLevel = resolveModernLogLevel(options.serverSettings);
    // Default to the legacy 2025-11-25 era when the caller doesn't pin one, per
    // the SDK guidance that a debugging tool must not auto-probe (#1626).
    this.versionNegotiation = options.versionNegotiation ?? { mode: "legacy" };
    this.directAuthRecovery = options.directAuthRecovery ?? false;
    // Only set roots if explicitly provided (even if empty array) - this enables
    // roots capability. Normalized here as well as in `setRoots`, so core owns
    // the invariant rather than trusting each client to clean at its call site
    // (they do, and `cleanRoots` is idempotent, so this costs nothing). The
    // ternary preserves the `undefined`-vs-`[]` distinction the capability
    // advertisement below gates on.
    this.roots =
      options.roots !== undefined ? cleanRoots(options.roots) : undefined;
    // Initialize listChangedNotifications config (default: all enabled)
    this.listChangedNotifications = {
      tools: options.listChangedNotifications?.tools ?? true,
      resources: options.listChangedNotifications?.resources ?? true,
      prompts: options.listChangedNotifications?.prompts ?? true,
    };

    // Effective auth fetch: base fetch + tracking with category 'auth'
    // #1906: apply the per-server authorization/token endpoint overrides to the
    // authorization-server metadata document in flight. This wraps the *base*
    // fetch rather than `effectiveAuthFetch` so it also covers the discovery the
    // SDK runs from inside the transport (the 401/refresh path), which is handed
    // `this.fetchFn` directly. The overrides are read lazily — `oauthManager` is
    // created a few lines below, and `setOAuthConfig` can change them later — so
    // the wrapper is inert until a server actually configures one.
    this.fetchFn = withOAuthEndpointOverrides(this.fetchFn ?? fetch, () =>
      this.oauthManager?.getEndpointOverrides(),
    );
    // #2172: recover discovery when a plain OAuth 2.0 authorization server
    // publishes RFC 8414 metadata at `/.well-known/openid-configuration`, which
    // the SDK validates as an OpenID provider document and rejects. Wraps the
    // *base* fetch for the same reason the overrides above do: the SDK also
    // runs discovery from inside the transport, which is handed `this.fetchFn`
    // directly, so a reconnect with an existing auth provider would otherwise
    // still hit the upstream failure. The substituted response is stamped with
    // `COMPAT_SOURCE_HEADER` so a captured entry names the URL its body came
    // from rather than appearing to be a 200 from the RFC 8414 path.
    this.fetchFn = withRfc8414OidcCompat(this.fetchFn);
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
        logger: this.logger,
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
      listMaxPages?: number;
    } = {
      // Bound the SDK's auto-aggregate with the SAME constant the #1909 salvage
      // re-walks use, so the strict path and its fallback cannot drift apart.
      // This is the SDK's own default today; setting it explicitly is what makes
      // the shared value a fact rather than a copied guess.
      listMaxPages: LIST_MAX_PAGES,
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
      // `requests` declares which server→client requests we accept as tasks, so
      // it must name only capabilities we actually advertised — both are decided
      // above. Advertising a channel we then answer `-32601` on is the shape
      // #1797 is about, and `{ receiverTasks: true, elicit: false }` would do
      // exactly that.
      const taskRequests: NonNullable<
        NonNullable<ClientCapabilities["tasks"]>["requests"]
      > = {};
      if (capabilities.sampling) {
        taskRequests.sampling = { createMessage: {} };
      }
      if (capabilities.elicitation) {
        taskRequests.elicitation = { create: {} };
      }
      capabilities.tasks = {
        list: {},
        cancel: {},
        ...(Object.keys(taskRequests).length > 0 && { requests: taskRequests }),
      };
    }
    // Assemble the advertised-extensions map from one builder (the single
    // source of truth), instead of ad-hoc per-extension spreads. It layers the
    // registry defaults (with any user overrides from `advertisedExtensions`)
    // and the auth-mode-driven EMA extension. The Tasks entry defaults to
    // advertised, so the map is non-empty and `capabilities.extensions` is
    // always attached — the modern Tasks extension (SEP-2663) must ride every
    // modern request envelope for a server to legally return a `CreateTaskResult`
    // (harmless on legacy, where extensions are ignored). (#1738)
    const advertisedExtensions = buildClientExtensions({
      enterpriseManaged: options.oauth?.enterpriseManaged ?? false,
      advertised: this.advertisedExtensions,
      // Read off the built `capabilities.elicitation.form` rather than
      // re-deriving from `options.elicit`: the nested MCP Apps `elicitation`
      // setting must never be advertised without the core form capability it
      // extends, and two derivations of the same fact can drift. Disabling form
      // elicitation therefore drops both, as the contract requires. (#1854)
      appElicitation:
        this.appElicitationRenderer !== undefined &&
        capabilities.elicitation?.form !== undefined,
    });
    if (Object.keys(advertisedExtensions).length > 0) {
      capabilities.extensions = {
        ...capabilities.extensions,
        ...advertisedExtensions,
      };
    }
    clientOptions.capabilities = capabilities;
    this.clientCapabilities = capabilities;
    // Read off the built capability object rather than re-deriving from
    // `options.roots`: the gate and the advertisement must agree, and two
    // independent derivations of the same fact can drift (a `readonly` field is
    // assignable anywhere in the constructor).
    this.rootsCapabilityAdvertised = capabilities.roots !== undefined;
    this.elicitationCapabilityAdvertised =
      capabilities.elicitation !== undefined;
    this.samplingCapabilityAdvertised = capabilities.sampling !== undefined;
    this.tasksCapabilityAdvertised = capabilities.tasks !== undefined;
    this.urlElicitationCapabilityAdvertised =
      capabilities.elicitation?.url !== undefined;
    this.rootsListChangedCapabilityAdvertised =
      capabilities.roots?.listChanged === true;

    this.appRendererClientProxy = null;
    this.clientInfo = options.clientIdentity ?? {
      name: corePackageJson.name.split("/")[1] ?? corePackageJson.name,
      version: corePackageJson.version,
    };
    this.client = new Client(
      this.clientInfo,
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
        if (origin === "client") {
          this.outboundRequestMethods.set(message.id, message.method);
        }
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
        // A response to one of OUR requests closes that id's correlation entry
        // and becomes the method's most recent answer (#1953). The transport
        // only tracks responses that carry an id, but the JSON-RPC types leave
        // it optional for an error frame the server couldn't attribute — such a
        // frame answers no specific request, so it is skipped.
        const responseId = message.id;
        if (origin === "server" && responseId !== undefined) {
          const method = this.outboundRequestMethods.get(responseId);
          this.outboundRequestMethods.delete(responseId);
          if (method !== undefined) {
            this.lastAnsweredRequestByMethod.set(method, responseId);
          }
        }
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
      // A mid-session crash ends the connection without going through
      // `disconnect()`, so drop anything the server had queued with us — the
      // same reasoning as the `connect()` failure path. Cleared before the
      // `disconnect` event so a consumer reading the queue while handling it
      // sees it empty. `disconnect()` clears at the same point, but batches its
      // change events with the rest of its teardown dispatches — so on that
      // path the *events* land just after its `disconnect`, not before.
      this.clearAndAnnouncePendingPeerRequests();
      // Same for what *we* asked the server. The SDK's chained `_onclose`
      // settles its own `_responseHandlers`, but the raw-wire map (the modern
      // `tasks/*` frames its era gate refuses to route) is ours and it doesn't
      // know about it — so a Tasks-tab poll in flight when the server dies
      // would otherwise wait out its own 30s timeout and blame the timeout for
      // a crash. Rejecting a settled promise is a no-op and the helper clears
      // the map, so this can't double-settle with `disconnect()`.
      this.rejectPendingRawWireRequests("Connection closed");
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
    callMetadata?: RequestMetadata,
  ): RequestMetadata | undefined {
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
    // Reserved members carry their own schemas even though the rest of `_meta`
    // is arbitrary JSON, and one bad reserved value makes a conforming server
    // reject the whole request. See `dropInvalidReservedMeta`.
    const sanitized = dropInvalidReservedMeta(merged, this.logger);
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  /**
   * The `progressToken` a caller stamped on its request metadata, when it is
   * one the SDK will accept.
   *
   * This governs only **callback correlation** — whether the client wires up an
   * `onprogress` for the request. Keeping an invalid value off the **wire** is
   * a separate concern handled in {@link mergeMeta}, which deletes the member
   * from the outgoing `_meta` so a conforming server is never sent something
   * `ProgressTokenSchema` rejects. The two use the same {@link isProgressToken}
   * predicate, so they cannot disagree about what counts as valid.
   */
  private progressTokenOf(
    metadata: RequestMetadata | undefined,
  ): ProgressToken | undefined {
    const token = metadata?.progressToken;
    return isProgressToken(token) ? token : undefined;
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
    // When provided, aborting this signal cancels the request and rejects it
    // (#1458). The SDK picks the wire signal from the transport: an aborted
    // per-request SSE stream on a 2026-era Streamable HTTP connection, and
    // `notifications/cancelled` everywhere else (#2140).
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
    metadata?: RequestMetadata,
  ): { _meta: RequestMetadata } | undefined {
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
      // The advertisement check is redundant here — this wrapper only exists
      // when tasks are advertised — but it mirrors the handler branch below
      // deliberately: the two must agree, so they read one predicate.
      if (this.tasksCapabilityAdvertised && task != null) {
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
    // Mark it handled. The real consumer is the server polling `tasks/result`
    // (`getReceiverTaskPayload` returns this same promise, so a real awaiter
    // still sees the rejection), but nothing has attached a handler while the
    // task sits in `input_required` — and it can be rejected from there, by an
    // explicit `tasks/cancel` or by teardown settling a queued sample. Without
    // this, that reject surfaces as an unhandled rejection.
    void payloadPromise.catch(() => {});
    const record: ReceiverTaskRecord = {
      task,
      payloadPromise,
      resolvePayload,
      rejectPayload,
      abort: new AbortController(),
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
    // Stop collecting an answer nobody will read: drops the native pending
    // entry and tears down an app-rendered elicitation's renderer.
    record.abort.abort();
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
   * Register the handlers for requests the *server* makes of *us* —
   * `roots/list`, `sampling/createMessage`, `elicitation/create`, and the
   * receiver-side `tasks/*` polls.
   *
   * MUST be called before `client.connect()`. The matching capabilities are
   * advertised on the `Client` at construction time, so from the moment
   * `connect()` sends `notifications/initialized` the server is entitled to
   * issue any of these requests. Registering afterwards leaves a window in
   * which the SDK `Client` has no handler and answers `-32601 Method not
   * found` — which is exactly what a server that asks for roots the instant it
   * is initialized (e.g. `server-filesystem`, which learns its allowed
   * directories that way) hits, while a server that asks later does not (#1797).
   *
   * Nothing here depends on the server's capabilities — only on constructor-set
   * state — so there is nothing to wait for. Its sibling
   * {@link registerPeerNotificationHandlers} does the same for the one
   * notification handler in that position; the notification handlers that *do*
   * gate on `this.capabilities` stay in `connect()`, after the handshake.
   */
  private registerPeerRequestHandlers(): void {
    // Gated on what was advertised, like the others — see
    // `rootsCapabilityAdvertised`.
    if (this.samplingCapabilityAdvertised && this.client) {
      const samplingHandler = (
        request: CreateMessageRequest,
      ): Promise<CreateMessageResult> => {
        const paramsTask = (request.params as { task?: { ttl?: number } })
          ?.task;
        if (this.tasksCapabilityAdvertised && paramsTask != null) {
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
          return Promise.resolve(taskResult as unknown as CreateMessageResult);
        }
        return this.enqueuePendingSample(request, "server-request");
      };
      this.client.setRequestHandler("sampling/createMessage", samplingHandler);
      // Registration, like the `setRequestHandler` above it — and the whole
      // bypass mechanism (install, wrapper branch, handler branch) reads this
      // one predicate, so the install can't drift from the branch it controls.
      if (this.tasksCapabilityAdvertised) {
        this.installReceiverTaskResponseBypass(
          "sampling/createMessage",
          samplingHandler,
        );
      }
    }

    // Gated on what was advertised, not on `this.elicit` — see the field's doc:
    // an elicit option that enables no mode advertises nothing, and registering
    // regardless throws before the handshake.
    if (this.elicitationCapabilityAdvertised && this.client) {
      const elicitHandler = (
        request: ElicitRequest,
        // Structural, and only the one field this needs: the SDK's
        // `ClientContext` carries much more, and naming it here would tie the
        // handler to a type the bypass helper below does not thread through.
        ctx?: { mcpReq?: { signal?: AbortSignal } },
      ): Promise<ElicitResult> => {
        const paramsTask = (request.params as { task?: { ttl?: number } })
          ?.task;
        if (this.tasksCapabilityAdvertised && paramsTask != null) {
          const record = this.createReceiverTask({
            ttl: paramsTask.ttl,
            initialStatus: "input_required",
            statusMessage: "Awaiting user input",
          });
          // Settling the receiver task, shared by both answer routes below so
          // an app-rendered answer completes the task exactly as a native one
          // does.
          const completeTask = (result: ElicitResult) => {
            // A cancelled (or otherwise terminal) task must not be re-settled:
            // an answer that arrives after `tasks/cancel` would otherwise
            // overwrite `cancelled` with `completed`.
            if (InspectorClient.isTerminalTaskStatus(record.task.status))
              return;
            record.resolvePayload(result);
            const updated: Task = {
              ...record.task,
              status: "completed",
              lastUpdatedAt: new Date().toISOString(),
            };
            record.task = updated;
            this.upsertReceiverTask(updated);
          };
          const failTask = (error: Error) => {
            if (InspectorClient.isTerminalTaskStatus(record.task.status))
              return;
            record.rejectPayload(error);
            const updated: Task = {
              ...record.task,
              status: "failed",
              lastUpdatedAt: new Date().toISOString(),
              statusMessage: error.message,
            };
            record.task = updated;
            this.upsertReceiverTask(updated);
          };
          void (async () => {
            // A task-augmented request is still an `elicitation/create`, so the
            // app-rendering contract applies to it too (#1854). It cannot go
            // through `enqueuePendingElicitation` — the response frame has
            // already been sent as a `CreateTaskResult` and the answer settles
            // the TASK rather than the request — so the same attempt is made
            // here, falling back to the native queue exactly as that funnel
            // does. An abort (disconnect) fails the task rather than reopening
            // it natively.
            let appResult: ElicitResult | null;
            try {
              appResult = await this.tryAppElicitation(
                request,
                record.abort.signal,
              );
            } catch (error) {
              failTask(
                error instanceof Error ? error : new Error(String(error)),
              );
              return;
            }
            if (appResult) {
              completeTask(appResult);
              return;
            }
            const elicitationRequest = new ElicitationCreateMessage(
              request,
              completeTask,
              (id) => this.removePendingElicitation(id),
              failTask,
            );
            this.addPendingElicitation(elicitationRequest);
            // A `tasks/cancel` (or teardown) drops the queued entry, so the
            // modal does not outlive the task it belongs to.
            this.wirePendingAbort(record.abort.signal, () =>
              this.removePendingElicitation(elicitationRequest.id),
            );
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
        // `ctx.mcpReq.signal` aborts when the server cancels this request
        // (`notifications/cancelled`). Threading it through means both answer
        // surfaces — the native queue entry and an app-rendered elicitation's
        // renderer — are torn down with the request, instead of a modal
        // outliving work the server abandoned. The task-augmented branch above
        // deliberately does NOT use it: that request is answered immediately
        // with a `CreateTaskResult`, so its lifetime is the task's, which
        // carries its own abort (see `ReceiverTaskRecord.abort`).
        return this.enqueuePendingElicitation(
          request,
          "server-request",
          ctx?.mcpReq?.signal,
        );
      };
      this.client.setRequestHandler("elicitation/create", elicitHandler);
      // Registration, like the `setRequestHandler` above it — and the whole
      // bypass mechanism (install, wrapper branch, handler branch) reads this
      // one predicate, so the install can't drift from the branch it controls.
      if (this.tasksCapabilityAdvertised) {
        this.installReceiverTaskResponseBypass(
          "elicitation/create",
          elicitHandler,
        );
      }
    }

    // Gated on what was advertised at construction, and it has to be: the SDK
    // asserts the matching client capability inside `setRequestHandler`, so
    // registering this on a client built without `roots` throws "Client does
    // not support roots capability". Since `capabilities.roots` is negotiated at
    // `initialize` (set in the constructor) and `registerCapabilities` refuses
    // to run after connect, a client that omits the option can never serve
    // `roots/list` — which is why every client that may call `setRoots()` later
    // must pass `roots` up front (web does; the CLI and TUI now do too — #1797).
    if (this.rootsCapabilityAdvertised && this.client) {
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
    if (this.tasksCapabilityAdvertised && this.client) {
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
  }

  /**
   * Register the inbound *notification* handlers that depend on nothing but
   * constructor-set state, and so belong before the handshake for the same
   * reason as {@link registerPeerRequestHandlers} (#1797).
   *
   * `notifications/roots/list_changed` is the only one — and note it is a
   * **client**→server notification in the spec (`ClientNotification`): we send
   * it from {@link setRoots}, servers do not normally send it to us. This
   * inbound handler is defensive coverage for a non-conformant or experimental
   * server, and its body dispatches `rootsChange` with our own already-known
   * roots, i.e. a refresh signal carrying no new data. It sits here for
   * consistency with the request handlers — it gates on no server capability,
   * so there is nothing to wait for, and an unhandled notification is dropped
   * silently by the SDK (no wire error) rather than answered `-32601`.
   *
   * The remaining listChanged handlers gate on `this.capabilities`, which is
   * not populated until `fetchServerInfo()` runs, so they stay in `connect()`.
   */
  private registerPeerNotificationHandlers(): void {
    /* v8 ignore next -- unreachable: the sole caller is connect(), past its
       `if (!this.client) throw`; the guard exists only to narrow the type. */
    if (!this.client) return;
    this.client.setNotificationHandler(
      "notifications/roots/list_changed",
      async () => {
        // Re-dispatch our already-known roots as a refresh signal for the UI —
        // the payload carries no new data (see the note on ownership above).
        // Copied, as `setRoots` and `getRoots()` do: a listener must not be
        // able to push into the list we advertise.
        this.dispatchTypedEvent("rootsChange", [...(this.roots ?? [])]);
      },
    );
  }

  /**
   * Stop the receiver tasks' TTL timers and drop the records.
   *
   * These are tasks a *server* created with us, so they belong to the session
   * that created them: `listReceiverTasks()` is what the `tasks/list` handler
   * answers with, and a record surviving into the next session would report a
   * task the new server never created. `disconnect()` clears them, and so does
   * `connect()` — the auth-recovery retry reconnects the *same* client
   * instance, so ending the session isn't the only way a new one begins
   * (#1797).
   */
  private clearReceiverTasks(): void {
    for (const record of this.receiverTaskRecords.values()) {
      if (record.cleanupTimeoutId != null) {
        clearTimeout(record.cleanupTimeoutId);
      }
      // Same reason as `cancelReceiverTask`: the session that owns whatever is
      // collecting the answer is ending.
      record.abort.abort();
    }
    this.receiverTaskRecords.clear();
  }

  /**
   * Reset the modern listen-stream cluster: the subscribed set, the stream
   * state derived from it, and the reconnect machinery that reports on it.
   *
   * One helper because these move together — the rest of the file derives the
   * stream's `active` from `subscribedResources.size > 0`, so clearing one
   * without the other leaves a combination those readers treat as impossible,
   * and a surviving `modernReconnectAttempts` makes a *new* session's first
   * drop back off as if it were the old session's nth. Both axes are announced:
   * every other mutation of the set dispatches, and so does the stream state.
   *
   * Closes the stream itself, best-effort. `disconnect()` is the obvious caller
   * with a live one, but not the only one: an `onerror` without an `onclose`
   * leaves the transport up, and `connect()` then reuses it — so the reference
   * dropped here can be the last one to a stream still open on the server.
   */
  private resetSubscriptionStream(): void {
    const closing = this.modernSubscription;
    this.subscribedResources.clear();
    this.modernListenGeneration++;
    this.clearModernReconnectTimer();
    this.modernReconnectAttempts = 0;
    this.modernNeverAcknowledged = false;
    this.modernSubscription = null;
    // Announced only once both have moved: a listener that ran between them
    // would see an empty set with an `active` stream — the combination this
    // helper exists to prevent, so its own dispatches must not expose it.
    this.setModernStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
    this.dispatchSubscriptionsChange();
    // After the dispatches, so the ordering above is unaffected, and
    // fire-and-forget because nothing downstream depends on it. That is also
    // why the wrapping matters here in a different way than at the awaited
    // sites: the `void` means a failure cannot reach the caller at all — so it
    // cannot cut `disconnect()`'s straight-line teardown short — and what it
    // would do instead is go unhandled, which ends a Node process by default.
    if (closing) void closeSubscriptionBestEffort(closing);
  }

  /**
   * Drop the session-scoped state a *new* session would misread — anything the
   * next server could be told about, or that would change how we treat its
   * traffic. State that only needs settling on the way out (the peer-request
   * queues, the raw-wire map, the in-flight tool call) is not reset here — the
   * in-flight tool call because `callTool`'s own `finally` releases it once the
   * SDK rejects it, the other two because they are settled *end*-clean, by
   * `disconnect()` and the crash path, so that a consumer handling the
   * `disconnect` event already sees them empty. That is a difference in when,
   * not in whether: the routes out do not cover every route *in* (an `onerror`
   * without an `onclose` runs neither), so `connect()` sweeps those two beside
   * this call as a backstop — see the comment there.
   *
   * `disconnect()` touches all of this on the way out too — two members through
   * the same helpers, three hand-rolled in both places — so a sixth member
   * added here has to be added there as well. One of the three is *paired*
   * rather than duplicated: `modernLogLevel` is re-derived here and blanked
   * there, deliberately (see the comment at that site). It is not the only
   * way a session ends — a crash, or a failed connect the caller retries on
   * this same instance (the auth-recovery path), both leave it behind. Called
   * start-clean from `connect()` so every route in is covered.
   *
   * Each member has a symptom, not just untidiness: a stale `subscribedResources`
   * entry makes the modern `subscribeToResource` early-return, so the user's
   * Subscribe click silently sends nothing to the new server; a stale
   * `cancelledTaskIds` entry mislabels a *new* task sharing the id as
   * `cancelled` rather than `failed`; a stale subscription stream state reads
   * `active` for a set that is now empty, which every reader of it treats as
   * impossible; a receiver-task record is reported to the new server by
   * `tasks/list`; and an un-aborted `taskInputAbortControllers`
   * entry delays a paused poll loop unwinding — both registration sites release
   * in a `finally`, so nothing leaks permanently; the abort just closes the
   * window between the crash and the unwind (#1797).
   */
  private resetSessionState(): void {
    this.clearReceiverTasks();
    this.resetSubscriptionStream();
    this.cancelledTaskIds.clear();
    // Correlation data is per-session: JSON-RPC ids don't survive it, and
    // MessageLogState drops its entries on disconnect, so anything left here
    // could only point at an entry that no longer exists. Clearing also
    // releases the ids of requests that never got a response (a timeout, a
    // dropped connection) — the only entries `trackResponse` can't remove, so
    // without this they accumulate across reconnects. Cleared here on the
    // start-clean path rather than in `disconnect()` for the reason documented
    // above: one route out (`onerror` with no `onclose`) tears down nothing
    // (#1953).
    this.outboundRequestMethods.clear();
    this.lastAnsweredRequestByMethod.clear();
    // Per-session for the same reason: both name entries of the PREVIOUS
    // server's list. Cleared here as well as in `disconnect()` because the
    // route out that tears down nothing (`onerror` with no `onclose`) would
    // otherwise carry them into the next connection — indefinitely, if that
    // server never lists the method again. Safe to clear unconditionally at
    // connect: `listAllTools` recomputes the excluded set on every aggregate
    // and the salvage report on every list, so this can only drop a stale set,
    // never a live one (#1909; the `excludedTools` half is the same latent bug
    // from #1632, fixed here rather than left as a known sibling).
    if (this.malformedListItems.size > 0) {
      this.malformedListItems.clear();
      this.dispatchTypedEvent("malformedListItemsChange", []);
    }
    if (this.excludedTools.length > 0) {
      this.excludedTools = [];
      this.dispatchTypedEvent("excludedToolsChange", []);
    }
    for (const [, controller] of this.taskInputAbortControllers) {
      controller.abort(new Error("Connection ended"));
    }
    this.taskInputAbortControllers.clear();
    // Restore the configured opt-in rather than carrying a mid-session
    // `setModernLogLevel` override into the next connection — and rather than
    // leaving it `undefined` after a `disconnect()` cleared it, which silently
    // dropped the user's configured level on reconnect (#1629, #1797).
    this.modernLogLevel = resolveModernLogLevel(this.serverSettings);
  }

  /**
   * Settle and drop the queued peer requests (sampling / elicitation).
   *
   * Every entry is settled before being dropped rather than discarded: an
   * elicitation so an error-path `awaitUrlElicitation` — which blocks
   * `callTool` — doesn't hang forever, and a sample so the *server* gets a
   * response frame for the request we accepted (the transport can outlive a
   * failed attempt; see the `connect()` catch). Callers dispatch the change
   * events themselves:
   * `disconnect()` batches them with its other teardown dispatches, and
   * {@link clearAndAnnouncePendingPeerRequests} emits them immediately
   * everywhere else.
   */
  private clearPendingPeerRequests(): void {
    for (const sample of this.pendingSamples) {
      sample.cancel();
    }
    this.pendingSamples = [];
    for (const elicitation of this.pendingElicitations) {
      elicitation.cancel();
    }
    this.pendingElicitations = [];
    // App-rendered elicitations (#1854) are not in the queue above — they live
    // in the host's renderer — so abort them here on the same teardown paths.
    // `tryAppElicitation` removes each controller in its own `finally`.
    for (const controller of this.activeAppElicitations) {
      controller.abort();
    }
    this.activeAppElicitations.clear();
  }

  /**
   * {@link clearPendingPeerRequests} plus the change events, for every route
   * that drops a queue without going through `disconnect()`: the routes *out*
   * that end a connection some other way, plus the top of `connect()` as a
   * backstop for the one route in that settles nothing (an `onerror` without an
   * `onclose` — see the comment at that call). Named as a category rather than
   * counted, because the set has grown before. (One of the routes out doesn't
   * always end the connection: when a `connect()` failure leaves an auth
   * provider holding the transport open, the caller re-authenticates and
   * retries over it, and what's dropped is the queue left by the attempt that
   * failed.)
   *
   * The events are the load-bearing half: `usePendingClientRequests` tracks its
   * own state off them, so clearing the arrays without dispatching leaves the
   * web pending-request modal on screen for a connection that is gone. Guarded
   * on a non-empty queue so the paths that overlap (a `connect()` failure whose
   * `dropCachedTransport` also fires `onclose`) announce it once.
   */
  private clearAndAnnouncePendingPeerRequests(): void {
    if (
      this.pendingSamples.length === 0 &&
      this.pendingElicitations.length === 0 &&
      // App-rendered elicitations (#1854) are not in either array — they live in
      // the host's renderer — so an emptiness check that ignores them lets a
      // mid-session close (the `onclose` route, which reaches teardown only
      // through here) leave a modal open for a connection that is gone.
      this.activeAppElicitations.size === 0
    ) {
      return;
    }
    this.clearPendingPeerRequests();
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent(
      "pendingElicitationsChange",
      this.pendingElicitations,
    );
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

    // Start from a clean session — see `resetSessionState` for why this is
    // start-clean rather than relying on `disconnect()`.
    this.resetSessionState();
    // The two collections `resetSessionState` excludes as "settled on the way
    // out", swept here as well — because one route out settles nothing. An
    // `onerror` without an `onclose` only flips status to `"error"`: it runs
    // neither teardown path, and it leaves `baseTransport` cached, so a
    // `connect()` on this same instance reuses a *live* transport. That is the
    // route the subscription-stream close exists for, and it strands these two
    // the same way. The peer queue is the sharper of them — the web
    // pending-request modal is derived from its length with no status gate, so
    // it outlives the session, and a user answering it later would write
    // *their* answer for the previous session's request id onto the new
    // connection, arbitrarily far past the re-handshake. Note what the sweep
    // does instead is emit a *cancel* for that same id, right here: still the
    // settle-don't-discard rule, and this is the earliest moment available:
    // the old connection is still the one on the wire here, and stays so at
    // least until the conditional `dropCachedTransport()` below — which on a
    // stdio server never runs at all, so the same transport carries straight
    // through the re-handshake.
    //
    // Both helpers are idempotent (one guards on a non-empty queue, the other
    // clears its map and re-rejecting a settled promise is a no-op), so these
    // are no-ops on the routes that already ran them; and anything still
    // pending here belongs to a session that is, by definition, no longer
    // connected.
    //
    // Must stay *after* `resetSessionState()`, which reads as independent of it
    // but is not: cancelling a task-augmented peer request settles it
    // synchronously into the record callback, which ends in
    // `upsertReceiverTask`. That is a no-op only because `clearReceiverTasks()`
    // just emptied the map — hoisted above the reset, it would instead emit a
    // `notifications/tasks/status` for the outgoing session's task, onto the
    // transport this connect is about to reuse, moments before the reset drops
    // the record anyway.
    this.clearAndAnnouncePendingPeerRequests();
    this.rejectPendingRawWireRequests("Connection ended");

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
        // Record every 401/403 the transport sees, whatever else happens to
        // it. The legacy first-authorization path deliberately runs with no
        // authProvider and no challenge interception (see below), so the SDK
        // raises a headerless `UnauthorizedError` and the client calls
        // `authenticate()` with nothing in hand — this is the only place the
        // challenge's RFC 9728 `resource_metadata` still exists (#2071).
        const manager = oauthManager;
        transportOptions.onAuthChallengeObserved = (challenge) => {
          manager.noteObservedAuthChallenge(challenge);
        };
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
        // No stored tokens means no authProvider (see above), and then a 401 on
        // the era-negotiation probe reaches the SDK as a raw `SdkHttpError`.
        // The probe's classifier ignores the HTTP status — it only looks for a
        // JSON-RPC error body — so it verdicts "not a modern server", and pin
        // ("modern") mode rethrows that as ERA_NEGOTIATION_FAILED with the 401
        // discarded entirely: no status, not even a cause. Intercepting makes
        // the 401 a typed AuthChallengeError, which survives the probe as
        // `data.cause` for `findNestedAuthError` to recover (#1805).
        //
        // WORKAROUND (#1807, upstream modelcontextprotocol/typescript-sdk#2561):
        // remove this clause once the SDK classifies a probe 401/403 as
        // auth-required. `findNestedAuthError` is the permanent fix; the
        // `|| this.probesProtocolEra()` clause below exists only to compensate
        // for that upstream gap and should be deleted with it.
        //
        // Known, accepted side effect of turning intercept on with no stored
        // tokens: `parseAuthChallengeFromResponse` treats 403 as a challenge
        // too, so a probe answered 403 for a *non-auth* reason (a gateway
        // rejecting the unknown `server/discover` method, say) now starts OAuth
        // discovery instead of letting "auto" fall back to the legacy
        // `initialize`. The outcome is a surfaced `oauthError`, not a hang, and
        // it goes away with this clause.
        (transportOptions.authProvider || this.probesProtocolEra())
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
        {
          rewriteIncomingResult: (message) =>
            this.rewriteModernTaskResult(message),
          consumeIncomingResponse: (message) =>
            this.consumeRawWireResponse(message),
        },
      );
      this.attachTransportListeners(this.baseTransport);
    }

    if (!this.transport) {
      throw new Error("Transport not initialized");
    }

    try {
      this.status = "connecting";
      this.dispatchTypedEvent("statusChange", this.status);

      // Register the handlers for server→client requests and the
      // capability-independent notifications before the handshake — see
      // `registerPeerRequestHandlers` for why the ordering is load-bearing.
      this.registerPeerRequestHandlers();
      this.registerPeerNotificationHandlers();

      // Optional connect-time timeout from per-server settings. The MCP SDK
      // has no connect-time timeout option, so we wrap the handshake in a
      // Promise.race. On timeout, tear the transport down so the next
      // connect() starts clean and the upstream socket isn't left hanging.
      const connectTimeoutMs = this.serverSettings?.connectionTimeout ?? 0;
      // Unwrap here — the earliest point — so an auth error the SDK's
      // era-negotiation probe buried in its cause chain is surfaced before
      // anything downstream inspects it: `withDirectAuthRecovery` (whose
      // `isAuthChallengeError` check is shallow), the outer catch's
      // `isConnectAuthRecoveryError` status guard, and every client's connect
      // error handling. See {@link findNestedAuthError} (#1805).
      const connectPromise = this.client
        .connect(this.transport)
        .catch((err: unknown) => {
          throw findNestedAuthError(err) ?? err;
        });
      // Set when a satisfied auth recovery already completed a full connect()
      // underneath us — see the short-circuit in `runConnect`.
      let recoveredByNestedConnect = false;
      const runConnect = async (attempt: number): Promise<void> => {
        if (attempt > 0) {
          // The *retry* leg of `withDirectAuthRecovery`: the challenge was
          // satisfied silently (e.g. a refresh token), so
          // `reconnectAfterAuthRecovery()` has already run a complete
          // `connect()` — handshake, server info, `connect` event and all.
          // `connectPromise` is created once, outside this closure, so
          // re-awaiting it here would rethrow the *original* rejection and
          // reject a `connect()` whose client is in fact connected. Short-
          // circuit instead, and let the caller skip the post-connect block the
          // nested connect already ran (dispatching a second `connect` event
          // would re-trigger every list-state manager's refresh).
          //
          // Keyed off the leg rather than live status: an `onclose` landing
          // between the nested connect and here would flip status off
          // "connected" and fall through to the rejected `connectPromise`,
          // reporting the stale handshake 401 as the reason the session died.
          recoveredByNestedConnect = true;
          if (this.status !== "connected") {
            throw new Error(
              "Connection closed during authorization recovery, after re-authorizing successfully",
            );
          }
          return;
        }
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
      if (recoveredByNestedConnect) {
        // The nested connect() from the auth recovery did all of the below.
        return;
      }
      this.status = "connected";
      this.dispatchTypedEvent("statusChange", this.status);

      // Always fetch server info (capabilities, serverInfo, instructions) - this is just cached data from initialize.
      // Must run BEFORE the "connect" event: the managed list-state managers
      // refresh on "connect" and gate their list RPC on getCapabilities() (see
      // #1395). If "connect" fired first, that gate would read undefined
      // capabilities and wipe tools/prompts/resources to empty on every connect.
      await this.fetchServerInfo();

      // Set initial logging level if configured and server supports it.
      //
      // Era-gated (#1990): `logging/setLevel` is a legacy-era method, and the
      // modern wire era rejects it outright — so an unconditional call here
      // failed the *connect* of every modern server advertising `logging`,
      // taking down commands that have nothing to do with logging. Modern has
      // no session-scoped level at all: the equivalent is the per-request
      // `io.modelcontextprotocol/logLevel` `_meta` opt-in, which
      // `modernLogLevel` already drives from the server settings (see
      // {@link setModernLogLevel}). So the right behavior on modern is to skip
      // this call rather than translate it — `initialLoggingLevel` names a
      // mechanism that era does not have.
      if (
        this.initialLoggingLevel &&
        this.capabilities?.logging &&
        this.protocolEra !== "modern"
      ) {
        await this.client.setLoggingLevel(
          this.initialLoggingLevel,
          this.getRequestOptions(),
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
        if (this.urlElicitationCapabilityAdvertised) {
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

      // Modern era: the handlers registered above only fire for notifications
      // that reach us, and on this era every server→client notification rides
      // the `subscriptions/listen` stream. Open it now when the filter says
      // there is something to listen for — otherwise a list-change opt-in on a
      // server with no resources would have no way in, since a subscribe click
      // was the only thing that ever opened the stream (#1920).
      await this.openModernListenStreamOnConnect();

      // Last, so the notification channel is established (or its retry armed)
      // before any consumer acts on the connection. The managed list states
      // start their initial `refresh()` from this event, so dispatching earlier
      // would let `tools/list` go out ahead of `subscriptions/listen` — and a
      // list the server changes in that window would notify nobody, leaving the
      // UI stale with no way to notice (#1920). The cost is one listen
      // round-trip added to connect on the modern era.
      //
      // …which is also why the announcement is conditional. Every await above
      // is a window for a `disconnect()` or a transport `onclose`/`onerror` to
      // overtake this connect, and the listen round-trip widened it. Announcing
      // then would restart every managed list refresh against a session being
      // torn down or already dead. `disconnecting` covers the teardown that has
      // claimed ownership but is still awaiting `client.close()` — the status is
      // whatever it was until that block finishes.
      if (this.status === "connected" && !this.disconnecting) {
        this.dispatchTypedEvent("connect");
      }
    } catch (error) {
      if (!isConnectAuthRecoveryError(error)) {
        this.status = "error";
        this.dispatchTypedEvent("statusChange", this.status);
      }
      if (this.baseTransport && !this.transportHasAuthProvider) {
        await this.dropCachedTransport();
      }
      // The peer handlers are registered before the handshake (#1797), so a
      // server can queue a sampling/elicitation request during it — and this is
      // where that connect attempt dies. Drop the queue: otherwise the UI keeps
      // a live pending-request modal for a connection that never came up, and
      // answering it would route to a transport that is either torn down or —
      // when an auth provider holds it open, so the caller can re-authenticate
      // and retry over it — carrying a queue from an attempt that already
      // failed. Note the retention is gated on `transportHasAuthProvider`
      // alone, independently of `isConnectAuthRecoveryError` above, which gates
      // only the status hold. `disconnect()` does the same clearing, but
      // `connect()` only reaches it on the connect-timeout path.
      this.clearAndAnnouncePendingPeerRequests();
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
    // Drop anything the server had queued with us before announcing the
    // teardown, so a `disconnect` consumer sees an empty queue here as it does
    // on the crash path. The change events stay batched with the other teardown
    // dispatches below.
    this.clearPendingPeerRequests();
    // Update status - any onclose fired during close() above deferred to us
    // (see `disconnecting`), so this is the single place the explicit-disconnect
    // path settles the status and emits `disconnect`.
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("disconnect");
    }

    // Clear the rest of the server state (list state is in state managers).
    // Clear resource subscriptions on disconnect. Tear down the modern listen
    // stream (best-effort — the transport is already going away) and bump the
    // generation so any in-flight re-listen/reconnect bails (#1630).
    this.resetSubscriptionStream();
    this.cancelledTaskIds.clear();
    // Settle any pending raw-wire (modern tasks/*) requests so their callers
    // don't hang past teardown. Rejected outright on every disconnect: the
    // drain above polls the SDK's own response-handler map, which never holds
    // raw-wire ids (those frames go straight through the transport), and it is
    // opt-in anyway — every production caller leaves `safeDisconnectTimeout` at
    // 0, so nothing is drained for anyone.
    this.rejectPendingRawWireRequests("Disconnected");
    // Abort any task paused at input_required so its poll loop unwinds.
    for (const [, controller] of this.taskInputAbortControllers) {
      controller.abort(new Error("Disconnected"));
    }
    this.taskInputAbortControllers.clear();
    // Abort any in-flight ordinary tool call so its promise settles instead of
    // hanging past teardown; drop the controller reference either way.
    this.activeToolCallAbortController?.abort("Disconnected");
    this.activeToolCallAbortController = undefined;
    this.clearReceiverTasks();
    this.appRendererClientProxy = null;
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.protocolVersion = undefined;
    this.protocolEra = undefined;
    this.discoverResult = undefined;
    this.excludedTools = [];
    this.malformedListItems.clear();
    // Read as "not opted in" while disconnected. This is no longer what stops
    // it leaking into the next connection — `resetSessionState()` re-derives it
    // at connect, so removing this would leak nothing (#1629). Note the web
    // Logs control deliberately shows the *configured* level in this window
    // (`resetSessionScopedUiState`), so the two disagree until the next
    // connect re-seeds both; harmless, since nothing is sent meanwhile.
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
    this.dispatchTypedEvent("excludedToolsChange", this.excludedTools);
    this.dispatchTypedEvent("malformedListItemsChange", []);
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
   * True when the connection is modern (2026-07-28) AND the server advertised
   * the `io.modelcontextprotocol/tasks` extension (SEP-2663) in its
   * `server/discover` capabilities. Modern task methods (`tasks/get`,
   * `tasks/update`, `tasks/cancel`) and the "unsolicited task handle" behavior
   * are gated on this — legacy servers use `capabilities.tasks` and the
   * `tasks/list`-backed flow instead. Exposed so the Tasks tab and the modern
   * task store gate on the extension rather than the legacy capability.
   */
  isTasksExtensionNegotiated(): boolean {
    return (
      this.isModernEra() &&
      this.capabilities?.extensions?.[TASKS_EXTENSION_KEY] !== undefined
    );
  }

  /**
   * Build the full modern (2026-07-28) per-request envelope for a RAW tasks/*
   * request. The SDK's codec normally stamps this envelope, but raw requests
   * bypass the codec, and the modern server rejects a request whose
   * `MCP-Protocol-Version` header names 2026-07-28 but omits the required
   * envelope `_meta` keys (`protocolVersion`, `clientInfo`, plus
   * `clientCapabilities` carrying the tasks extension). We reproduce it here.
   */
  private withModernTaskEnvelope(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const clientCapabilities = {
      ...this.clientCapabilities,
      // Force-stamp the tasks extension regardless of what the client
      // advertised at construction: the raw `tasks/*` channel requires it, and
      // a user may disable general tasks advertisement via `advertisedExtensions`
      // (#1738). So this stamp is load-bearing, not a redundant re-add.
      extensions: {
        ...this.clientCapabilities.extensions,
        [TASKS_EXTENSION_KEY]: {},
      },
    };
    return this.withModernEnvelope(params, clientCapabilities);
  }

  /**
   * Stamp the `_meta` envelope every raw-wire request needs on the modern leg:
   * the negotiated protocol version, the client identity, and the client
   * capabilities.
   *
   * Split out of {@link withModernTaskEnvelope} so the list-salvage re-walk
   * (#1909) can reuse it WITHOUT that method's force-stamped tasks extension —
   * a `tools/list` has no business claiming an extension the user may have
   * deliberately turned off (#1738).
   *
   * The NEGOTIATED protocol version is used so the envelope agrees with the
   * `MCP-Protocol-Version` header the transport stamps from the same source — a
   * future modern-family revision would negotiate a different string, and the
   * two must not disagree. The raw channel only runs on a connected modern
   * session, so this is always set; the constant is a defensive fallback.
   */
  private withModernEnvelope(
    params: Record<string, unknown>,
    clientCapabilities: ClientCapabilities = this.clientCapabilities,
  ): Record<string, unknown> {
    const existingMeta =
      (params._meta as Record<string, unknown> | undefined) ?? {};
    /* v8 ignore start -- fallback only if getProtocolVersion() is unset, which
       can't happen on the connected modern session this runs on. Bracketed so
       the ignore is reflow-proof however prettier splits the statement. */
    const protocolVersion =
      this.getProtocolVersion() ?? MODERN_PROTOCOL_VERSION;
    /* v8 ignore stop */
    return {
      ...params,
      _meta: {
        ...existingMeta,
        [PROTOCOL_VERSION_META_KEY]: protocolVersion,
        [CLIENT_INFO_META_KEY]: this.clientInfo,
        [CLIENT_CAPABILITIES_META_KEY]: clientCapabilities,
      },
    };
  }

  /**
   * Transport-level rewrite of a modern (SEP-2663) `CreateTaskResult`
   * (`resultType: "task"`) — the one task frame the SDK v2 codec rejects (tasks
   * were removed, so the codec knows only `complete`/`input_required`). The true
   * frame is already logged by `trackResponse`; here we hand the SDK a benign
   * `CallToolResult` that carries the real `DetailedTask` under
   * {@link MODERN_TASK_HANDLE_META}, where {@link pollTaskToolCall} reads it to
   * drive the poll. Any other message passes through untouched.
   */
  private rewriteModernTaskResult(
    message: JSONRPCResultResponse,
  ): JSONRPCMessage {
    if (!isModernCreateTaskResult(message.result)) {
      return message;
    }
    const task = message.result as ModernDetailedTask;
    return {
      ...message,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: `Modern task ${task.taskId} created` }],
        _meta: { [MODERN_TASK_HANDLE_META]: task },
      },
    };
  }

  /**
   * Send an extension method the SDK v2 era gate refuses to route — the modern
   * `tasks/get` / `tasks/update` / `tasks/cancel`, which are spec-method names
   * absent from the 2026-07-28 era, so `client.request` throws
   * `MethodNotSupportedByProtocolVersion` before anything reaches the wire.
   *
   * We mint a string JSON-RPC id (the SDK only mints numeric ids, so ours never
   * collide), send the raw frame straight through the transport (which still
   * logs it via `trackRequest`, so the Protocol/Network tabs see it), and await
   * the matching response — captured and consumed by the transport's
   * consume-response hook so it never confuses the SDK Client. The response is
   * validated with the caller's explicit schema.
   */
  private async rawWireRequest<T>(
    method: string,
    params: Record<string, unknown>,
    resultSchema: { parse: (value: unknown) => T },
  ): Promise<T> {
    const transport = this.transport;
    if (!transport) {
      throw new Error("Client is not connected");
    }
    const id = `inspector-ext-${(this.rawWireRequestCounter += 1)}`;
    // `params` is an arbitrary caller-supplied record; the SDK types request
    // params with a specific optional `_meta` shape it can't satisfy, so widen
    // it with a single structural cast. Typing `message` as `JSONRPCRequest`
    // (a `JSONRPCMessage` member) then needs no further cast.
    const message: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: params as JSONRPCRequest["params"],
    };
    const timeoutMs = this.requestTimeout ?? 30_000;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRawWireRequests.delete(id);
        reject(
          new Error(`Raw request "${method}" timed out after ${timeoutMs} ms`),
        );
      }, timeoutMs);
      this.pendingRawWireRequests.set(id, { resolve, reject, timer });
      transport.send(message).catch((err: unknown) => {
        const pending = this.pendingRawWireRequests.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRawWireRequests.delete(id);
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    return resultSchema.parse(raw);
  }

  /**
   * Transport consume-response hook: resolve/reject a pending
   * {@link rawWireRequest} when its response arrives, and report it as consumed
   * (so the transport does not forward it to the SDK Client, which never sent
   * it). Returns false for any id we don't own, leaving normal SDK traffic
   * untouched.
   */
  private consumeRawWireResponse(
    message: JSONRPCResultResponse | JSONRPCErrorResponse,
  ): boolean {
    const id = String((message as { id?: unknown }).id);
    const pending = this.pendingRawWireRequests.get(id);
    if (!pending) {
      return false;
    }
    this.pendingRawWireRequests.delete(id);
    clearTimeout(pending.timer);
    if ("error" in message) {
      const err = (message as JSONRPCErrorResponse).error;
      pending.reject(new Error(err?.message ?? `Request ${id} failed`));
    } else {
      pending.resolve((message as JSONRPCResultResponse).result);
    }
    return true;
  }

  /**
   * Reject and clear all pending raw-wire requests — on every route out that
   * can hold one, and at the top of `connect()` for the route in that settles
   * nothing (see the comment there).
   */
  private rejectPendingRawWireRequests(reason: string): void {
    for (const [, pending] of this.pendingRawWireRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRawWireRequests.clear();
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
    // Modern (SEP-2663): `tasks/get` returns a `DetailedTask` (ttlMs/pollIntervalMs,
    // inlined result/error/inputRequests) — a different wire shape than the
    // deprecated SDK schema. Parse with the explicit modern schema and normalize
    // onto the internal Task shape, stamping the extension client capability.
    if (this.isTasksExtensionNegotiated()) {
      const modern = await this.rawWireRequest(
        "tasks/get",
        this.withModernTaskEnvelope({ taskId }),
        ModernGetTaskResultSchema,
      );
      const task = normalizeModernTask(modern);
      this.dispatchTypedEvent("requestorTaskUpdated", {
        taskId: task.taskId,
        task,
      });
      return task;
    }
    // Legacy (2025-11-25): SDK v2 removed `client.experimental.tasks.*`; drive
    // the `tasks/get` wire method directly with its deprecated-but-importable
    // result schema. `GetTaskResult` is the flattened task object.
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
    // If the task is paused at `input_required` (its poll loop blocked on the
    // pending-request modal), abort it so the modal closes and the poll observes
    // the cancellation — otherwise the user is stuck answering a modal that a
    // non-advancing server would keep re-showing.
    const inputAbort = this.taskInputAbortControllers.get(taskId);
    if (inputAbort) {
      inputAbort.abort(new Error(`Task ${taskId} cancelled by user`));
    }
    // Modern `tasks/cancel` is a raw-wire request (the SDK era gate blocks the
    // spec-method name on 2026-07-28); legacy uses the SDK path + deprecated
    // schema.
    if (this.isTasksExtensionNegotiated()) {
      await this.rawWireRequest(
        "tasks/cancel",
        this.withModernTaskEnvelope({ taskId }),
        ModernCancelTaskResultSchema,
      );
    } else {
      await this.client.request(
        { method: "tasks/cancel", params: { taskId } },
        CancelTaskResultSchema,
        this.getRequestOptions(),
      );
    }

    // Dispatch event
    this.dispatchTypedEvent("taskCancelled", { taskId });
  }

  /**
   * Fulfil the outstanding `inputRequests` of a modern (SEP-2663)
   * `input_required` task by sending `tasks/update` with the collected
   * `inputResponses`. The server acks with an empty result; the task's
   * observable status advances on a subsequent `tasks/get` poll (the update is
   * eventually consistent). Modern-only — legacy tasks surface input through the
   * server→client request channel, not `tasks/update`.
   *
   * @param taskId Task identifier
   * @param inputResponses Responses keyed by the server's `inputRequests` ids
   */
  async updateRequestorTask(
    taskId: string,
    inputResponses: Record<string, unknown>,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    await this.rawWireRequest(
      "tasks/update",
      this.withModernTaskEnvelope({ taskId, inputResponses }),
      ModernUpdateTaskResultSchema,
    );
  }

  /**
   * Cancel the in-flight ordinary (non-task) tool call started by
   * {@link callTool}. Aborting its request runs the MCP cancellation flow and
   * rejects the pending call, which `callTool` surfaces as a
   * {@link ToolCallCancelledError}. The SDK chooses the wire signal from the
   * transport: on a 2026-era Streamable HTTP connection it aborts that
   * request's own SSE response stream — the spec's cancellation signal —
   * rather than sending `notifications/cancelled`, which is the stdio
   * mechanism and remains in use there (#2140).
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
  private async enqueuePendingElicitation(
    request: ElicitRequest,
    origin: PendingRequestOrigin,
    signal?: AbortSignal,
  ): Promise<ElicitResult> {
    // App-rendered form elicitation (#1854) is offered first and falls back to
    // the native queue below on every failure. Both entry points — the inbound
    // `elicitation/create` handler and the MRTR driver's embedded requests —
    // funnel through here, so neither can miss the routing.
    const appResult = await this.tryAppElicitation(request, signal);
    if (appResult) return appResult;
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
   * Attempt to resolve an `elicitation/create` request by rendering the MCP App
   * the server attached to it (#1854), returning the app's standard
   * `ElicitResult`.
   *
   * Returns `null` for "not app-rendered — use the native UI", which covers
   * every negotiation gate and every failure mode the contract lists: either
   * peer did not negotiate the capability, the metadata is absent or unusable,
   * the mode is not `form`, the renderer failed (resource read, sandbox/bridge
   * init, missing app capability, timeout), or the app returned something that
   * is not a valid result for this request. An explicit `decline` or `cancel`
   * is a *completed* elicitation and is returned, not fallen back on.
   *
   * The one case that does not fall back is an abort of the originating
   * request: the caller is cancelling the whole elicitation, so re-opening it
   * in the native queue would resurrect work the user just abandoned.
   */
  private async tryAppElicitation(
    request: ElicitRequest,
    signal?: AbortSignal,
  ): Promise<ElicitResult | null> {
    const renderer = this.appElicitationRenderer;
    if (!renderer) return null;
    // Gate 1-3 (client) + 4 (server), from the negotiated capabilities of this
    // connection — `this.capabilities` is populated at initialize.
    if (!supportsAppElicitation(this.clientCapabilities, this.capabilities)) {
      return null;
    }
    // Only form mode is app-renderable; `url` keeps its existing path.
    if (!isFormElicitation(request.params)) return null;
    let resourceUri: string | undefined;
    try {
      resourceUri = getElicitationUiResourceUri(request.params);
    } catch (error) {
      this.logger.warn(
        { error },
        "Elicitation carried unusable _meta.ui.resourceUri; using the native elicitation UI",
      );
      return null;
    }
    if (!resourceUri) return null;

    // Request-scoped abort: forwards the caller's signal (MRTR cancellation)
    // and is aborted by `settleAndDropPendingPeerRequests` on disconnect, so a
    // rendered app cannot outlive the connection that asked for it.
    // Already cancelled before we got here (the caller aborted while an earlier
    // MRTR round was in flight): don't mount an app nobody is waiting on.
    if (signal?.aborted) throw createPendingAbortError();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    this.activeAppElicitations.add(controller);
    try {
      const result = await renderer({
        requestId: `${this.appElicitationPrefix}-${++this.appElicitationSeq}`,
        resourceUri,
        params: request.params,
        signal: controller.signal,
      });
      this.outputValidator ??= new AjvJsonSchemaValidator();
      const invalid = validateAppElicitResult(
        this.outputValidator,
        request.params,
        result,
      );
      if (invalid) {
        this.logger.warn(
          { resourceUri, reason: invalid },
          "App-rendered elicitation returned an invalid result; using the native elicitation UI",
        );
        return null;
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw createPendingAbortError();
      this.logger.warn(
        { error, resourceUri },
        "App-rendered elicitation failed; using the native elicitation UI",
      );
      return null;
    } finally {
      this.activeAppElicitations.delete(controller);
      signal?.removeEventListener("abort", forwardAbort);
    }
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
    origin: PendingRequestOrigin = "input-required",
  ): Promise<Record<string, unknown> | undefined> {
    if (!inputRequests) return undefined;
    const responses: Record<string, unknown> = {};
    for (const [key, embedded] of Object.entries(inputRequests)) {
      responses[key] = await this.fulfilEmbeddedInputRequest(
        embedded,
        signal,
        origin,
      );
    }
    return responses;
  }

  /**
   * Fulfil a single embedded input request. `roots/list` is auto-answered from
   * the configured roots (consistent with the legacy `roots/list` handler — no
   * pending UX); `elicitation/create` and `sampling/createMessage` surface
   * through the pending-request UI tagged with `origin`. `origin` distinguishes
   * an MRTR round (`"input-required"`, answer echoed as a retry) from a modern
   * task round (`"task-input-required"`, answer submitted via `tasks/update`).
   */
  private async fulfilEmbeddedInputRequest(
    request: CreateMessageRequest | ElicitRequest | ListRootsRequest,
    signal?: AbortSignal,
    origin: PendingRequestOrigin = "input-required",
  ): Promise<unknown> {
    switch (request.method) {
      case "roots/list":
        return { roots: this.roots ?? [] };
      case "elicitation/create":
        return this.enqueuePendingElicitation(request, origin, signal);
      case "sampling/createMessage":
        return this.enqueuePendingSample(request, origin, signal);
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
    metadata?: RequestMetadata,
  ): Promise<{ tools: Tool[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: ListToolsRequest["params"] = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      // `!== undefined`, not truthiness: "" is a valid cursor. Dropping it asks
      // for page one again — and `listToolsForScan` pairs this call with a
      // fallback that already preserves it, so the two legs of one scan page
      // would otherwise disagree about which page they fetched.
      ...(cursor !== undefined && { cursor }),
    };
    const response = await this.invokeMcpClient(() =>
      this.client!.request(
        { method: "tools/list", params },
        ListToolsResultSchema,
        this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata;
  }): Promise<{ tools: Tool[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const tools = await this.listAllSalvaging({
      method: "tools/list",
      itemsKey: "tools",
      resultSchema: ListToolsResultSchema,
      // Era-aware: the neutral `ToolSchema` is more permissive than the
      // negotiated era's wire schema — see `toolItemSchemaForEra`.
      itemSchema: toolItemSchemaForEra(this.isModernEra()),
      metadata: options?.metadata,
      finalize: (salvaged) => this.excludeInvalidXMcpHeaderTools(salvaged),
      aggregate: async () => [
        ...(
          await this.client!.listTools(
            this.aggregateListParams(options?.metadata),
            this.getCacheableRequestOptions(options?.cacheMode),
          )
        ).tools,
      ],
    });
    // Recompute the SEP-2243 excluded-tools set alongside the aggregate. The
    // SDK already filtered `response.tools`, so it can't tell us what it
    // dropped — {@link refreshExcludedTools} re-lists the RAW `tools/list` to
    // find out. This is a SECOND, deliberately un-cached walk: on a modern
    // non-stdio connection it roughly doubles the list round-trips per refresh
    // (and runs even when the aggregate above was served from cache), because
    // the raw per-page path has no response cache and the excluded set must
    // reflect the current wire truth. Accepted for a debugging tool where the
    // list is small and correctness of "why did this tool vanish" matters more
    // than the extra request; it's a no-op (no round trip) on legacy/stdio.
    // Kept best-effort: an error here must never fail the tools list itself —
    // but it is logged rather than dropped on the floor, so a failing
    // excluded-tools walk is diagnosable instead of silently leaving the
    // "Excluded (SEP-2243)" section empty and looking like a clean server
    // (#1953).
    await this.refreshExcludedTools(options?.metadata).catch((err: unknown) => {
      this.logger.warn(
        { err },
        "Excluded-tools walk failed; the SEP-2243 excluded list may be incomplete",
      );
    });
    return { tools };
  }

  /**
   * Whether this connection excludes tools with invalid `x-mcp-header`
   * annotations from `tools/list`, matching the SDK's gate: only the modern
   * (2026-07-28) era on a non-stdio (Streamable HTTP / SSE) transport. Legacy
   * and stdio keep such tools in the list, so there is nothing to surface.
   */
  private excludesInvalidXMcpHeaderTools(): boolean {
    return this.isModernEra() && this.getServerType() !== "stdio";
  }

  /**
   * Mark the response that most recently answered `method` as rejected by the
   * client, so its Protocol entry shows why instead of rendering as a clean
   * success (#1953).
   *
   * The SDK gives no request id with a decode failure — `SdkError` carries the
   * method and nothing else — so the id is recovered by correlation: the last
   * response received for that method. That is exact rather than approximate,
   * because the SDK rejects synchronously while decoding the response (inside
   * the transport's `onmessage`) and the caller's `catch` runs in the very next
   * microtask. Delivering another response for the same method in that window
   * would take a macrotask (a socket read), which cannot interleave there.
   *
   * A no-op when nothing has answered `method` this session.
   */
  markResponseRejected(method: string, reason: string): void {
    const id = this.lastAnsweredRequestByMethod.get(method);
    if (id === undefined) return;
    this.dispatchTypedEvent("responseRejected", { id, reason });
  }

  /**
   * Put the method's response correlation back where it was before a salvage
   * re-walk, so a caller that goes on to mark the failure still marks the
   * ORIGINAL rejected response.
   *
   * The re-walk answers the same method, so on any rethrow path the map points
   * at a lenient page that succeeded. `ManagedListState.refresh()` catches the
   * rethrown error and calls `markResponseRejected(method, ...)`, which would
   * then stamp "Rejected by the Inspector" onto that page and leave the real
   * one rendering clean — the same misattribution the capture inside
   * `salvageList` exists to prevent, just one frame further out. Deleting when
   * nothing had answered before makes the outer mark a no-op rather than a lie.
   */
  private restoreResponseCorrelation(
    method: string,
    id: string | number | undefined,
  ): void {
    if (id === undefined) this.lastAnsweredRequestByMethod.delete(method);
    else this.lastAnsweredRequestByMethod.set(method, id);
  }

  /** Every entry dropped from a list result as malformed, across methods (#1909). */
  getMalformedListItems(): MalformedListItem[] {
    return [...this.malformedListItems.values()].flat();
  }

  /**
   * Record (or clear) the malformed entries for one list method and notify.
   *
   * A no-op when the method had none and still has none, so the common case —
   * every conforming refresh, of which there are many — costs no event and no
   * re-render.
   */
  private setMalformedListItems(
    method: string,
    malformed: MalformedListItem[],
  ): void {
    const previous = this.malformedListItems.get(method) ?? [];
    if (previous.length === 0 && malformed.length === 0) return;
    if (malformed.length === 0) this.malformedListItems.delete(method);
    else this.malformedListItems.set(method, malformed);
    this.dispatchTypedEvent(
      "malformedListItemsChange",
      this.getMalformedListItems(),
    );
  }

  /**
   * Run a list aggregate, falling back to a per-item salvage when the SDK
   * rejects the result it received (#1909).
   *
   * The strict aggregate runs first and unchanged, so a conforming server pays
   * nothing: no extra request, no extra parse, and the SDK's response cache
   * still serves it. Only an `InvalidResult` rejection — a response in hand
   * that failed validation — reaches {@link salvageList}; every other failure
   * (transport drop, timeout, server-sent error) rethrows untouched, because
   * re-listing would not produce anything to salvage.
   */
  private async listAllSalvaging<T>({
    method,
    itemsKey,
    itemSchema,
    resultSchema,
    aggregate,
    metadata,
    finalize,
  }: {
    method: string;
    itemsKey: string;
    itemSchema: z.ZodType<T>;
    /** The method's real result schema — the salvage page schema is derived
     *  from it so every field except the entries is still validated. */
    resultSchema: z.ZodObject;
    aggregate: () => Promise<T[]>;
    metadata?: RequestMetadata;
    /**
     * Filter applied to SALVAGED entries only, to reproduce a filter the SDK's
     * strict aggregate applies for us. Without it the fallback would return a
     * longer list than the strict path — see the `tools/list` caller.
     */
    finalize?: (items: T[]) => T[];
  }): Promise<T[]> {
    try {
      const items = await this.invokeMcpClient(aggregate, { method });
      this.setMalformedListItems(method, []);
      return items;
    } catch (err) {
      // Deliberately narrower than the Protocol-marking predicate — see
      // `isSalvageableRejection`: an unrecognized result KIND is not a list
      // with a bad entry in it.
      if (!isSalvageableRejection(err)) throw err;
      const salvaged = await this.salvageList({
        method,
        itemsKey,
        itemSchema,
        resultSchema,
        metadata,
        err,
      });
      return finalize ? finalize(salvaged) : salvaged;
    }
  }

  /**
   * Drop the tools the SDK would have excluded from `tools/list` for invalid
   * `x-mcp-header` annotations (SEP-2243).
   *
   * The strict aggregate is filtered by the SDK before we see it, so the
   * salvage path has to reapply the same rule itself: otherwise one ordinary
   * malformed tool anywhere in the list would trip the fallback and quietly
   * readmit every invalid-header tool alongside it — turning a rendering fix
   * into a spec violation. The dropped tools are still reported through
   * `refreshExcludedTools`, which lists them with their reason.
   */
  private excludeInvalidXMcpHeaderTools(tools: Tool[]): Tool[] {
    if (!this.excludesInvalidXMcpHeaderTools()) return tools;
    return tools.filter(
      (tool) => scanXMcpHeaderDeclarations(tool.inputSchema).valid,
    );
  }

  /**
   * Re-walk a list method with pagination validated but entries left raw, then
   * validate each entry on its own — keeping the good ones and reporting the
   * rest (#1909).
   *
   * Two deliberate properties:
   *
   * - **The original error wins when nothing is salvageable.** If every entry
   *   validates here, the strict rejection was about something else (a
   *   top-level field, an era codec decision), so there is no per-item story to
   *   tell and swallowing it would hide a real failure. Rethrow the original.
   * - **A salvaged response is still a rejected response.** The Protocol entry
   *   is marked (#1953) with what was dropped, so the wire truth survives even
   *   though the list now renders.
   *
   * This walk is deliberately un-cached (it uses the raw per-page path), which
   * is fine: it only runs against a server that just returned a non-conforming
   * result.
   */
  private async salvageList<T>({
    method,
    itemsKey,
    itemSchema,
    resultSchema,
    metadata,
    err,
  }: {
    method: string;
    itemsKey: string;
    itemSchema: z.ZodType<T>;
    resultSchema: z.ZodObject;
    metadata?: RequestMetadata;
    err: unknown;
  }): Promise<T[]> {
    const pageSchema = lenientListPageSchema(resultSchema, itemsKey);
    // Capture the correlation id BEFORE re-walking. `markResponseRejected`
    // resolves "the last response received for this method", and the re-walk
    // below answers that same method one or more times — so marking afterwards
    // would stamp the rejection onto a salvage page that succeeded and leave
    // the actually-invalid response rendering as a clean success, which is the
    // precise lie #1953 exists to remove.
    const rejectedResponseId = this.lastAnsweredRequestByMethod.get(method);
    const valid: T[] = [];
    const malformed: MalformedListItem[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    try {
      do {
        // Bounded like the SDK aggregate this stands in for: a server emitting
        // endlessly UNIQUE cursors never trips the repeated-cursor guard below,
        // so without this the walk would run forever. Aborting surfaces the
        // original validation error rather than a truncated list.
        if (pages >= LIST_MAX_PAGES) throw listPaginationExceeded(method);
        pages += 1;
        const effectiveMeta = this.mergeMeta(metadata);
        const params = {
          ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
          // `!== undefined`, not truthiness: "" is a valid cursor, and dropping it
          // would re-request page one and duplicate its entries until the
          // repeated-cursor guard below stopped the walk.
          ...(cursor !== undefined && { cursor }),
        };
        // The modern (2026-07-28) codec validates a result against the SPEC
        // schema for the method before the caller's schema is consulted, so a
        // lenient `client.request` is rejected exactly as the strict one was —
        // there is no salvage without going around it. The raw-wire channel that
        // exists for the modern `tasks/*` methods does precisely that: the frame
        // goes straight through the transport (still logged for the Protocol /
        // Network tabs) and only the caller's schema is applied. Legacy keeps the
        // ordinary SDK path, which honors request options and `_meta` for us.
        const page = await this.invokeMcpClient(
          () =>
            this.isModernEra()
              ? this.rawWireRequest(
                  method,
                  this.withModernEnvelope(params),
                  pageSchema,
                )
              : this.client!.request(
                  { method, params },
                  pageSchema,
                  this.getRequestOptions(this.progressTokenOf(metadata)),
                ),
          { method },
        );
        // The raw-wire path skips the era codec, so the envelope it would have
        // enforced is checked here; a violation is not salvageable.
        if (
          this.isModernEra() &&
          !ModernResultEnvelopeSchema.safeParse(page).success
        ) {
          throw err;
        }
        const items = rawItemsOf(page, itemsKey);
        // The page's list member is missing or isn't a list: a top-level
        // violation, not a per-item one. Reading it as "no entries" would return
        // a silently truncated list and discard the strict error that was right
        // about it.
        if (items === undefined) throw err;
        const salvaged = salvageListItems({
          method,
          items,
          schema: itemSchema,
          startIndex: valid.length + malformed.length,
        });
        valid.push(...salvaged.valid);
        malformed.push(...salvaged.malformed);
        cursor = nextCursorOf(page);
        if (cursor !== undefined) {
          /* v8 ignore next -- defensive: a spec-compliant server never repeats a cursor; this guards a non-converging server from an infinite walk (mirrors the SDK's drainList guard) */
          if (seenCursors.has(cursor)) break;
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
    } catch (walkErr) {
      // The re-walk itself failed — its own decode rejection (a malformed
      // `nextCursor`, an unsalvageable page), or the connection going away
      // mid-walk. Either way the ORIGINAL error is the one to surface: it is
      // what the caller's list actually failed on, and `rejectedResponseId`
      // above was captured for that response, not this one. The secondary
      // failure is logged so it stays diagnosable rather than vanishing.
      if (walkErr !== err) {
        this.logger.warn(
          { err: walkErr, method },
          "Salvage re-walk failed; surfacing the original list error",
        );
      }
      this.restoreResponseCorrelation(method, rejectedResponseId);
      throw err;
    }

    // Nothing per-item was wrong, so the strict rejection was about something
    // this fallback cannot explain — surface it rather than hide it.
    if (malformed.length === 0) {
      this.restoreResponseCorrelation(method, rejectedResponseId);
      throw err;
    }

    if (rejectedResponseId !== undefined) {
      this.dispatchTypedEvent("responseRejected", {
        id: rejectedResponseId,
        reason: summarizeMalformed(malformed),
      });
    }
    this.setMalformedListItems(method, malformed);
    this.logger.warn(
      { method, malformed },
      "Dropped malformed entries from a list result; the rest of the list was kept",
    );
    return valid;
  }

  /** The current SEP-2243 excluded-tools set (empty on legacy/stdio). */
  getExcludedTools(): ExcludedTool[] {
    return this.excludedTools;
  }

  /**
   * Recompute the tools the SDK excludes from `tools/list` for invalid
   * `x-mcp-header` annotations (SEP-2243), and emit `excludedToolsChange`.
   * Returns `[]` without any round trip on connections that don't exclude
   * (legacy/stdio). Otherwise walks every page of the RAW `tools/list` (which,
   * unlike the SDK's high-level `listTools()`, is NOT filtered) and keeps the
   * tools whose annotation scan fails, each with its reason. A repeating cursor
   * stops the walk (non-converging-server guard, mirroring the SDK).
   */
  async refreshExcludedTools(
    metadata?: RequestMetadata,
  ): Promise<ExcludedTool[]> {
    const excluded: ExcludedTool[] = [];
    // Gated to connections that actually exclude; otherwise this is a pure
    // no-op (no round trip). The raw `listTools` below guards the connection.
    if (this.excludesInvalidXMcpHeaderTools()) {
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        // Same bound as `salvageList`, for the same reason: this walk is also
        // outside the SDK aggregate's `listMaxPages` cap. Throwing (rather than
        // committing a partial set) keeps the caller's "the excluded list may
        // be incomplete" warning the honest description of what happened.
        if (pages >= LIST_MAX_PAGES) throw listPaginationExceeded("tools/list");
        pages += 1;
        const page = await this.listToolsForScan(cursor, metadata);
        for (const tool of page.tools) {
          const scan = scanXMcpHeaderDeclarations(tool.inputSchema);
          if (!scan.valid) excluded.push({ tool, reason: scan.reason });
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          /* v8 ignore next -- defensive: a spec-compliant server never repeats a cursor; this guards a non-converging server from an infinite walk (mirrors the SDK's drainList guard) */
          if (seenCursors.has(cursor)) break;
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
    }
    // The scan deliberately does NOT publish what it dropped into the
    // `tools/list` report. That report is rendered above the Tools list as
    // "entries dropped from this list", and the aggregate is what that list
    // is — so only the aggregate's salvage may write it.
    //
    // The reason is stronger than "these are two different requests". A
    // successful strict aggregate means every entry parsed, so the rendered
    // list has no malformed entries in it at all; and a FAILED aggregate runs
    // salvage, which writes the report itself. So by the time this walk finds
    // something, either the aggregate already reported it (with the indices
    // that match what is on screen), or the aggregate succeeded and whatever
    // this walk just found is provably not in the list being displayed — the
    // server changed, or the aggregate came from cache. Publishing here can
    // therefore only ever name entries the user cannot see.
    //
    // The finding is not lost: `listToolsForScan` marks the scan's own refused
    // response, so it surfaces on the Protocol entry for the exchange that
    // actually carried it, which is where it is true.
    this.excludedTools = excluded;
    this.dispatchTypedEvent("excludedToolsChange", excluded);
    return excluded;
  }

  /**
   * One page of the RAW `tools/list` for the SEP-2243 scan, tolerating a
   * malformed sibling entry (#1632 + #1909).
   *
   * The scan needs the unfiltered list, so it uses the strict single-page call
   * — but that call rejects the whole page when any entry is non-conforming,
   * which would blank the excluded set and leave a tool that vanished for an
   * invalid header with no explanation at all. That is the same failure #1909
   * is about, one level down. So on a decode rejection the page is re-fetched
   * leniently and scanned entry by entry.
   *
   * The malformed ones are not "excluded tools" and are not returned: they
   * describe THIS exchange, not the aggregate the Tools panel renders, so they
   * surface as the rejection reason on this response's own Protocol entry and
   * go no further (see `refreshExcludedTools`).
   */
  private async listToolsForScan(
    cursor: string | undefined,
    metadata: RequestMetadata | undefined,
  ): Promise<{
    tools: Tool[];
    nextCursor?: string;
  }> {
    try {
      return await this.listTools(cursor, metadata);
    } catch (err) {
      if (!isSalvageableRejection(err)) throw err;
      // Capture before the re-fetch, for the reason `salvageList` documents:
      // this refused response is a distinct exchange from the aggregate's, and
      // the re-fetch below moves the method's correlation off it. Without this
      // the scan's Protocol entry renders as a clean success even though the
      // client refused the result.
      const rejectedResponseId =
        this.lastAnsweredRequestByMethod.get("tools/list");
      try {
        const effectiveMeta = this.mergeMeta(metadata);
        const params = {
          ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
          // See `salvageList`: "" is a valid cursor.
          ...(cursor !== undefined && { cursor }),
        };
        const pageSchema = lenientListPageSchema(
          ListToolsResultSchema,
          "tools",
        );
        // Through `invokeMcpClient`, like the strict `listTools` above and like
        // `salvageList`'s walk: this re-fetch can meet an auth challenge of its
        // own, and outside that wrapper the recovery never runs. Its failure is
        // then swallowed by `listAllTools`'s best-effort scan catch, leaving a
        // stale excluded-tools set and no sign of why.
        const page = await this.invokeMcpClient(
          () =>
            this.isModernEra()
              ? this.rawWireRequest(
                  "tools/list",
                  this.withModernEnvelope(params),
                  pageSchema,
                )
              : this.client!.request(
                  { method: "tools/list", params },
                  pageSchema,
                  this.getRequestOptions(this.progressTokenOf(metadata)),
                ),
          { method: "tools/list" },
        );
        // Same era-envelope check as `salvageList` — the raw-wire path bypasses
        // the codec that would otherwise enforce it.
        if (
          this.isModernEra() &&
          !ModernResultEnvelopeSchema.safeParse(page).success
        ) {
          throw err;
        }
        const items = rawItemsOf(page, "tools");
        // Not a list at all — a top-level violation the per-item pass can't
        // explain, so the strict error stands (mirrors `salvageList`).
        if (items === undefined) throw err;
        const { valid, malformed } = salvageListItems({
          method: "tools/list",
          items,
          schema: toolItemSchemaForEra(this.isModernEra()),
        });
        // Mark regardless of what the re-fetch found. The list can change
        // between the two requests, so a conforming re-fetch is possible — and
        // it says nothing about the response that was actually refused. Leaving
        // that one unmarked because the SECOND request came back clean would
        // render a rejected exchange as a clean success, which is the lie
        // #1953 removes. With nothing per-item to name, the original decode
        // error is the reason.
        if (rejectedResponseId !== undefined) {
          this.dispatchTypedEvent("responseRejected", {
            id: rejectedResponseId,
            reason:
              malformed.length > 0
                ? summarizeMalformed(malformed)
                : err instanceof Error
                  ? err.message
                  : String(err),
          });
        }
        const nextCursor = nextCursorOf(page);
        return {
          tools: valid,
          ...(nextCursor !== undefined && { nextCursor }),
        };
      } catch (fallbackErr) {
        // The fallback could not explain the rejection — the re-fetch itself
        // failed, or the page carried a violation that is not per-item (a bad
        // modern envelope, a `tools` that is not a list).
        //
        // `salvageList` can simply rethrow here, because ITS caller
        // (`ManagedListState.refresh`) marks the Protocol entry from the error
        // it receives. This walk has no such backstop: `listAllTools` catches
        // and LOGS a failing scan so it can never fail the tools list, so an
        // unmarked rethrow leaves the response the client demonstrably refused
        // (`isSalvageableRejection` above proves it was an `InvalidResult`)
        // rendering as a clean exchange — the exact lie #1953 removes and the
        // one this method's own capture above exists to prevent. So mark it
        // here, with the ORIGINAL decode error as the reason: the fallback's
        // own failure is a different event, and the response being marked is
        // the one `err` was raised for.
        if (rejectedResponseId !== undefined) {
          this.dispatchTypedEvent("responseRejected", {
            id: rejectedResponseId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        if (fallbackErr !== err) {
          this.logger.warn(
            { err: fallbackErr },
            "Excluded-tools salvage re-fetch failed; surfacing the original list error",
          );
        }
        // Restore the correlation the re-fetch moved, so a later mark for this
        // method does not land on a lenient page that succeeded.
        this.restoreResponseCorrelation("tools/list", rejectedResponseId);
        throw err;
      }
    }
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
    generalMetadata?: RequestMetadata,
    toolSpecificMetadata?: RequestMetadata,
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
   * Coerce the string-valued entries of a tool's arguments to the types its
   * `inputSchema` declares (the Tools form hands everything over as text).
   * Shared by the two `tools/call` entry points — {@link attemptToolCall} and
   * {@link callToolStream} — so both put the SAME arguments on the wire.
   */
  private convertStringToolArgs(
    tool: Tool,
    args: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    const stringArgs: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        stringArgs[key] = value;
      }
    }
    if (Object.keys(stringArgs).length === 0) return args;
    return { ...args, ...convertToolParameters(tool, stringArgs) };
  }

  /**
   * SEP-2243: mirror `x-mcp-header`-annotated arguments into `Mcp-Param-*`
   * headers on a modern connection. The SDK only does this inside
   * `client.callTool()` (and skips it in the browser), but we route
   * `tools/call` through `client.request()` for manual MRTR driving (#1704), so
   * we mirror ourselves. `Protocol.request` forwards `headers` (preserved
   * across MRTR retry legs) to the transport, and the remote transport relays
   * them to the backend's upstream send — issued server-side, where the browser
   * skip doesn't apply. No-op on legacy/stdio (no annotations).
   *
   * Applied by BOTH `tools/call` entry points: a plain call
   * ({@link attemptToolCall}) and a task-augmented one
   * ({@link callToolStream}) — a strict modern server rejects either with
   * `-32020` when the mirrored header is missing.
   */
  private applyMirroredParamHeaders(
    tool: Tool,
    convertedArgs: Record<string, JsonValue>,
    requestOptions: RequestOptions,
  ): void {
    if (this.protocolEra !== "modern") return;
    const paramHeaders = mcpParamHeadersForTool(tool, convertedArgs);
    if (Object.keys(paramHeaders).length === 0) return;
    requestOptions.headers = { ...requestOptions.headers, ...paramHeaders };
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
    const convertedArgs = this.convertStringToolArgs(tool, args);

    // Merge general metadata with tool-specific metadata; tool-specific wins.
    const callMetadata: RequestMetadata | undefined =
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
      _meta?: RequestMetadata;
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
      this.progressTokenOf(metadata),
      signal,
    );
    this.applyMirroredParamHeaders(tool, convertedArgs, requestOptions);
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
    const rawResult = await this.invokeMcpClient(
      () =>
        this.requestWithInputRequired(
          "tools/call",
          callParams,
          CallToolResultSchema,
          requestOptions,
        ),
      { method: "tools/call", toolName: tool.name },
    );

    // Unsolicited modern task handle (SEP-2663): on a modern connection the
    // server may answer ANY `tools/call` with a task rather than a result. The
    // transport rewrote that frame into a `CallToolResult` carrying the real
    // `DetailedTask` in `_meta`; poll it to completion here (the run-as-task
    // path does the same via `callToolStream`) so the ordinary call resolves to
    // the task's final result and the Tasks tab tracks it.
    const taskHandle = (rawResult as CallToolResult)._meta?.[
      MODERN_TASK_HANDLE_META
    ] as ModernDetailedTask | undefined;
    const result = taskHandle
      ? await this.pollModernTaskToTermination(taskHandle)
      : rawResult;

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
    generalMetadata: RequestMetadata | undefined,
    toolSpecificMetadata: RequestMetadata | undefined,
    errorMessage: string,
  ): void {
    const callMetadata: RequestMetadata | undefined =
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
   * When a modern (SEP-2663) task is `input_required`, fulfil its embedded
   * `inputRequests` through the pending-request UI and submit them via
   * `tasks/update`. No-op for any other status. Shared by the streaming
   * ({@link pollTaskToolCall}) and ordinary ({@link pollModernTaskToTermination})
   * poll loops so the input handling lives in one place.
   *
   * `priorRounds` is the count of `input_required` rounds already handled for
   * this task; the return value is the updated count. A non-conformant server
   * that keeps returning `input_required` without ever completing would
   * otherwise re-prompt the user on every poll forever, so we bound it with the
   * same {@link MRTR_MAX_ROUNDS} cap the MRTR driver uses.
   */
  private async submitModernTaskInput(
    detailed: ModernDetailedTask,
    task: Task,
    priorRounds: number,
    signal?: AbortSignal,
  ): Promise<number> {
    if (task.status !== "input_required") {
      return priorRounds;
    }
    const rounds = priorRounds + 1;
    if (rounds > InspectorClient.MRTR_MAX_ROUNDS) {
      throw new Error(
        `Modern task "${task.taskId}" exceeded ${InspectorClient.MRTR_MAX_ROUNDS} input_required rounds without completing.`,
      );
    }
    const inputResponses = await this.fulfilInputRequests(
      this.tagInputRequestsWithTask(readInputRequests(detailed), task.taskId),
      signal,
      "task-input-required",
    );
    /* v8 ignore next 3 -- a conformant `input_required` task always carries
       `inputRequests`, so `fulfilInputRequests` returns a (possibly empty)
       object here, never undefined; the guard is defensive. */
    if (inputResponses) {
      await this.updateRequestorTask(task.taskId, inputResponses);
    }
    return rounds;
  }

  /**
   * Stamp `_meta[RELATED_TASK_META_KEY]` with the owning task id on each embedded
   * request of a modern task's `inputRequests`. The pending-request UI reads that
   * id (via `ElicitationCreateMessage.taskId`) so its Cancel control can cancel
   * the TASK — not just answer the request — when a task is paused at
   * `input_required`.
   */
  private tagInputRequestsWithTask(
    inputRequests: InputRequests | undefined,
    taskId: string,
  ): InputRequests | undefined {
    /* v8 ignore next -- only called for an input_required task, which always
       carries inputRequests; the undefined passthrough is defensive. */
    if (!inputRequests) return inputRequests;
    const tagged: Record<string, unknown> = {};
    for (const [key, req] of Object.entries(inputRequests)) {
      const request = req as { params?: { _meta?: Record<string, unknown> } };
      tagged[key] = {
        ...request,
        params: {
          ...request.params,
          _meta: {
            ...request.params?._meta,
            [RELATED_TASK_META_KEY]: { taskId },
          },
        },
      };
    }
    return tagged as InputRequests;
  }

  /**
   * Terminal outcome for a modern task: the inlined `CallToolResult` for a
   * `completed` task (SEP-2663 removed the blocking `tasks/result`), or a
   * `ProtocolError` for `failed` / `cancelled`. Shared so both poll loops agree
   * on the result/error shape.
   */
  private modernTaskTerminalOutcome(
    task: Task,
    detailed: ModernDetailedTask,
  ):
    | { type: "result"; result: CallToolResult }
    | { type: "error"; error: ProtocolError } {
    if (task.status === "completed") {
      /* v8 ignore next -- a conformant `completed` task always inlines its
         `result`; the `{ content: [] }` fallback is defensive. */
      return {
        type: "result",
        result: (detailed.result ?? { content: [] }) as CallToolResult,
      };
    }
    return {
      type: "error",
      error: new ProtocolError(
        ProtocolErrorCode.InternalError,
        task.statusMessage ?? `Task ${task.status}`,
      ),
    };
  }

  /**
   * Poll cadence for a task: the server-advertised `pollInterval` when
   * positive, else the default. Shared by every task poll loop (both eras).
   */
  private taskPollInterval(task: Task): number {
    const advertised = task.pollInterval;
    if (typeof advertised !== "number") return DEFAULT_TASK_POLL_INTERVAL_MS;
    // A spec-conformant server never advertises a non-positive interval; the
    // `> 0` guard is defensive against a malformed value.
    /* v8 ignore next -- non-positive pollInterval is unreachable from a conformant server. */
    return advertised > 0 ? advertised : DEFAULT_TASK_POLL_INTERVAL_MS;
  }

  /**
   * Register a per-task abort controller (keyed by taskId) whose signal gates
   * the task's `input_required` pending request, and return the signal plus a
   * `release` cleanup. {@link cancelRequestorTask} aborts it to unblock a task
   * paused at the pending-request modal.
   */
  private registerTaskInputAbort(taskId: string): {
    signal: AbortSignal;
    release: () => void;
  } {
    const controller = new AbortController();
    this.taskInputAbortControllers.set(taskId, controller);
    return {
      signal: controller.signal,
      release: () => {
        // Only delete our own entry — tool calls are serial, so a second task
        // never replaces this id's controller mid-poll; the guard is defensive.
        /* v8 ignore next */
        if (this.taskInputAbortControllers.get(taskId) === controller) {
          this.taskInputAbortControllers.delete(taskId);
        }
      },
    };
  }

  /**
   * Drive a modern (SEP-2663) task to a terminal state from a seed
   * `DetailedTask`, dispatching task events so the Tasks tab and toasts track
   * it, and return the completed task's inlined `CallToolResult` (or throw on
   * `failed` / `cancelled`). Used by the ORDINARY `callTool` path when a server
   * returns an unsolicited task handle (the run-as-task streaming path drives
   * the equivalent loop inline in {@link pollTaskToolCall}). `input_required`
   * rounds are answered through the pending-request UI and submitted via
   * `tasks/update`.
   */
  private async pollModernTaskToTermination(
    seed: ModernDetailedTask,
  ): Promise<CallToolResult> {
    let detailed = seed;
    let task = normalizeModernTask(detailed);
    const emit = (t: Task): void => {
      this.dispatchTypedEvent("toolCallTaskUpdated", {
        taskId: t.taskId,
        task: t,
      });
      this.dispatchTypedEvent("requestorTaskUpdated", {
        taskId: t.taskId,
        task: t,
      });
    };
    emit(task);
    const { signal: inputSignal, release } = this.registerTaskInputAbort(
      task.taskId,
    );
    try {
      let inputRounds = 0;
      while (!InspectorClient.isTerminalTaskStatus(task.status)) {
        inputRounds = await this.submitModernTaskInput(
          detailed,
          task,
          inputRounds,
          inputSignal,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.taskPollInterval(task)),
        );
        detailed = await this.rawWireRequest(
          "tasks/get",
          this.withModernTaskEnvelope({ taskId: task.taskId }),
          ModernGetTaskResultSchema,
        );
        task = normalizeModernTask(detailed);
        emit(task);
      }
    } finally {
      release();
    }
    const outcome = this.modernTaskTerminalOutcome(task, detailed);
    if (outcome.type === "error") {
      throw outcome.error;
    }
    return outcome.result;
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
    // NOTE: the LEGACY task path does NOT opt into `allowInputRequired` (MRTR
    // over legacy tasks is out of scope for #1704). The MODERN path (SEP-2663)
    // instead surfaces a task's `input_required` through `tasks/get`'s
    // `inputRequests` and answers via `tasks/update` (handled in the poll loop
    // below), reusing the same pending-request UI.
    const modernTasks = this.isTasksExtensionNegotiated();
    const requestPromise = client.request(
      {
        // On modern the SDK codec stamps the tasks-extension client capability
        // into the request envelope (advertised at construction), so a server
        // may answer with a `CreateTaskResult` — no per-call `_meta` needed.
        method: "tools/call",
        params,
      },
      // Modern: the SDK codec can't decode a `resultType: "task"` result, so the
      // transport rewrote it to a `CallToolResult` carrying the task handle in
      // `_meta` — parse as a CallToolResult and read the handle below. Legacy:
      // accept a `{ task }` handle or an immediate result.
      modernTasks
        ? CallToolResultSchema
        : CreateTaskResultSchema.or(CallToolResultSchema),
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

    if (modernTasks) {
      // Modern (SEP-2663): a task-creating `tools/call` came back as a
      // `resultType: "task"` frame the SDK can't decode, so the transport
      // rewrote it to a `CallToolResult` carrying the real `DetailedTask` under
      // MODERN_TASK_HANDLE_META. A synchronous completion has no such handle —
      // yield that `CallToolResult` directly.
      const handle = (created as CallToolResult)._meta?.[
        MODERN_TASK_HANDLE_META
      ] as ModernDetailedTask | undefined;
      if (!handle) {
        yield { type: "result", result: created as CallToolResult };
        return;
      }
      let detailed = handle;
      let task = normalizeModernTask(detailed);
      yield { type: "taskCreated", task };
      if (progressSubscriptionId != null && requestOptions.onprogress) {
        progressHandlers.set(progressSubscriptionId, requestOptions.onprogress);
      }
      const { signal: inputSignal, release } = this.registerTaskInputAbort(
        task.taskId,
      );
      let inputRounds = 0;
      try {
        while (!InspectorClient.isTerminalTaskStatus(task.status)) {
          // `input_required`: fulfil the embedded server→client requests through
          // the same pending-request UI the MRTR path uses, then submit them via
          // `tasks/update`. The update is eventually consistent — the task's
          // status advances on a following `tasks/get`, so keep polling
          // (bounded by MRTR_MAX_ROUNDS against a server that never advances).
          // `inputSignal` fires if the task is cancelled while paused here.
          inputRounds = await this.submitModernTaskInput(
            detailed,
            task,
            inputRounds,
            inputSignal,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, this.taskPollInterval(task)),
          );
          detailed = await this.rawWireRequest(
            "tasks/get",
            this.withModernTaskEnvelope({ taskId: task.taskId }),
            ModernGetTaskResultSchema,
          );
          task = normalizeModernTask(detailed);
          yield { type: "taskStatus", task };
        }
      } finally {
        release();
        if (progressSubscriptionId != null) {
          progressHandlers.delete(progressSubscriptionId);
        }
      }
      // Modern removes the blocking `tasks/result`: a completed task inlines its
      // CallToolResult; failed/cancelled surface as an error.
      yield this.modernTaskTerminalOutcome(task, detailed);
      return;
    }

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
        await new Promise((resolve) =>
          setTimeout(resolve, this.taskPollInterval(task)),
        );
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
    generalMetadata?: RequestMetadata,
    toolSpecificMetadata?: RequestMetadata,
    taskOptions?: { ttl?: number },
  ): Promise<ToolCallInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const convertedArgs = this.convertStringToolArgs(tool, args);

      // Merge general metadata with tool-specific metadata; tool-specific wins.
      const callMetadata: RequestMetadata | undefined =
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
      const requestOptions = this.getRequestOptions(
        this.progressTokenOf(metadata),
      );
      // The task-augmented `tools/call` needs the same SEP-2243 mirroring as the
      // plain one — a strict modern server rejects it with -32020 otherwise.
      this.applyMirroredParamHeaders(tool, convertedArgs, requestOptions);
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
            { cause: resultError },
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
      const callMetadata: RequestMetadata | undefined =
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
    metadata?: RequestMetadata,
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
        this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata;
  }): Promise<{ resources: Resource[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const resources = await this.listAllSalvaging({
      method: "resources/list",
      itemsKey: "resources",
      resultSchema: ListResourcesResultSchema,
      itemSchema: ResourceSchema,
      metadata: options?.metadata,
      aggregate: async () => [
        ...(
          await this.client!.listResources(
            this.aggregateListParams(options?.metadata),
            this.getCacheableRequestOptions(options?.cacheMode),
          )
        ).resources,
      ],
    });
    return { resources };
  }

  /**
   * Read a resource by URI
   * @param uri Resource URI
   * @param metadata Optional metadata to include in the request
   * @returns Resource content
   */
  async readResource(
    uri: string,
    metadata?: RequestMetadata,
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
          this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata,
  ): Promise<ResourceTemplateReadInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    const uriTemplateString = uriTemplate;

    // Expand through the shared helper in ./uriTemplate.js so this and the web
    // Resources form cannot disagree. It covers the expression shapes the SDK's
    // own expander gets wrong -- `{a,b}`, `{;id}`, and the `{id:3}` prefix
    // modifier (#1919).
    //
    // `params` is passed through AS GIVEN. Only an *absent* key omits its
    // expression; a key present with `""` is a defined RFC 6570 value and
    // expands (`{?q}` -> `?q=`, `{;q}` -> `;q`), which is what lets a caller
    // request those URIs deliberately. A caller whose values come from a form
    // -- where an untouched field is indistinguishable from a deliberately
    // empty one -- drops its blanks with `definedValues` first, as the TUI's
    // ResourceTestModal does.
    let expandedUri: string;
    try {
      expandedUri = expandUriTemplateStrict(uriTemplateString, params);
    } catch (error) {
      throw new Error(
        `Failed to expand URI template "${uriTemplate}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
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
    metadata?: RequestMetadata,
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
          this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata;
  }): Promise<{ resourceTemplates: ResourceTemplate[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const resourceTemplates = await this.listAllSalvaging({
      method: "resources/templates/list",
      itemsKey: "resourceTemplates",
      resultSchema: ListResourceTemplatesResultSchema,
      itemSchema: ResourceTemplateSchema,
      metadata: options?.metadata,
      aggregate: async () => [
        ...(
          await this.client!.listResourceTemplates(
            this.aggregateListParams(options?.metadata),
            this.getCacheableRequestOptions(options?.cacheMode),
          )
        ).resourceTemplates,
      ],
    });
    return { resourceTemplates };
  }

  /**
   * List available prompts with pagination support
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing prompts array and optional nextCursor
   */
  async listPrompts(
    cursor?: string,
    metadata?: RequestMetadata,
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
        this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata;
  }): Promise<{ prompts: Prompt[] }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const prompts = await this.listAllSalvaging({
      method: "prompts/list",
      itemsKey: "prompts",
      resultSchema: ListPromptsResultSchema,
      itemSchema: PromptSchema,
      metadata: options?.metadata,
      aggregate: async () => [
        ...(
          await this.client!.listPrompts(
            this.aggregateListParams(options?.metadata),
            this.getCacheableRequestOptions(options?.cacheMode),
          )
        ).prompts,
      ],
    });
    return { prompts };
  }

  /**
   * The Skills extension (SEP-2640) the server declared, or `undefined` when it
   * declared none. Gates the Skills tab and the skills store the same way
   * {@link isTasksExtensionNegotiated} gates Tasks — but deliberately without an
   * era check: `skills/*` are not spec method names in either codec, so a
   * legacy-era server that declares the extension is serving it (#2234).
   */
  getSkillsExtension(): SkillsExtensionSupport | undefined {
    return getSkillsExtension(this.capabilities);
  }

  /**
   * One page of `skills/list` (SEP-2640).
   *
   * An ordinary `client.request` with an explicit result schema — the SDK's era
   * gate skips methods neither codec defines, and `assertCapabilityForMethod`
   * falls through to a no-op for them, so this is all the extension needs. The
   * raw-wire path modern `tasks/*` uses would be wrong here: it exists for spec
   * names the 2026 codec deleted, and taking it would bypass the SDK's response
   * correlation for nothing (#2234).
   */
  async listSkills(
    cursor?: string,
    metadata?: RequestMetadata,
  ): Promise<{ skills: SkillEntry[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: Record<string, unknown> = {
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
      // `!== undefined`, not truthiness: a cursor is opaque and the empty
      // string is a legal value. Dropping `""` would silently re-request page
      // one, which the store then reports as a repeated-cursor failure — a
      // conforming server made to look broken.
      ...(cursor !== undefined ? { cursor } : {}),
    };
    const response = await this.invokeMcpClient(
      () =>
        this.client!.request(
          { method: SKILLS_LIST_METHOD, params },
          ListSkillsResultSchema,
          this.getRequestOptions(this.progressTokenOf(metadata)),
        ),
      { method: SKILLS_LIST_METHOD },
    );
    return {
      skills: response.skills,
      nextCursor: response.nextCursor,
    };
  }

  /**
   * One skill entry by URI (`skills/get`, SEP-2640). The result envelope is
   * required — `GetSkillResultSchema` unwraps `{ skill }` and rejects an entry
   * returned inline, so a non-conforming shape fails here rather than being
   * silently normalized past the conformance checks.
   */
  async getSkill(uri: string, metadata?: RequestMetadata): Promise<SkillEntry> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params: Record<string, unknown> = {
      uri,
      ...(effectiveMeta ? { _meta: effectiveMeta } : {}),
    };
    // `GetSkillResultSchema` unwraps the envelope, so there is nothing to
    // unwrap here.
    return this.invokeMcpClient(
      () =>
        this.client!.request(
          { method: SKILLS_GET_METHOD, params },
          GetSkillResultSchema,
          this.getRequestOptions(this.progressTokenOf(metadata)),
        ),
      { method: SKILLS_GET_METHOD },
    );
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
    metadata?: RequestMetadata,
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
          this.getRequestOptions(this.progressTokenOf(metadata)),
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
    metadata?: RequestMetadata,
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
            this.getRequestOptions(this.progressTokenOf(metadata)),
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
        { cause: error },
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
   * Set roots and announce the change to the server.
   *
   * Note this does **not** enable the roots capability on a client that was
   * built without the constructor's `roots` option. `capabilities.roots` is
   * negotiated at `initialize` and the SDK refuses `registerCapabilities`
   * after connect, so such a client has no `roots/list` handler (see {@link
   * registerPeerRequestHandlers}) and would have to answer `-32601` if a
   * server asked. So on such a client the roots set here are stored and
   * readable via {@link getRoots}, but no server can ask for them and the
   * change is not announced — the SDK refuses `roots/list_changed` from a
   * client that never declared `roots.listChanged`, so the notification could
   * not have gone out anyway. Pass `roots` at construction — `[]` is enough —
   * in any client that may call this (#1797).
   *
   * The argument runs through `cleanRoots`, the same normalizer the
   * connect-time and settings-save paths use, so all three ways roots enter the
   * client agree and no caller can advertise a `Root` with no `uri` (the CLI's
   * `--roots-json` only checks that the JSON is an array). It is idempotent, so
   * a caller that already cleaned loses nothing.
   */
  async setRoots(roots: Root[]): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    this.roots = cleanRoots(roots);
    // Copy, as `getRoots()` does — a listener must not be able to push into the
    // list we advertise.
    this.dispatchTypedEvent("rootsChange", [...this.roots]);

    // The *server* needn't advertise support for this notification, but the
    // *client* must have declared `roots.listChanged` to send it. The SDK
    // enforces that itself — `notification()` rejects with "Client does not
    // support roots list changed notifications" — so nothing reaches the wire
    // on a client built without `roots`, and the server is never invited to
    // re-fetch something we'd answer `-32601`. Returning early only avoids
    // provoking that rejection and logging it as a *failure*: it isn't one, it
    // is a client that was never able to announce (#1797).
    if (!this.rootsListChangedCapabilityAdvertised) {
      this.logger.warn(
        "setRoots() on a client that did not advertise `roots.listChanged`; " +
          "roots are stored locally but the change is not announced",
      );
      return;
    }
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
    const filter: SubscriptionFilter = {};
    // Omitted rather than sent empty: a listChanged-only stream (#1920) is not
    // subscribing to any resource, and `[]` would say it asked for none of a set
    // it is participating in.
    if (this.subscribedResources.size > 0) {
      filter.resourceSubscriptions = Array.from(this.subscribedResources);
    }
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
   * Whether the modern listen stream should be open: the built filter carries
   * something to listen for (#1920). Before #1920 this was "at least one URI is
   * subscribed", which made the stream unreachable on a server with no resources
   * — a tools-only server advertising `tools.listChanged` had no way to open it,
   * so `notifications/tools/list_changed` could never arrive. The filter already
   * modelled the list-change opt-ins; only the trigger was narrower than the
   * filter it built. This matches the SDK's own `ClientOptions.listChanged`
   * auto-open, which opens whenever the effective (config ∩ capability)
   * intersection is non-empty.
   *
   * Note this is deliberately *not* the same predicate as the stream state's
   * `active` — see `modernStreamActive()`.
   */
  private wantsModernStream(): boolean {
    const filter = this.buildSubscriptionFilter();
    return (
      (filter.resourceSubscriptions?.length ?? 0) > 0 ||
      filter.toolsListChanged === true ||
      filter.resourcesListChanged === true ||
      filter.promptsListChanged === true
    );
  }

  /**
   * Whether the stream state reports `active` — i.e. whether the *Subscriptions*
   * UI has a stream to describe. That is a narrower question than
   * `wantsModernStream()`: `ResourceSubscriptionStreamState` drives the
   * Subscriptions section's badge, so a stream open purely for list-change
   * notifications (no subscribed URI) has nothing to report there and stays
   * `active: false` (#1920). Keeping the two apart also preserves the invariant
   * the rest of this file is written against — an empty subscribed set is never
   * announced alongside an `active` stream.
   */
  private modernStreamActive(): boolean {
    return this.subscribedResources.size > 0;
  }

  /**
   * Open the modern listen stream at the end of a successful connect, when the
   * filter is non-empty (#1920). Only the list-change opt-ins can make it
   * non-empty here — the subscribed set is emptied by `resetSessionState()` on
   * the way in — so this is exactly the "server advertises a listChanged the
   * Inspector wants" case that had no trigger before.
   *
   * A failure is not allowed to fail the connect: the handshake succeeded and
   * every request-scoped feature works without this stream. It is reported the
   * way a lost stream is — hand it to the reconnect machinery, which retries
   * with backoff and settles on `"ended"` past the cap.
   *
   * Gated on the same generation test as `subscribeToResource` — see the long
   * comment there. The `connect` event has deliberately *not* been dispatched
   * yet (that is the point of running here), so a list-state consumer is not the
   * risk; what is, is anything else that bumps the generation while this
   * `listen()` is in flight. `statusChange` has already fired, and any
   * concurrent call on this instance qualifies: a `subscribeToResource` from a
   * caller restoring subscriptions, or a `disconnect()` — whose
   * `resetSubscriptionStream` bumps the generation too, making a reconcile here
   * arm a reconnect for a session that is already gone.
   */
  private async openModernListenStreamOnConnect(): Promise<void> {
    if (!this.isModernEra() || !this.wantsModernStream()) return;
    const generationBefore = this.modernListenGeneration;
    try {
      await this.refreshModernSubscription();
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to open the modern subscriptions/listen stream on connect",
      );
      if (this.modernListenGeneration === generationBefore + 1) {
        this.reconcileModernStreamStateAfterFailedRefresh();
      }
    }
  }

  /** Cancel a pending reconnect re-listen, if any (#1630). */
  private clearModernReconnectTimer(): void {
    if (this.modernReconnectTimer !== undefined) {
      clearTimeout(this.modernReconnectTimer);
      this.modernReconnectTimer = undefined;
    }
  }

  /**
   * (Re-)establish the modern `subscriptions/listen` stream to match the current
   * filter (#1630). Because the stream is not resumable, every filter change
   * re-lists: the existing stream is closed and a fresh `listen()` opened. With
   * an empty filter — no subscribed URIs *and* no enabled list-change opt-in the
   * server advertises — the stream is left closed (#1920).
   *
   * `modernListenGeneration` guards against races — if a newer refresh starts
   * while this one awaits its acknowledgement, the just-opened stream is
   * discarded rather than overwriting the newer one.
   */
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
      this.modernNeverAcknowledged = false;
    }
    const generation = ++this.modernListenGeneration;

    // Tear down the current stream before opening a replacement (re-listen).
    const previous = this.modernSubscription;
    this.modernSubscription = null;
    if (previous) {
      await closeSubscriptionBestEffort(previous);
    }

    // Nothing to listen for → keep the stream closed.
    if (!this.wantsModernStream()) {
      this.setModernStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
      return;
    }

    let subscription: McpSubscription;
    try {
      subscription = await this.client.listen(
        this.buildSubscriptionFilter(),
        this.getRequestOptions(),
      );
    } catch (error) {
      // Record the one rejection that must not be retried, so the failure
      // handlers can tell it from a drop (#2097). Recorded rather than acted on
      // here because *which* state to write depends on whether this caller still
      // owns the stream, which only they know — see
      // `reconcileModernStreamStateAfterFailedRefresh`.
      //
      // Gated on the same generation test the callers use: a newer refresh has
      // already cleared the flag for its own attempt, and a stale caller writing
      // to it afterwards would make that attempt's *unrelated* failure look
      // deterministic and end a stream that deserved a retry.
      if (
        generation === this.modernListenGeneration &&
        isNeverAcknowledgedSubscriptionClose(error)
      ) {
        this.modernNeverAcknowledged = true;
      }
      throw error;
    }

    // A newer refresh superseded us while awaiting the ack — discard this one.
    if (generation !== this.modernListenGeneration) {
      await closeSubscriptionBestEffort(subscription);
      return;
    }

    this.modernSubscription = subscription;
    // A successful acknowledgement ends any reconnect run: the backoff counts
    // only *consecutive* failed re-lists, so a stream that recovers and holds
    // starts fresh next time (#1630).
    this.modernReconnectAttempts = 0;
    this.setModernStreamState({
      active: this.modernStreamActive(),
      status: "acknowledged",
      honoredUris: subscription.honoredFilter.resourceSubscriptions ?? [],
    });

    // Observe termination; an unexpected drop reconnects by re-listing.
    void subscription.closed.then(
      (reason) =>
        this.onModernSubscriptionClosed(subscription, reason, generation),
      // The rejection arm exists because a `closed` that rejects carries no
      // reason to act on, and an unhandled rejection ends a Node process by
      // default. It is scoped to the rejection rather than chained after the
      // handler because the handler cannot throw today — it only assigns state,
      // dispatches on a native `EventTarget` (which reports listener throws
      // rather than propagating them) and arms a timer — and chaining a
      // `.catch` after it would silently abandon a re-listen if that ever
      // changed. (Closing a stream *resolves* `closed`; what the connect-path
      // close newly reaches is the handler running at all, where the reference
      // used to be dropped with `closed` pending forever.)
      () => {},
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
      this.wantsModernStream();
    if (!shouldReconnect) {
      // "stream gone but subscriptions remain" renders the same whether we gave
      // up after failed reconnects or the server closed it gracefully: keep the
      // ended badge while URIs are still subscribed. (A `disconnect()` clears
      // the set and forces the inactive state; a *crash* leaves both in place
      // until the next `connect()` calls `resetSubscriptionStream`, which moves
      // them together — so "active with an empty set" is never observable.)
      this.setModernStreamState({
        active: this.modernStreamActive(),
        status: "ended",
        honoredUris: [],
      });
      return;
    }

    // A drop of an established stream is not itself a failure — schedule a
    // re-listen at the current backoff (0 after a healthy stream, so the base
    // delay). The counter only advances when a re-listen actually fails.
    this.scheduleModernReconnect();
  }

  /**
   * Reconcile the stream state after a re-listen *this* call owned and lost
   * (#1797). Only correct for a caller that has not been superseded — a newer
   * refresh owns the state as well as the filter — so both call sites gate on
   * the generation first.
   *
   * The two branches are the empty and non-empty *filter* (#1920) — which is
   * "nothing subscribed" only when no list-change opt-in is live. The empty case
   * is the ordinary one: nothing to listen for, no stream, inactive. The
   * non-empty one exists because a failed re-listen leaves `modernSubscription`
   * null with the filter still wanting a stream, and nothing else will notice: the reconnect machinery is reachable only from a stream that closed
   * or a reconnect that failed, and neither happened here. Left alone, the state
   * keeps whatever the last success (or the optimistic `"connecting"`) wrote — a
   * badge that will never change over subscriptions the server may never have
   * honored, recoverable only by an Unsubscribe/Subscribe toggle (a fresh
   * Subscribe early-returns on the URI already being in the set).
   *
   * So it reconnects rather than settling for an honest-but-dead `"ended"`:
   * every other route to "stream gone, filter live" either expects the close or
   * has exhausted the retry cap, and this is the one that has made no attempt
   * at all. `scheduleModernReconnect` fits as-is — a user-initiated refresh
   * already reset `modernReconnectAttempts`, so it starts at the base delay; the
   * timer bails on a terminal status or an emptied filter; and past the cap
   * `onModernReconnectFailed` lands on the same `"ended"` badge. The state
   * therefore becomes true or ends after a real attempt. The caller still sees
   * its error either way — the retry is about the subscriptions, not the call.
   */
  private reconcileModernStreamStateAfterFailedRefresh(): void {
    if (!this.wantsModernStream()) {
      this.setModernStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
      return;
    }
    // The one failure a retry cannot fix (#2097) — end the stream here rather
    // than spending the whole backoff run on a server that will answer the same
    // way every time.
    if (this.modernNeverAcknowledged) {
      this.endModernStreamNeverAcknowledged();
      return;
    }
    this.scheduleModernReconnect();
  }

  /**
   * Settle the stream on the never-acknowledged close (#2097): a status of its
   * own so the UI can say what happened, no reconnect, and a log line carrying
   * the same sentence the UI shows.
   *
   * The state is *not* `"ended"` — that badge covers the two expected closes (a
   * server shutting an established stream down, and reconnection abandoned after
   * repeated failures), and reading this case as either of them is exactly the
   * silence #2063 reported.
   */
  private endModernStreamNeverAcknowledged(): void {
    this.clearModernReconnectTimer();
    this.logger.warn(
      { message: NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE },
      "subscriptions/listen closed without an acknowledgement",
    );
    this.setModernStreamState({
      active: this.modernStreamActive(),
      status: "never-acknowledged",
      honoredUris: [],
    });
  }

  /**
   * Schedule a reconnect re-listen after the current backoff delay (#1630).
   * `modernReconnectAttempts` reflects the number of *consecutive failed*
   * re-lists (reset to 0 on any successful acknowledgement), so the delay grows
   * only while re-listing keeps failing.
   */
  private scheduleModernReconnect(): void {
    this.setModernStreamState({
      active: this.modernStreamActive(),
      status: "reconnecting",
      honoredUris: [],
    });
    const delay = Math.min(
      MODERN_RECONNECT_BASE_MS * 2 ** this.modernReconnectAttempts,
      MODERN_RECONNECT_MAX_MS,
    );
    this.clearModernReconnectTimer();
    this.modernReconnectTimer = setTimeout(() => {
      this.modernReconnectTimer = undefined;
      // Disconnect/unsubscribe may have raced the timer — bail if the reconnect
      // is no longer wanted.
      if (isTerminalStatus(this.status) || !this.wantsModernStream()) {
        return;
      }
      this.refreshModernSubscription(true).catch(() =>
        this.onModernReconnectFailed(),
      );
    }, delay);
  }

  /**
   * A reconnect re-listen failed (#1630). Count it and either retry with a
   * longer backoff or, past the consecutive-failure cap, give up and mark the
   * stream ended (re-subscribing resets the run and tries again).
   */
  private onModernReconnectFailed(): void {
    // A reconnect that lost to the never-acknowledged close (#2097) ends the run
    // immediately: the remaining attempts would each buy the same answer. This
    // is reachable when a stream that *had* been acknowledged dropped and the
    // server has since started refusing to acknowledge.
    if (
      this.modernNeverAcknowledged &&
      !isTerminalStatus(this.status) &&
      this.wantsModernStream()
    ) {
      this.endModernStreamNeverAcknowledged();
      return;
    }
    this.modernReconnectAttempts += 1;
    if (
      this.modernReconnectAttempts > MODERN_RECONNECT_MAX_ATTEMPTS ||
      isTerminalStatus(this.status) ||
      !this.wantsModernStream()
    ) {
      this.setModernStreamState({
        active: this.modernStreamActive(),
        status: "ended",
        honoredUris: [],
      });
      return;
    }
    this.scheduleModernReconnect();
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
        // Reflect the subscription optimistically so the UI responds to the
        // click immediately, and show the stream as "connecting" until the
        // `listen()` acknowledgement lands (which can be a visible round-trip on
        // the modern era, unlike the single-shot legacy `resources/subscribe`).
        this.dispatchSubscriptionsChange();
        this.setModernStreamState({
          active: true,
          status: "connecting",
          honoredUris: this.modernStreamState.honoredUris,
        });
        // Read before the call, to tell "our refresh failed" from "someone else
        // took over" in the catch — see there.
        const generationBefore = this.modernListenGeneration;
        try {
          await this.refreshModernSubscription();
        } catch (error) {
          // Roll back the optimistic add + stream state so both stay consistent
          // with the server filter — but only while this call still owns that
          // filter. A refresh bumps the generation exactly once, synchronously,
          // so anything past that bump means something else advanced it, and
          // both bumpers make the rollback wrong:
          //
          // - a newer `refreshModernSubscription` built its filter from the set
          //   *including* this URI, so if it succeeded the server is honoring
          //   the subscription; deleting it here would leave the set missing a
          //   URI the live stream carries, the UI showing it unsubscribed while
          //   its `resources/updated` keep arriving.
          // - `resetSubscriptionStream` (a `disconnect()`, or the start-clean
          //   reset in `connect()`) already cleared the set and set the state,
          //   so there is nothing to roll back — and if the caller has since
          //   re-subscribed on the new session, this stale catch would delete a
          //   URI that session legitimately holds.
          //
          // Either way the state is no longer ours to correct. The error is
          // still the caller's to see.
          if (this.modernListenGeneration === generationBefore + 1) {
            // State before the announce, for `resetSubscriptionStream`'s
            // reason: on a last-URI rollback, dispatching first would expose an
            // empty set with a stream still reading `"connecting"` — the pair
            // this file treats as impossible. The reverse intermediate is the
            // benign one (and the optimistic add above already exposes it).
            this.subscribedResources.delete(uri);
            this.reconcileModernStreamStateAfterFailedRefresh();
            this.dispatchSubscriptionsChange();
          }
          throw error;
        }
        return;
      }
      await this.client.subscribeResource({ uri }, this.getRequestOptions());
      this.subscribedResources.add(uri);
      this.dispatchSubscriptionsChange();
    } catch (error) {
      throw new Error(
        `Failed to subscribe to resource: ${subscriptionFailureMessage(error)}`,
        { cause: error },
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
        //
        // Removing the last URI moves the stream to inactive before announcing
        // the set, rather than letting the re-listen below do it a round-trip
        // later: dispatching first would expose an empty set with an `active`
        // stream, which is the pair `resetSubscriptionStream` orders its own
        // writes to prevent. The re-listen sets the same state on arrival, and
        // sets it on the failure path too (see the catch).
        if (this.subscribedResources.size === 0) {
          this.setModernStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
        }
        this.dispatchSubscriptionsChange();
        // Same ownership test as `subscribeToResource` — see the long comment
        // there. Nothing to undo on this path (the removal is kept
        // deliberately), but the *state* still needs reconciling when this call
        // owned the re-listen that failed: it leaves no stream behind, and the
        // badge would otherwise keep reporting the last success.
        const generationBefore = this.modernListenGeneration;
        try {
          await this.refreshModernSubscription();
        } catch (error) {
          if (this.modernListenGeneration === generationBefore + 1) {
            this.reconcileModernStreamStateAfterFailedRefresh();
          }
          throw error;
        }
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
        `Failed to unsubscribe from resource: ${subscriptionFailureMessage(error)}`,
        { cause: error },
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
    /** Custom authorization-request parameters (#2018). Authorize URL only. */
    authorizationParams?: Record<string, string>;
    /** Endpoint overrides applied to the discovered AS metadata (#1906). */
    authorizationUrl?: string;
    tokenUrl?: string;
    /** Declare the `refresh_token` grant in client metadata (#2068). */
    requestRefreshToken?: boolean;
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

  /**
   * True when connect() sends the SDK's `server/discover` negotiation probe —
   * i.e. `protocolEra` is "auto", or "modern" (`{ pin: MODERN_PROTOCOL_VERSION }`).
   * Legacy is the default for an absent `mode`, matching the SDK.
   *
   * `versionNegotiation` is a public option, so a caller can pin a revision the
   * repo's own {@link eraToVersionNegotiation} never produces (it only ever
   * pins {@link MODERN_PROTOCOL_VERSION}). That is still "probing" and
   * deliberately reports true: per the SDK, *any* `{ pin }` sends the
   * connect-time `server/discover` — "the connect-time `server/discover` must
   * offer it. No fallback" — so the pinned revision doesn't change whether the
   * probe (and hence the buried-401 problem) happens. Only "legacy" skips it.
   */
  private probesProtocolEra(): boolean {
    const mode = this.versionNegotiation.mode;
    return mode !== undefined && mode !== "legacy";
  }

  private async withDirectAuthRecovery<T>(
    operation: (attempt: number) => Promise<T>,
    context?: { method?: string; toolName?: string },
    attempt = 0,
  ): Promise<T> {
    try {
      // `attempt` is passed through so an operation can tell the first leg from
      // the post-recovery retry leg — `connect()` needs that distinction, and
      // live connection status is a racy proxy for it.
      return await operation(attempt);
    } catch (err) {
      if (attempt >= 1 || !this.usesDirectAuthRecovery()) {
        throw err;
      }
      if (!isAuthChallengeError(err)) {
        throw err;
      }
      if (
        this.authRecoveryDepth >= InspectorClient.MAX_NESTED_AUTH_RECOVERIES
      ) {
        // Refreshed credentials are not satisfying the server: recovering again
        // would just re-enter the nested connect() below. Surface the challenge.
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
        this.authRecoveryDepth += 1;
        try {
          await this.reconnectAfterAuthRecovery();
        } finally {
          this.authRecoveryDepth -= 1;
        }
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
    operation: (attempt: number) => Promise<T>,
    context?: { method?: string; toolName?: string },
  ): Promise<T> {
    if (!this.usesDirectAuthRecovery()) {
      return operation(0);
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
   * Drop this server's stored OAuth state and revoke the grant at the
   * authorization server (RFC 7009, #2144).
   *
   * The request is planned from the stored state, the state is cleared, and
   * only then is the request sent — so the clear never waits on the network.
   *
   * The revocation is best-effort — an authorization server that advertises no
   * `revocation_endpoint` is left behaving exactly as before, and a network
   * error, a non-2xx or a timeout is reported in the returned outcome rather
   * than thrown — so the local clear always completes. Pass
   * `{ revoke: false }` to skip it.
   */
  async clearOAuthTokens(options?: {
    revoke?: boolean;
  }): Promise<TokenRevocationOutcome> {
    return (
      (await this.oauthManager?.clearOAuthTokens(options)) ?? {
        status: "skipped",
        reason: "no_tokens",
      }
    );
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
