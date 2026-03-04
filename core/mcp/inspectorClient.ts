import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  MCPServerConfig,
  StderrLogEntry,
  ConnectionStatus,
  MessageEntry,
  FetchRequestEntry,
  FetchRequestEntryBase,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
  AppRendererClient,
  InspectorClientOptions,
} from "./types.js";
import { getServerType as getServerTypeFromConfig } from "./config.js";
import corePackageJson from "../package.json" with { type: "json" };
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
  ResourceTemplate,
  Prompt,
  Root,
  CreateMessageResult,
  ElicitResult,
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
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  RequestOptions,
  ProgressCallback,
} from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  EmptyResultSchema,
  ListRootsRequestSchema,
  ElicitationCompleteNotificationSchema,
  RootsListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  CallToolResultSchema,
  McpError,
  ErrorCode,
  ListTasksRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  CancelTaskRequestSchema,
  TaskStatusNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ClientResult } from "@modelcontextprotocol/sdk/types.js";
import { TasksListChangedNotificationSchema } from "./taskNotificationSchemas.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import {
  InspectorClientEventTarget,
  type TaskWithOptionalCreatedAt,
} from "./inspectorClientEventTarget.js";
import { SamplingCreateMessage } from "./samplingCreateMessage.js";
import { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import type { AuthGuidedState, OAuthStep } from "../auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type pino from "pino";
import { silentLogger } from "../logging/logger.js";
import { createFetchTracker } from "./fetchTracking.js";
import { OAuthManager, type OAuthManagerConfig } from "./oauthManager.js";

/** Internal record for a receiver task (server polls us for status/result). */
interface ReceiverTaskRecord {
  task: Task;
  payloadPromise: Promise<ClientResult>;
  resolvePayload: (payload: ClientResult) => void;
  rejectPayload: (reason?: unknown) => void;
  cleanupTimeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - EventTarget interface for React hooks (cross-platform: works in browser and Node.js)
 * - Access to client functionality (prompts, resources, tools)
 */
export class InspectorClient extends InspectorClientEventTarget {
  private client: Client | null = null;
  private appRendererClientProxy: AppRendererClient | null = null;
  private transport: Transport | MessageTrackingTransport | null = null;
  private baseTransport: Transport | null = null;
  private pipeStderr: boolean;
  private initialLoggingLevel?: LoggingLevel;
  private sample: boolean;
  private elicit: boolean | { form?: boolean; url?: boolean };
  private progress: boolean;
  private resetTimeoutOnProgress: boolean;
  private requestTimeout: number | undefined;
  private status: ConnectionStatus = "disconnected";
  // Server data (resources, resourceTemplates, prompts are in state managers)
  private capabilities?: ServerCapabilities;
  private serverInfo?: Implementation;
  private instructions?: string;
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
  // Resource subscriptions
  private subscribedResources: Set<string> = new Set();
  // Receiver tasks (server-initiated: server sends createMessage/elicit with params.task, server polls us)
  private receiverTasks: boolean;
  private receiverTaskTtlMs: number | (() => number);
  private receiverTaskRecords: Map<string, ReceiverTaskRecord> = new Map();
  // OAuth support (config owned by oauthManager; client delegates and uses !!oauthManager for "is OAuth configured")
  private oauthManager: OAuthManager | null = null;
  private logger: pino.Logger;
  private transportClientFactory: CreateTransport;
  private fetchFn?: typeof fetch;
  private effectiveAuthFetch: typeof fetch;
  // Session ID (for OAuth state and saveSession event; persistence is in FetchRequestLogState)
  private sessionId?: string;

  constructor(
    private transportConfig: MCPServerConfig,
    options: InspectorClientOptions,
  ) {
    super();
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
        dispatchOAuthStepChange: (detail) =>
          this.dispatchTypedEvent("oauthStepChange", detail),
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
    const clientOptions: { capabilities?: ClientCapabilities } = {};
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
    if (Object.keys(capabilities).length > 0) {
      clientOptions.capabilities = capabilities;
    }

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
    return createFetchTracker(base, {
      trackRequest: (entry) =>
        this.dispatchFetchRequest({ ...entry, category: "auth" }),
    });
  }

  private createMessageTrackingCallbacks(): MessageTrackingCallbacks {
    return {
      trackRequest: (message: JSONRPCRequest) => {
        const entry: MessageEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "request",
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackResponse: (
        message: JSONRPCResultResponse | JSONRPCErrorResponse,
      ) => {
        const entry: MessageEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "response",
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackNotification: (message: JSONRPCNotification) => {
        const entry: MessageEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "notification",
          message,
        };
        this.dispatchTypedEvent("message", entry);
      },
    };
  }

  private attachTransportListeners(baseTransport: Transport): void {
    baseTransport.onclose = () => {
      if (this.status !== "disconnected") {
        this.status = "disconnected";
        this.dispatchTypedEvent("statusChange", this.status);
        this.dispatchTypedEvent("disconnect");
      }
    };
    baseTransport.onerror = (error: Error) => {
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
  private getRequestOptions(progressToken?: ProgressToken): RequestOptions {
    const opts: RequestOptions = {
      resetTimeoutOnProgress: this.resetTimeoutOnProgress,
    };
    if (this.requestTimeout !== undefined) {
      opts.timeout = this.requestTimeout;
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

  private createReceiverTask(opts: {
    ttl?: number;
    initialStatus: Task["status"];
    statusMessage?: string;
    pollInterval?: number;
  }): ReceiverTaskRecord {
    const taskId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
      throw new McpError(ErrorCode.InvalidParams, `Unknown taskId: ${taskId}`);
    }
    return record.payloadPromise;
  }

  private cancelReceiverTask(taskId: string): Task {
    const record = this.receiverTaskRecords.get(taskId);
    if (!record) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown taskId: ${taskId}`);
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
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    if (this.status === "connected") {
      return;
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
      };
      const oauthManager = this.oauthManager;
      if (this.isHttpOAuthConfig() && oauthManager) {
        const provider = await oauthManager.createOAuthProviderForTransport();
        transportOptions.authProvider = provider;
      }
      const { transport: baseTransport } = this.transportClientFactory(
        this.transportConfig,
        transportOptions,
      );
      this.baseTransport = baseTransport;
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

      await this.client.connect(this.transport);
      this.status = "connected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("connect");

      // Always fetch server info (capabilities, serverInfo, instructions) - this is just cached data from initialize
      await this.fetchServerInfo();

      // Set initial logging level if configured and server supports it
      if (this.initialLoggingLevel && this.capabilities?.logging) {
        await this.client.setLoggingLevel(
          this.initialLoggingLevel,
          this.getRequestOptions(),
        );
      }

      // Set up sampling request handler if sampling capability is enabled
      if (this.sample && this.client) {
        this.client.setRequestHandler(CreateMessageRequestSchema, (request) => {
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
            return Promise.resolve({ task: record.task });
          }
          return new Promise<CreateMessageResult>((resolve, reject) => {
            const samplingRequest = new SamplingCreateMessage(
              request,
              (result) => {
                resolve(result);
              },
              (error) => {
                reject(error);
              },
              (id) => this.removePendingSample(id),
            );
            this.addPendingSample(samplingRequest);
          });
        });
      }

      // Set up elicitation request handler if elicitation capability is enabled
      if (this.elicit && this.client) {
        this.client.setRequestHandler(ElicitRequestSchema, (request) => {
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
            return Promise.resolve({ task: record.task });
          }
          return new Promise<ElicitResult>((resolve) => {
            const elicitationRequest = new ElicitationCreateMessage(
              request,
              (result) => {
                resolve(result);
              },
              (id) => this.removePendingElicitation(id),
            );
            this.addPendingElicitation(elicitationRequest);
          });
        });
      }

      // Set up roots/list request handler if roots capability is enabled
      if (this.roots !== undefined && this.client) {
        this.client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: this.roots ?? [] };
        });
      }

      // Set up receiver-task request handlers (server polls us for tasks/list, tasks/get, tasks/result, tasks/cancel)
      if (this.receiverTasks && this.client) {
        this.client.setRequestHandler(ListTasksRequestSchema, async () => ({
          tasks: this.listReceiverTasks(),
        }));
        this.client.setRequestHandler(GetTaskRequestSchema, async (req) => {
          const record = this.getReceiverTask(req.params.taskId);
          if (!record) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Unknown taskId: ${req.params.taskId}`,
            );
          }
          return record.task;
        });
        this.client.setRequestHandler(
          GetTaskPayloadRequestSchema,
          async (req) => this.getReceiverTaskPayload(req.params.taskId),
        );
        this.client.setRequestHandler(CancelTaskRequestSchema, async (req) =>
          this.cancelReceiverTask(req.params.taskId),
        );
      }

      // Set up notification handler for roots/list_changed from server
      if (this.client) {
        this.client.setNotificationHandler(
          RootsListChangedNotificationSchema,
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
            ToolListChangedNotificationSchema,
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
            ResourceListChangedNotificationSchema,
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
            PromptListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("promptsListChanged");
            },
          );
        }

        // Tasks list_changed and status handlers (when server advertises tasks capability)
        if (this.capabilities?.tasks) {
          this.client.setNotificationHandler(
            TasksListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("tasksListChanged");
            },
          );
          this.client.setNotificationHandler(
            TaskStatusNotificationSchema,
            async (notification) => {
              const task = notification.params as Task;
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
            ResourceUpdatedNotificationSchema,
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
            ElicitationCompleteNotificationSchema,
            async (notification) => {
              const { elicitationId } = notification.params;
              const pending = this.pendingElicitations.find(
                (e) =>
                  e.request.params?.mode === "url" &&
                  e.request.params?.elicitationId === elicitationId,
              );
              if (pending) {
                pending.remove();
              }
            },
          );
        }

        // Progress: we use per-request onprogress (see getRequestOptions). We do not register
        // a progress notification handler so the Protocol's _onprogress stays; timeout reset
        // and routing work, and we inject the caller's progressToken into dispatched events.
      }
    } catch (error) {
      this.status = "error";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore errors on close
      }
    }
    // Null out transport so next connect() creates a fresh one.
    this.baseTransport = null;
    this.transport = null;
    // Update status - transport onclose handler will also fire and clear state
    // But we also do it here in case disconnect() is called directly
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("disconnect");
    }

    // Clear server state on disconnect (list state is in state managers)
    this.pendingSamples = [];
    this.pendingElicitations = [];
    // Clear resource subscriptions on disconnect
    this.subscribedResources.clear();
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
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
    this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
    this.dispatchTypedEvent("instructionsChange", this.instructions);
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
          return (...args: Parameters<Client["setNotificationHandler"]>) => {
            // Add behavior here (e.g. wrap handler, log, filter)
            return value.apply(target, args);
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
    const task = await this.client.experimental.tasks.getTask(
      taskId,
      this.getRequestOptions(),
    );

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
    // Use CallToolResultSchema for validation
    return await this.client.experimental.tasks.getTaskResult(
      taskId,
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
    await this.client.experimental.tasks.cancelTask(
      taskId,
      this.getRequestOptions(),
    );

    // Dispatch event
    this.dispatchTypedEvent("taskCancelled", { taskId });
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
    return await this.client.experimental.tasks.listTasks(
      cursor,
      this.getRequestOptions(),
    );
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
   * Set the logging level for the MCP server
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
   * Fetch a single page of tools without updating the client's internal list.
   */
  async listTools(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ tools: Tool[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const params: ListToolsRequest["params"] = {
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.client.listTools(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );
    const tools = [...(response.tools || [])];
    return { tools, nextCursor: response.nextCursor };
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
  ): Promise<ToolCallInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }

    if (tool.execution?.taskSupport === "required") {
      throw new Error(
        `Tool "${tool.name}" requires task support. Use callToolStream() instead of callTool().`,
      );
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

      // Merge general metadata with tool-specific metadata
      let mergedMetadata: Record<string, string> | undefined;
      if (generalMetadata || toolSpecificMetadata) {
        mergedMetadata = {
          ...(generalMetadata || {}),
          ...(toolSpecificMetadata || {}),
        };
      }

      const timestamp = new Date();
      const metadata =
        mergedMetadata && Object.keys(mergedMetadata).length > 0
          ? mergedMetadata
          : undefined;

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

      const result = await this.client.callTool(
        callParams,
        undefined,
        this.getRequestOptions(metadata?.progressToken),
      );

      const invocation: ToolCallInvocation = {
        toolName: tool.name,
        params: args,
        result: result as CallToolResult,
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
      let mergedMetadata: Record<string, string> | undefined;
      if (generalMetadata || toolSpecificMetadata) {
        mergedMetadata = {
          ...(generalMetadata || {}),
          ...(toolSpecificMetadata || {}),
        };
      }

      const timestamp = new Date();
      const metadata =
        mergedMetadata && Object.keys(mergedMetadata).length > 0
          ? mergedMetadata
          : undefined;

      const invocation: ToolCallInvocation = {
        toolName: tool.name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata,
      };

      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: tool.name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: invocation.error,
        metadata,
      });

      throw error;
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

      // Merge general metadata with tool-specific metadata
      let mergedMetadata: Record<string, string> | undefined;
      if (generalMetadata || toolSpecificMetadata) {
        mergedMetadata = {
          ...(generalMetadata || {}),
          ...(toolSpecificMetadata || {}),
        };
      }

      const timestamp = new Date();
      const metadata =
        mergedMetadata && Object.keys(mergedMetadata).length > 0
          ? mergedMetadata
          : undefined;

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
      const stream = this.client.experimental.tasks.callToolStream(
        streamParams as CallToolRequest["params"],
        undefined, // Use default CallToolResultSchema
        this.getRequestOptions(metadata?.progressToken),
      );

      let finalResult: CallToolResult | undefined;
      let taskId: string | undefined;
      let error: Error | undefined;

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
              const failedTask: TaskWithOptionalCreatedAt = {
                taskId,
                ttl: null,
                status: "failed",
                statusMessage: errorMessage,
                lastUpdatedAt: new Date().toISOString(),
              };
              this.dispatchTypedEvent("toolCallTaskUpdated", {
                taskId,
                task: failedTask,
                error: message.error,
              });
              this.dispatchTypedEvent("requestorTaskUpdated", {
                taskId,
                task: failedTask,
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
          finalResult = await this.client.experimental.tasks.getTaskResult(
            taskId,
            undefined,
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
      let mergedMetadata: Record<string, string> | undefined;
      if (generalMetadata || toolSpecificMetadata) {
        mergedMetadata = {
          ...(generalMetadata || {}),
          ...(toolSpecificMetadata || {}),
        };
      }

      const timestamp = new Date();
      const metadata =
        mergedMetadata && Object.keys(mergedMetadata).length > 0
          ? mergedMetadata
          : undefined;

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
    const params: ListResourcesRequest["params"] = {
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.client.listResources(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );
    return {
      resources: response.resources || [],
      nextCursor: response.nextCursor,
    };
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
    const params: ReadResourceRequest["params"] = {
      uri,
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
    };
    const result = await this.client.readResource(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );
    const invocation: ResourceReadInvocation = {
      result,
      timestamp: new Date(),
      uri,
      metadata,
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

    // Create the template invocation object
    const invocation: ResourceTemplateReadInvocation = {
      uriTemplate: uriTemplateString,
      expandedUri,
      result: readInvocation.result,
      timestamp: readInvocation.timestamp,
      params,
      metadata,
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
    const params: ListResourceTemplatesRequest["params"] = {
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.client.listResourceTemplates(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );
    return {
      resourceTemplates: response.resourceTemplates || [],
      nextCursor: response.nextCursor,
    };
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
    const params: ListPromptsRequest["params"] = {
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await this.client.listPrompts(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );
    return {
      prompts: response.prompts || [],
      nextCursor: response.nextCursor,
    };
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

    const params: GetPromptRequest["params"] = {
      name,
      arguments: stringArgs,
      ...(metadata && Object.keys(metadata).length > 0
        ? { _meta: metadata }
        : {}),
    };

    const result = await this.client.getPrompt(
      params,
      this.getRequestOptions(metadata?.progressToken),
    );

    const invocation: PromptGetInvocation = {
      result,
      timestamp: new Date(),
      name,
      params: Object.keys(stringArgs).length > 0 ? stringArgs : undefined,
      metadata,
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
      const params: CompleteRequest["params"] = {
        ref,
        argument: {
          name: argumentName,
          value: argumentValue,
        },
        ...(context ? { context: { arguments: context } } : {}),
        ...(metadata && Object.keys(metadata).length > 0
          ? { _meta: metadata }
          : {}),
      };

      const response = await this.client.complete(
        params,
        this.getRequestOptions(metadata?.progressToken),
      );

      return {
        values: response.completion.values || [],
        total: response.completion.total,
        hasMore: response.completion.hasMore,
      };
    } catch (error) {
      // Handle MethodNotFound gracefully (server doesn't support completions)
      if (
        (error instanceof McpError &&
          error.code === ErrorCode.MethodNotFound) ||
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
      console.error("Failed to send roots/list_changed notification:", error);
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
   * Subscribe to a resource to receive update notifications
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
      await this.client.subscribeResource({ uri }, this.getRequestOptions());
      this.subscribedResources.add(uri);
      this.dispatchTypedEvent(
        "resourceSubscriptionsChange",
        Array.from(this.subscribedResources),
      );
    } catch (error) {
      throw new Error(
        `Failed to subscribe to resource: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Unsubscribe from a resource
   * @param uri - The URI of the resource to unsubscribe from
   * @throws Error if client is not connected
   */
  async unsubscribeFromResource(uri: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      await this.client.unsubscribeResource({ uri }, this.getRequestOptions());
      this.subscribedResources.delete(uri);
      this.dispatchTypedEvent(
        "resourceSubscriptionsChange",
        Array.from(this.subscribedResources),
      );
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
   * Initiates OAuth flow using SDK's auth() function (normal mode)
   * Can be called directly by user or automatically triggered by 401 errors
   */
  async authenticate(): Promise<URL> {
    return this.ensureOAuthManager().authenticate();
  }

  /**
   * Starts guided OAuth flow (step-by-step). Runs only the first step.
   * Use proceedOAuthStep() to advance. When oauthStep is "authorization_code",
   * set authorizationCode and call proceedOAuthStep() to complete.
   */
  async beginGuidedAuth(): Promise<void> {
    return this.ensureOAuthManager().beginGuidedAuth();
  }

  /**
   * Runs guided OAuth flow to completion. If already started (via beginGuidedAuth),
   * continues from current step. Otherwise initializes and runs from the start.
   * Returns the authorization URL when user must authorize, or undefined if already complete.
   */
  async runGuidedAuth(): Promise<URL | undefined> {
    return this.ensureOAuthManager().runGuidedAuth();
  }

  /**
   * Set authorization code for guided OAuth flow.
   * Validates that the client is in guided OAuth mode (has active state machine).
   * @param authorizationCode The authorization code from the OAuth callback
   * @param completeFlow If true, automatically proceed through all remaining steps to completion.
   *                     If false, only set the code and wait for manual progression via proceedOAuthStep().
   *                     Defaults to false for manual step-by-step control.
   * @throws Error if not in guided OAuth flow or not at authorization_code step
   */
  async setGuidedAuthorizationCode(
    authorizationCode: string,
    completeFlow: boolean = false,
  ): Promise<void> {
    return this.ensureOAuthManager().setGuidedAuthorizationCode(
      authorizationCode,
      completeFlow,
    );
  }

  /**
   * Completes OAuth flow with authorization code.
   * For guided mode, this calls setGuidedAuthorizationCode(code, true) internally.
   * For normal mode, uses SDK auth() directly.
   */
  async completeOAuthFlow(authorizationCode: string): Promise<void> {
    return this.ensureOAuthManager().completeOAuthFlow(authorizationCode);
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
  clearOAuthTokens(): void {
    this.oauthManager?.clearOAuthTokens();
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
   * Get current OAuth state machine state (for guided mode)
   */
  getOAuthState(): AuthGuidedState | undefined {
    return this.oauthManager?.getOAuthState();
  }

  /**
   * Get current OAuth step (for guided mode)
   */
  getOAuthStep(): OAuthStep | undefined {
    return this.oauthManager?.getOAuthStep();
  }

  /**
   * Manually progress to next step in guided OAuth flow
   */
  async proceedOAuthStep(): Promise<void> {
    return this.ensureOAuthManager().proceedOAuthStep();
  }
}
