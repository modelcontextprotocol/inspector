/**
 * Type-safe EventTarget for InspectorClient events.
 * Extends the generic TypedEventTarget with InspectorClientEventMap; TypedEvent
 * is provided as a type alias for use in listener signatures.
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
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { SamplingCreateMessage } from "./samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import type { AuthGuidedState, OAuthStep } from "../auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { JsonValue } from "../json/jsonUtils.js";

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
  message: MessageEntry;
  stderrLog: StderrLogEntry;
  fetchRequest: FetchRequestEntry;
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
  /** Fired from callToolStream for each task update (taskCreated, taskStatus, result, error). */
  toolCallTaskUpdated: {
    taskId: string;
    task: TaskWithOptionalCreatedAt;
    result?: CallToolResult;
    error?: McpError;
  };
  /** Fired from getRequestorTask() and callToolStream (client-origin task updates). */
  requestorTaskUpdated: {
    taskId: string;
    task: TaskWithOptionalCreatedAt;
    result?: CallToolResult;
    error?: McpError;
  };
  taskCancelled: { taskId: string };
  tasksChange: Task[];
  // Signal events (no payload)
  connect: void;
  disconnect: void;
  // List changed notification events (fired when server sends list_changed notifications)
  toolsListChanged: void;
  resourcesListChanged: void;
  resourceTemplatesListChanged: void;
  promptsListChanged: void;
  tasksListChanged: void;
  // Session persistence (dispatched by client; FetchRequestLogState listens and saves)
  saveSession: { sessionId: string };
  // OAuth events
  oauthAuthorizationRequired: {
    url: URL;
  };
  oauthComplete: {
    tokens: OAuthTokens;
  };
  oauthError: {
    error: Error;
  };
  oauthStepChange: {
    step: OAuthStep;
    previousStep: OAuthStep;
    state: Partial<AuthGuidedState>;
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
