/**
 * Type-safe EventTarget for InspectorClient events.
 * Extends the generic TypedEventTarget with InspectorClientEventMap; TypedEvent
 * is provided as a type alias for use in listener signatures.
 *
 * v2 note: the v1.5 event map referenced SamplingCreateMessage / ElicitationCreateMessage
 * classes (with embedded promise resolvers) and OAuth events from the auth subsystem.
 * The auth subsystem and the runtime promise-based pending classes are not yet ported to
 * v2 — see #1243 scope. Pending requests are typed with the v2 wrapper types
 * (InspectorPendingSampling / InspectorPendingElicitation); OAuth events are deliberately
 * omitted here and will be added when the auth subsystem is ported.
 */

import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "./typedEventTarget.js";
import type {
  ConnectionStatus,
  MessageEntry,
  StderrLogEntry,
  FetchRequestEntry,
  PromptGetInvocation,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
} from "./types.js";
import type {
  Tool,
  ServerCapabilities,
  Implementation,
  Root,
  Progress,
  ProgressToken,
  Task,
  CallToolResult,
  ProtocolError,
  ProtocolEra,
  DiscoverResult,
} from "@modelcontextprotocol/client";
import type { SamplingCreateMessage } from "./samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import type { JsonValue } from "../json/jsonUtils.js";
import type { OAuthTokens } from "@modelcontextprotocol/client";
import type { AuthChallenge } from "../auth/challenge.js";

/** Task with createdAt optional so we can emit synthetic tasks (e.g. on result/error) that omit it. */
export type TaskWithOptionalCreatedAt = Omit<Task, "createdAt"> & {
  createdAt?: string;
};

/**
 * Maps event names to their detail types for CustomEvents
 */
export interface InspectorClientEventMap {
  statusChange: ConnectionStatus;
  toolsChange: Tool[];
  capabilitiesChange: ServerCapabilities | undefined;
  serverInfoChange: Implementation | undefined;
  instructionsChange: string | undefined;
  protocolVersionChange: string | undefined;
  /** Protocol era negotiated after connect (SEP §7.8); `"legacy"` on a legacy connect, undefined when not connected. */
  protocolEraChange: ProtocolEra | undefined;
  /** `server/discover` result on a probed/pinned connect; undefined on legacy. */
  discoverResultChange: DiscoverResult | undefined;
  message: MessageEntry;
  stderrLog: StderrLogEntry;
  fetchRequest: FetchRequestEntry;
  /** Fired when an in-flight fetch's response body is read asynchronously. */
  fetchRequestBodyUpdate: { id: string; responseBody: string };
  /**
   * Fired whenever the client transitions `status` to `"error"` from a path
   * that is NOT an awaited promise — i.e. a mid-session transport failure
   * (stdio subprocess crash, SSE stream drop, HTTP 5xx) surfaced via the
   * transport's `onerror`. The `Error` carries the reason (`.message`,
   * optional `.cause`). Handshake failures are NOT dispatched here: they
   * reject the awaited `connect()` promise, so the caller already has the
   * error and a second surface would double-report it. Consumers that don't
   * subscribe directly can read the last error via `useInspectorClient`'s
   * `lastError`.
   */
  error: Error;
  resourceUpdated: { uri: string };
  progressNotification: Progress & { progressToken?: ProgressToken };
  toolCallResultChange: {
    toolName: string;
    params: Record<string, JsonValue>;
    result: CallToolResult | null;
    timestamp: Date;
    success: boolean;
    error?: string;
    metadata?: Record<string, string>;
    /** Non-fatal outputSchema mismatch detected on the skipOutputValidation path. */
    outputValidationError?: string;
  };
  resourceContentChange: {
    uri: string;
    content: ResourceReadInvocation;
    timestamp: Date;
  };
  resourceTemplateContentChange: {
    uriTemplate: string;
    content: ResourceTemplateReadInvocation;
    params: Record<string, string>;
    timestamp: Date;
  };
  promptContentChange: {
    name: string;
    content: PromptGetInvocation;
    timestamp: Date;
  };
  pendingSamplesChange: SamplingCreateMessage[];
  newPendingSample: SamplingCreateMessage;
  pendingElicitationsChange: ElicitationCreateMessage[];
  newPendingElicitation: ElicitationCreateMessage;
  rootsChange: Root[];
  resourceSubscriptionsChange: string[];
  // Task events
  /** Fired only from server notification notifications/tasks/status. */
  taskStatusChange: { taskId: string; task: Task };
  /** Fired from callToolStream for each task update. */
  toolCallTaskUpdated: {
    taskId: string;
    task: TaskWithOptionalCreatedAt;
    result?: CallToolResult;
    error?: ProtocolError;
  };
  /** Fired from getRequestorTask() and callToolStream (client-origin task updates). */
  requestorTaskUpdated: {
    taskId: string;
    task: TaskWithOptionalCreatedAt;
    result?: CallToolResult;
    error?: ProtocolError;
  };
  taskCancelled: { taskId: string };
  /**
   * Fired from callToolStream when a progress notification arrives for a
   * task-augmented tool call, tagged with the taskId callToolStream owns so
   * consumers can correlate progress → task (the generic progressNotification
   * event carries only the caller's progressToken, not the taskId).
   */
  requestorTaskProgress: { taskId: string; progress: Progress };
  tasksChange: Task[];
  // Signal events (no payload)
  connect: void;
  disconnect: void;
  // List changed notification events
  toolsListChanged: void;
  resourcesListChanged: void;
  resourceTemplatesListChanged: void;
  promptsListChanged: void;
  tasksListChanged: void;
  // Session persistence (dispatched by client; FetchRequestLogState listens and saves)
  saveSession: { sessionId: string };
  // OAuth events (#1302 — fired by the ported oauthManager / InspectorClient)
  oauthComplete: { tokens: OAuthTokens };
  oauthAuthorizationRequired: { url: URL };
  oauthError: { error: Error };
  /** Ambient (SSE) auth challenge while no command-scoped send is active. */
  authChallengeAmbient: { challenge: AuthChallenge };
  /** Command-scoped direct-transport auth challenge (no ambient toast). */
  authChallengeCommand: { challenge: AuthChallenge };
  /** Ambient auth recovery completed (remote auth state pushed). */
  authChallengeRecovered: { challenge: AuthChallenge };
  /** Interactive auth required; App orchestrates redirect (step-up modal or reauth). */
  authChallengeInteractive: {
    challenge: AuthChallenge;
    authorizationUrl: URL;
  };
}

/**
 * Type alias for InspectorClient typed events (for listener signatures).
 */
export type TypedEvent<K extends keyof InspectorClientEventMap> =
  TypedEventGeneric<InspectorClientEventMap, K>;

/**
 * Type-safe EventTarget for InspectorClient events.
 */
export class InspectorClientEventTarget extends TypedEventTarget<InspectorClientEventMap> {}
