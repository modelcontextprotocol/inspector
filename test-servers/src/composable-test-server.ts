/**
 * Composable Test Server
 *
 * Provides types and functions for creating MCP test servers from configuration.
 * This allows composing MCP test servers with different capabilities, tools, resources, and prompts.
 */

import * as z from "zod/v4";
import {
  McpServer,
  ResourceTemplate as SdkResourceTemplate,
  completable,
  isCompletable,
} from "@modelcontextprotocol/server";
import type {
  Implementation,
  Tool,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Prompt,
  CallToolResult,
  PromptArgument,
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  RegisteredResourceTemplate,
  ServerContext,
  ServerCapabilities,
  Task,
  GetTaskResult,
  ListTasksResult,
  ListToolsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
} from "@modelcontextprotocol/server";
import {
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  CancelTaskRequestSchema,
  ListTasksRequestSchema,
  TaskStatusNotificationSchema,
} from "@modelcontextprotocol/core";

// Empty object JSON schema constant (from SDK's mcp.js)
const EMPTY_OBJECT_JSON_SCHEMA = {
  type: "object",
  properties: {},
} as const;

// A raw arg shape: field name → zod schema. Using the full `z.ZodType` (not
// `z.ZodRawShape`, which is a readonly `$ZodType` map) keeps it assignable to the
// SDK's `registerTool`/`registerPrompt` raw-shape overloads and mutable for the
// completable() wrapping below.
type ToolInputSchema = Record<string, z.ZodType>;
type PromptArgsSchema = Record<string, z.ZodType>;

/**
 * Back-compat handler `extra` shape.
 *
 * SDK v2 removed `RequestHandlerExtra`; low-level handlers now receive a
 * {@link ServerContext} whose per-request data lives under `ctx.mcpReq`. This
 * type is the flattened view the composable test-server tool/resource/task
 * handlers consume, rebuilt from `ctx.mcpReq` by {@link toHandlerExtra}.
 */
export interface HandlerExtra {
  /** `_meta` sent with the request params (e.g. `_meta.progressToken`). */
  _meta?: Record<string, unknown>;
  /** The inbound JSON-RPC request id (for `relatedRequestId` on notifications). */
  requestId?: string | number;
  /** Abort signal for the in-flight request. */
  signal?: AbortSignal;
  /** Send a server→client request (`sampling/createMessage`, `elicitation/create`, `tasks/*`, …). */
  sendRequest?: <T extends z.core.$ZodType>(
    request: { method: string; params?: Record<string, unknown> },
    resultSchema: T,
  ) => Promise<z.output<T>>;
  /** Send a server→client notification. */
  sendNotification?: (notification: {
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<void>;
}

/** Minimal structural view of `ctx.mcpReq` for building {@link HandlerExtra}. */
interface McpReqContext {
  mcpReq?: {
    id?: string | number;
    _meta?: Record<string, unknown>;
    signal?: AbortSignal;
    send?: HandlerExtra["sendRequest"];
    notify?: HandlerExtra["sendNotification"];
  };
}

/** Rebuild the legacy flattened `extra` object from a v2 {@link ServerContext}. */
function toHandlerExtra(ctx: ServerContext | undefined): HandlerExtra {
  const mcpReq = (ctx as McpReqContext | undefined)?.mcpReq;
  return {
    _meta: mcpReq?._meta,
    requestId: mcpReq?.id,
    signal: mcpReq?.signal,
    sendRequest: mcpReq?.send,
    sendNotification: mcpReq?.notify,
  };
}

/**
 * Derive `prompts/list` argument descriptors from a raw zod arg shape.
 * Replaces the SDK's removed `getObjectShape` / `getSchemaDescription` /
 * `isSchemaOptional` compat helpers. A field is `required` unless it accepts
 * `undefined` (i.e. it is `.optional()` / `.default()` / nullish).
 */
function promptArgumentsFromRawShape(
  shape: Record<string, z.ZodType> | undefined,
): PromptArgument[] | undefined {
  if (!shape) return undefined;
  return Object.entries(shape).map(([name, field]) => {
    const schema = field as z.ZodType;
    const acceptsUndefined = schema.safeParse(undefined).success;
    return {
      name,
      description: schema.description,
      required: !acceptsUndefined,
    } as PromptArgument;
  });
}

interface ServerState {
  registeredTools: Map<string, RegisteredTool>; // Keyed by name
  registeredResources: Map<string, RegisteredResource>; // Keyed by URI
  registeredPrompts: Map<string, RegisteredPrompt>; // Keyed by name
  registeredResourceTemplates: Map<string, RegisteredResourceTemplate>; // Keyed by uriTemplate
  listChangedConfig: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  resourceSubscriptions: Set<string>; // Set of subscribed resource URIs
}

/**
 * Context object passed to tool handlers containing both server and state
 */
export interface TestServerContext {
  server: McpServer;
  state: ServerState;
  serverControl?: { isClosing(): boolean };
}

// ---------------------------------------------------------------------------
// Legacy (2025-11-25) tasks — re-implemented by hand.
//
// SDK v2 deleted the experimental tasks runtime (`InMemoryTaskStore`,
// `registerToolTask`, `client/server.experimental.tasks.*`). The Inspector still
// exercises the 2025-11-25 task wire methods end to end, so the composable
// server keeps answering them with a small in-memory store plus low-level
// custom-method handlers wired up in `createMcpServer`.
// ---------------------------------------------------------------------------

/** Task lifecycle status (2025-11-25 vocabulary). */
export type TaskStatus = Task["status"];

/** Loosely-typed argument bag handed to a task tool's `getTask`/`getTaskResult`. */
export type ShapeOutput<_Shape> = Record<string, unknown>;

/** Payload a task stores as its result (for `tasks/result`). */
export type StoredTaskResult = CallToolResult & Record<string, unknown>;

/**
 * In-memory task store. Replaces the deleted SDK `InMemoryTaskStore`; keeps the
 * subset of methods the composable fixtures use plus list/cancel for the
 * `tasks/list` and `tasks/cancel` wire handlers.
 */
export class InMemoryTaskStore {
  private tasks = new Map<string, Task>();
  private results = new Map<string, StoredTaskResult>();
  /** Optional hook fired on every status change (wired to `notifications/tasks/status`). */
  onTaskStatusChanged?: (task: Task) => void;

  private touch(task: Task): Task {
    task.lastUpdatedAt = new Date().toISOString();
    return task;
  }

  async createTask(options: { ttl?: number } = {}): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      taskId:
        globalThis.crypto?.randomUUID?.() ??
        `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      status: "working",
      ttl: options.ttl ?? null,
      createdAt: now,
      lastUpdatedAt: now,
    };
    this.tasks.set(task.taskId, task);
    this.onTaskStatusChanged?.(task);
    return task;
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    statusMessage?: string,
  ): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.status = status;
    if (statusMessage !== undefined) {
      task.statusMessage = statusMessage;
    }
    this.touch(task);
    this.onTaskStatusChanged?.(task);
    return task;
  }

  async storeTaskResult(
    taskId: string,
    status: TaskStatus,
    result: StoredTaskResult,
  ): Promise<void> {
    this.results.set(taskId, result);
    await this.updateTaskStatus(taskId, status);
  }

  async getTaskResult(taskId: string): Promise<StoredTaskResult> {
    const result = this.results.get(taskId);
    if (!result) {
      throw new Error(`No result stored for task ${taskId}`);
    }
    return result;
  }

  async listTasks(): Promise<Task[]> {
    return [...this.tasks.values()];
  }
}

/** `extra` handed to a task tool's `createTask` (server→client requests + the store). */
export interface CreateTaskRequestHandlerExtra {
  taskStore: InMemoryTaskStore;
  /** `_meta` from the augmenting `tools/call` (e.g. `_meta.progressToken`). */
  _meta?: Record<string, unknown>;
  /** The inbound request id. */
  requestId?: string | number;
  /** Send a server→client request (`elicitation/create`, `sampling/createMessage`, `tasks/*`). */
  sendRequest: <T extends z.core.$ZodType>(
    request: { method: string; params?: Record<string, unknown> },
    resultSchema: T,
  ) => Promise<z.output<T>>;
  /** Send a server→client notification (`notifications/progress`, …). */
  sendNotification: (notification: {
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<void>;
}

/** `extra` handed to a task tool's `getTask`/`getTaskResult`. */
export interface TaskRequestHandlerExtra {
  taskId: string;
  taskStore: InMemoryTaskStore;
}

/** Handler triplet for a task-augmented tool (replaces the SDK's `ToolTaskHandler`). */
export interface ToolTaskHandler {
  createTask: (
    args: Record<string, unknown>,
    extra: CreateTaskRequestHandlerExtra,
  ) => Promise<{ task: Task }>;
  getTask: (
    args: Record<string, unknown>,
    extra: TaskRequestHandlerExtra,
  ) => Promise<GetTaskResult>;
  getTaskResult: (
    args: Record<string, unknown>,
    extra: TaskRequestHandlerExtra,
  ) => Promise<CallToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  /** OAuth scopes required to invoke this tool (enforced at HTTP layer). */
  requiredScopes?: string[];
  /** Optional Zod object schema for tool output; when set, handler must return structuredContent. */
  outputSchema?: unknown;
  /** Passed through to the SDK so clients can read tool-level `_meta` (e.g. `_meta.ui.resourceUri` for MCP App tools). */
  _meta?: Record<string, unknown>;
  handler: (
    params: Record<string, unknown>,
    context?: TestServerContext,
    extra?: HandlerExtra,
  ) => Promise<CallToolResult>;
}

export interface TaskToolDefinition {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  /** OAuth scopes required to invoke this tool (enforced at HTTP layer). */
  requiredScopes?: string[];
  execution?: { taskSupport: "required" | "optional" };
  /** Passed through to the SDK so clients can read tool-level `_meta` (e.g. `_meta.ui.resourceUri` for an App-flavored task tool). Mirrors {@link ToolDefinition._meta}. */
  _meta?: Record<string, unknown>;
  handler: ToolTaskHandler;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text?: string;
  /**
   * Included on the returned content item so clients can read resource-level `_meta` (e.g. `_meta.ui.csp` for MCP App UI resources).
   * Only the default read handler applies this; a `customHandler` from `config.onRegisterResource` replaces the `contents` wholesale, so such a handler must re-add `_meta` itself if the resource needs it on the read response.
   */
  _meta?: Record<string, unknown>;
  /** OAuth scopes required to read this resource (enforced at HTTP layer). */
  requiredScopes?: string[];
}

export interface PromptDefinition {
  name: string;
  description?: string;
  /** OAuth scopes required to fetch this prompt (enforced at HTTP layer). */
  requiredScopes?: string[];
  promptString: string; // The prompt text with optional {argName} placeholders
  argsSchema?: PromptArgsSchema; // Can include completable() schemas
  // Optional completion callbacks keyed by argument name
  // This is a convenience - users can also use completable() directly in argsSchema
  completions?: Record<
    string,
    (
      argumentValue: string,
      context?: Record<string, string>,
    ) => Promise<string[]> | string[]
  >;
}

export interface ResourceTemplateDefinition {
  name: string;
  uriTemplate: string; // URI template with {variable} placeholders (RFC 6570)
  description?: string;
  /** OAuth scopes required to read resources from this template (enforced at HTTP layer). */
  requiredScopes?: string[];
  inputSchema?: Record<string, z.ZodType>; // Schema for template variables
  handler: (
    uri: URL,
    params: Record<string, unknown>,
    context?: TestServerContext,
    extra?: HandlerExtra,
  ) => Promise<{
    contents: Array<{ uri: string; mimeType?: string; text: string }>;
  }>;
  // Optional callbacks for resource template operations
  // list: Can return either:
  //   - string[] (convenience - will be converted to ListResourcesResult with uri and name)
  //   - ListResourcesResult (full control - includes uri, name, description, mimeType, etc.)
  list?:
    | (() => Promise<string[]> | string[])
    | (() => Promise<ListResourcesResult> | ListResourcesResult);
  // complete: Map of variable names to completion callbacks
  // OR a single callback function that will be used for all variables
  complete?:
    | Record<
        string,
        (
          value: string,
          context?: Record<string, string>,
        ) => Promise<string[]> | string[]
      >
    | ((
        argumentName: string,
        argumentValue: string,
        context?: Record<string, string>,
      ) => Promise<string[]> | string[]);
}

/**
 * Configuration for composing an MCP server
 */
export interface ServerConfig {
  serverInfo: Implementation; // Server metadata (name, version, etc.) - required
  tools?: (ToolDefinition | TaskToolDefinition)[]; // Tools to register (optional, empty array means no tools, but tools capability is still advertised)
  resources?: ResourceDefinition[]; // Resources to register (optional, empty array means no resources, but resources capability is still advertised)
  resourceTemplates?: ResourceTemplateDefinition[]; // Resource templates to register (optional, empty array means no templates, but resources capability is still advertised)
  prompts?: PromptDefinition[]; // Prompts to register (optional, empty array means no prompts, but prompts capability is still advertised)
  logging?: boolean; // Whether to advertise logging capability (default: false)
  onLogLevelSet?: (level: string) => void; // Optional callback when log level is set (for testing)
  onRegisterResource?: (resource: ResourceDefinition) =>
    | (() => Promise<{
        contents: Array<{ uri: string; mimeType?: string; text: string }>;
      }>)
    | undefined; // Optional callback to customize resource handler during registration
  serverType?: "sse" | "streamable-http"; // Transport type (default: "streamable-http")
  port?: number; // Port to use (optional, will find available port if not specified)
  /**
   * Whether to advertise listChanged capability for each list type
   * If enabled, modification tools will send list_changed notifications
   */
  listChanged?: {
    tools?: boolean; // default: false
    resources?: boolean; // default: false
    prompts?: boolean; // default: false
  };
  /**
   * Whether to advertise resource subscriptions capability
   * If enabled, server will advertise resources.subscribe capability
   */
  subscriptions?: boolean; // default: false
  /**
   * Maximum page size for pagination (optional, undefined means no pagination)
   * When set, custom list handlers will paginate results using this page size
   */
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  /**
   * Whether to advertise tasks capability
   * If enabled, server will advertise tasks capability with list and cancel support
   */
  tasks?: {
    list?: boolean; // default: true
    cancel?: boolean; // default: true
  };
  /**
   * Task store implementation (optional, defaults to a fresh {@link InMemoryTaskStore}).
   * Only used if tasks capability is enabled.
   */
  taskStore?: InMemoryTaskStore;
  /**
   * OAuth 2.1 configuration for test server.
   * - **combined** (default): this server is both MCP resource and authorization server.
   * - **protected-resource**: MCP resource only; metadata points at external authorization server(s).
   */
  oauth?: {
    enabled: boolean;

    /**
     * combined — local AS + resource (existing behavior).
     * protected-resource — external AS; JWT bearer validation against AS JWKS.
     */
    mode?: "combined" | "protected-resource";

    /**
     * External authorization server URLs for protected-resource metadata
     * (`authorization_servers` in RFC 9728). Required when mode is protected-resource.
     */
    authorizationServers?: string[];

    /**
     * Protected resource identifier override for RFC 9728 metadata.
     * Defaults to the MCP server base URL when omitted.
     */
    resource?: string;

    /**
     * OAuth authorization server issuer URL (combined mode AS metadata).
     * If not provided, defaults to the test server's base URL.
     */
    issuerUrl?: URL;

    /**
     * Allowed JWT `iss` values for access tokens (protected-resource mode).
     * Defaults to authorizationServers plus issuer from AS metadata discovery.
     */
    accessTokenIssuers?: string[];

    /**
     * JWKS URI override for access-token signature verification.
     * When omitted, discovered from authorization server metadata.
     */
    jwksUri?: string;

    /**
     * When set, require JWT `aud` to match this resource identifier.
     */
    resourceAudience?: string;

    scopesSupported?: string[];
    requireAuth?: boolean;

    /**
     * Static/preregistered clients for testing
     * These clients are pre-configured and don't require DCR
     */
    staticClients?: Array<{
      clientId: string;
      clientSecret?: string;
      redirectUris?: string[];
    }>;

    /**
     * Whether to support Dynamic Client Registration (DCR)
     * If true, exposes /register endpoint for client registration
     */
    supportDCR?: boolean;

    /**
     * Whether to support CIMD (Client ID Metadata Documents)
     * If true, server will fetch client metadata from clientMetadataUrl
     */
    supportCIMD?: boolean;

    /**
     * Token expiration time in seconds (default: 3600)
     */
    tokenExpirationSeconds?: number;

    /**
     * Whether to support refresh tokens (default: true)
     */
    supportRefreshTokens?: boolean;
  };
  /**
   * Optional server control for orderly shutdown (test HTTP server).
   * When present, progress-sending tools check isClosing() before sending and skip/break if closing.
   */
  serverControl?: { isClosing(): boolean };
}

/**
 * Create and configure an McpServer instance from ServerConfig
 * This centralizes the setup logic shared between HTTP and stdio test servers
 */
export function createMcpServer(config: ServerConfig): McpServer {
  // Build capabilities based on config
  const capabilities: {
    tools?: object;
    resources?: { subscribe?: boolean };
    prompts?: object;
    logging?: object;
    tasks?: {
      list?: object;
      cancel?: object;
      requests?: { tools?: { call?: object } };
    };
  } = {};

  if (config.tools !== undefined) {
    capabilities.tools = {};
  }
  if (
    config.resources !== undefined ||
    config.resourceTemplates !== undefined
  ) {
    capabilities.resources = {};
    // Add subscribe capability if subscriptions are enabled
    if (config.subscriptions === true) {
      capabilities.resources.subscribe = true;
    }
  }
  if (config.prompts !== undefined) {
    capabilities.prompts = {};
  }
  if (config.logging === true) {
    capabilities.logging = {};
  }
  if (config.tasks !== undefined) {
    capabilities.tasks = {
      list: config.tasks.list !== false ? {} : undefined,
      cancel: config.tasks.cancel !== false ? {} : undefined,
      requests: { tools: { call: {} } },
    };
    // Remove undefined values
    if (capabilities.tasks.list === undefined) {
      delete capabilities.tasks.list;
    }
    if (capabilities.tasks.cancel === undefined) {
      delete capabilities.tasks.cancel;
    }
  }

  // Create the in-memory task store if tasks are enabled. SDK v2 has no built-in
  // task runtime, so the store is owned here and its methods answer the wire.
  const taskStore =
    config.tasks !== undefined
      ? config.taskStore || new InMemoryTaskStore()
      : undefined;

  // Create the server with capabilities
  const mcpServer = new McpServer(config.serverInfo, {
    capabilities: capabilities as ServerCapabilities,
  });

  // Emit `notifications/tasks/status` whenever a task changes status, mirroring
  // the deleted SDK task runtime. Best-effort: notifications need a live stream,
  // so a send failure (e.g. no active SSE stream) must not break task execution.
  if (taskStore) {
    taskStore.onTaskStatusChanged = (task: Task) => {
      const notification = TaskStatusNotificationSchema.parse({
        method: "notifications/tasks/status",
        params: { ...task },
      });
      void mcpServer.server.notification(notification).catch(() => {});
    };
  }

  // Create state (this is really session state, which is what we'll call it if we implement sessions at some point)
  const state: ServerState = {
    registeredTools: new Map(), // Keyed by name
    registeredResources: new Map(), // Keyed by URI
    registeredPrompts: new Map(), // Keyed by name
    registeredResourceTemplates: new Map(), // Keyed by uriTemplate
    listChangedConfig: config.listChanged || {},
    resourceSubscriptions: new Set<string>(), // Track subscribed resource URIs
  };

  // Create context object
  const context: TestServerContext = {
    server: mcpServer,
    state,
    ...(config.serverControl && { serverControl: config.serverControl }),
  };

  // Set up logging handler if logging is enabled. `logging/setLevel` is a spec
  // method, so v2's `setRequestHandler` takes the method string (2-arg form).
  if (config.logging === true) {
    mcpServer.server.setRequestHandler("logging/setLevel", async (request) => {
      // Call optional callback if provided (for testing)
      if (config.onLogLevelSet) {
        config.onLogLevelSet(request.params.level);
      }
      // Return empty result as per MCP spec
      return {};
    });
  }

  // Set up resource subscription handlers if subscriptions are enabled
  if (config.subscriptions === true) {
    mcpServer.server.setRequestHandler(
      "resources/subscribe",
      async (request) => {
        // Track subscription in state (accessible via closure)
        const uri = request.params.uri;
        state.resourceSubscriptions.add(uri);
        return {};
      },
    );

    mcpServer.server.setRequestHandler(
      "resources/unsubscribe",
      async (request) => {
        // Remove subscription from state (accessible via closure)
        const uri = request.params.uri;
        state.resourceSubscriptions.delete(uri);
        return {};
      },
    );
  }

  // Type guard to check if a tool is a task tool
  function isTaskTool(
    tool: ToolDefinition | TaskToolDefinition,
  ): tool is TaskToolDefinition {
    return (
      "handler" in tool &&
      typeof tool.handler === "object" &&
      tool.handler !== null &&
      "createTask" in tool.handler
    );
  }

  // Task tools registered on this server, keyed by name. The `tools/call`
  // override below routes calls to these through their `createTask` handler
  // (returning a task handle), reproducing the deleted SDK task runtime.
  const taskTools = new Map<string, TaskToolDefinition>();

  // Set up tools
  if (config.tools && config.tools.length > 0) {
    for (const tool of config.tools) {
      if (isTaskTool(tool)) {
        // Register the task tool as an ordinary tool so it surfaces in
        // `tools/list` with its input schema, `_meta`, and `execution` support.
        // Its callback is a defensive placeholder: the `tools/call` override
        // intercepts task tools before the SDK handler ever runs it.
        const registered = mcpServer.registerTool(
          tool.name,
          {
            description: tool.description,
            ...(tool.inputSchema && { inputSchema: tool.inputSchema }),
            ...(tool._meta != null && { _meta: tool._meta }),
          },
          async () => ({
            content: [
              {
                type: "text" as const,
                text: `Task tool ${tool.name} must be invoked as a task`,
              },
            ],
            isError: true,
          }),
        );
        // `execution` is not a `registerTool` config field; set it directly so
        // `tools/list` advertises task support (matches the old registerToolTask).
        registered.execution = tool.execution ?? { taskSupport: "required" };
        state.registeredTools.set(tool.name, registered);
        taskTools.set(tool.name, tool);
      } else {
        // Register regular tool
        const registered = mcpServer.registerTool(
          tool.name,
          {
            inputSchema: tool.inputSchema ?? {},
            description: tool.description,
            ...(tool.outputSchema != null && {
              outputSchema: tool.outputSchema as z.ZodType,
            }),
            ...(tool._meta != null && { _meta: tool._meta }),
          },
          async (args, ctx) => {
            const result = await tool.handler(
              args as Record<string, unknown>,
              context,
              toHandlerExtra(ctx),
            );
            const rawStructured =
              result &&
              typeof result === "object" &&
              "structuredContent" in result
                ? (result as { structuredContent?: unknown }).structuredContent
                : undefined;
            const structuredContent =
              rawStructured !== undefined && rawStructured !== null
                ? (rawStructured as Record<string, unknown>)
                : undefined;
            // If handler returns content array, use it; otherwise build content from message or stringify
            let content: Array<{ type: "text"; text: string }>;
            if (result && Array.isArray(result.content)) {
              content = result.content as Array<{ type: "text"; text: string }>;
            } else if (result && typeof result.message === "string") {
              content = [{ type: "text" as const, text: result.message }];
            } else {
              content = [
                {
                  type: "text" as const,
                  text: JSON.stringify(result ?? {}),
                },
              ];
            }
            return {
              content,
              ...(structuredContent !== undefined && { structuredContent }),
            };
          },
        );
        state.registeredTools.set(tool.name, registered);
      }
    }
  }

  // Set up resources
  if (config.resources && config.resources.length > 0) {
    for (const resource of config.resources) {
      // Check if there's a custom handler from the callback
      const customHandler = config.onRegisterResource
        ? config.onRegisterResource(resource)
        : undefined;

      const registered = mcpServer.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        customHandler ||
          (async () => {
            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType || "text/plain",
                  text: resource.text ?? "",
                  ...(resource._meta != null && { _meta: resource._meta }),
                },
              ],
            };
          }),
      );
      state.registeredResources.set(resource.uri, registered);
    }
  }

  // Set up resource templates
  if (config.resourceTemplates && config.resourceTemplates.length > 0) {
    for (const template of config.resourceTemplates) {
      // ResourceTemplate is a class - create an instance with the URI template string and callbacks
      // Convert list callback: SDK expects ListResourcesResult
      // We support both string[] (convenience) and ListResourcesResult (full control)
      const listCallback = template.list
        ? async () => {
            const result = template.list!();
            const resolved = await result;
            // Check if it's already a ListResourcesResult (has resources array)
            if (
              resolved &&
              typeof resolved === "object" &&
              "resources" in resolved
            ) {
              return resolved as ListResourcesResult;
            }
            // Otherwise, it's string[] - convert to ListResourcesResult
            const uriArray = resolved as string[];
            return {
              resources: uriArray.map((uri) => ({
                uri,
                name: uri, // Use URI as name if not provided
              })),
            };
          }
        : undefined;

      // Convert complete callback: SDK expects {[variable: string]: callback}
      // We support either a map or a single function
      let completeCallbacks:
        | {
            [variable: string]: (
              value: string,
              context?: { arguments?: Record<string, string> },
            ) => Promise<string[]> | string[];
          }
        | undefined = undefined;

      if (template.complete) {
        if (typeof template.complete === "function") {
          // Single function - extract variable names from URI template and use for all
          // Parse URI template to find variables (e.g., {file} from "file://{file}")
          const variableMatches = template.uriTemplate.match(/\{([^}]+)\}/g);
          if (variableMatches) {
            completeCallbacks = {};
            const completeFn = template.complete;
            for (const match of variableMatches) {
              const variableName = match.slice(1, -1); // Remove { and }
              completeCallbacks[variableName] = async (
                value: string,
                context?: { arguments?: Record<string, string> },
              ) => {
                const result = completeFn(
                  variableName,
                  value,
                  context?.arguments,
                );
                return Array.isArray(result) ? result : await result;
              };
            }
          }
        } else {
          // Map of variable names to callbacks
          completeCallbacks = {};
          for (const [variableName, callback] of Object.entries(
            template.complete,
          )) {
            completeCallbacks[variableName] = async (
              value: string,
              context?: { arguments?: Record<string, string> },
            ) => {
              const result = callback(value, context?.arguments);
              return Array.isArray(result) ? result : await result;
            };
          }
        }
      }

      const resourceTemplate = new SdkResourceTemplate(template.uriTemplate, {
        list: listCallback,
        complete: completeCallbacks,
      });

      const registered = mcpServer.registerResource(
        template.name,
        resourceTemplate,
        {
          description: template.description,
        },
        async (uri: URL, variables: Record<string, unknown>, ctx) => {
          const result = await template.handler(
            uri,
            variables,
            context,
            toHandlerExtra(ctx),
          );
          return result;
        },
      );
      state.registeredResourceTemplates.set(template.uriTemplate, registered);
    }
  }

  // Set up prompts
  if (config.prompts && config.prompts.length > 0) {
    for (const prompt of config.prompts) {
      // Build argsSchema with completion support if provided
      let argsSchema = prompt.argsSchema;

      // If completions callbacks are provided, wrap the corresponding schemas
      if (prompt.completions && argsSchema) {
        const enhancedSchema: Record<string, z.ZodType> = { ...argsSchema };
        for (const [argName, completeCallback] of Object.entries(
          prompt.completions,
        )) {
          if (enhancedSchema[argName]) {
            // Wrap with completable only if not already wrapped (avoids "Cannot redefine property" when createMcpServer is called multiple times with shared config)
            if (!isCompletable(enhancedSchema[argName])) {
              enhancedSchema[argName] = completable(
                enhancedSchema[argName],
                async (
                  value: unknown,
                  context?: { arguments?: Record<string, string> },
                ) => {
                  const result = completeCallback(
                    String(value),
                    context?.arguments,
                  );
                  return Array.isArray(result) ? result : await result;
                },
              );
            }
          }
        }
        argsSchema = enhancedSchema;
      }

      const registered = mcpServer.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema: argsSchema,
        },
        async (args) => {
          let text = prompt.promptString;

          // If args are provided, substitute them into the prompt string
          // Replace {argName} with the actual value
          if (args && typeof args === "object") {
            for (const [key, value] of Object.entries(args)) {
              const placeholder = `{${key}}`;
              text = text.replace(
                new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g"),
                String(value),
              );
            }
          }

          return {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text,
                },
              },
            ],
          };
        },
      );
      state.registeredPrompts.set(prompt.name, registered);
    }
  }

  // Set up pagination handlers if maxPageSize is configured
  const maxPageSize = config.maxPageSize || {};

  // Tools pagination
  if (capabilities.tools && maxPageSize.tools !== undefined) {
    mcpServer.server.setRequestHandler("tools/list", async (request) => {
      const cursor = request.params?.cursor;
      const pageSize = maxPageSize.tools!;

      // Convert registered tools to Tool format, mirroring the SDK's tools/list.
      // The input-schema JSON comes from the SDK's memoised converter; the
      // output-schema JSON is the value the SDK cached at registration.
      const allTools: Tool[] = [];
      for (const [name, registered] of state.registeredTools.entries()) {
        if (registered.enabled) {
          const toolDefinition: Record<string, unknown> = {
            name,
            title: registered.title,
            description: registered.description,
            inputSchema:
              mcpServer.toolInputSchemaJson(name) ?? EMPTY_OBJECT_JSON_SCHEMA,
            annotations: registered.annotations,
            execution: registered.execution,
            _meta: registered._meta,
          };

          if (registered.outputSchema && registered.outputSchemaJson) {
            toolDefinition.outputSchema = registered.outputSchemaJson;
          }

          allTools.push(toolDefinition as Tool);
        }
      }

      const startIndex = cursor ? parseInt(cursor, 10) : 0;
      const endIndex = startIndex + pageSize;
      const page = allTools.slice(startIndex, endIndex);
      const nextCursor =
        endIndex < allTools.length ? endIndex.toString() : undefined;

      return {
        tools: page,
        nextCursor,
      } as ListToolsResult;
    });
  }

  // Resources pagination
  if (capabilities.resources && maxPageSize.resources !== undefined) {
    mcpServer.server.setRequestHandler(
      "resources/list",
      async (request, ctx) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.resources!;

        // Collect all resources (static + from templates)
        const allResources: Resource[] = [];

        // Add static resources from registered resources
        for (const [uri, registered] of state.registeredResources.entries()) {
          if (registered.enabled) {
            allResources.push({
              uri,
              name: registered.name,
              title: registered.title,
              description: registered.metadata?.description,
              mimeType: registered.metadata?.mimeType,
              icons: registered.metadata?.icons,
            } as Resource);
          }
        }

        // Add resources from templates (if list callback exists)
        for (const template of state.registeredResourceTemplates.values()) {
          if (template.enabled && template.resourceTemplate.listCallback) {
            try {
              const result = await template.resourceTemplate.listCallback(ctx);
              for (const resource of result.resources) {
                allResources.push({
                  ...resource,
                  // Merge template metadata if resource doesn't have it
                  name: resource.name,
                  description:
                    resource.description || template.metadata?.description,
                  mimeType: resource.mimeType || template.metadata?.mimeType,
                  icons: resource.icons || template.metadata?.icons,
                } as Resource);
              }
            } catch {
              // Ignore errors from list callbacks
            }
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allResources.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allResources.length ? endIndex.toString() : undefined;

        return {
          resources: page,
          nextCursor,
        } as ListResourcesResult;
      },
    );
  }

  // Resource templates pagination
  if (capabilities.resources && maxPageSize.resourceTemplates !== undefined) {
    mcpServer.server.setRequestHandler(
      "resources/templates/list",
      async (request) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.resourceTemplates!;

        // Convert registered resource templates to ResourceTemplate format
        const allTemplates: Array<{
          uriTemplate: string;
          name: string;
          description?: string;
          mimeType?: string;
          icons?: Array<{
            src: string;
            mimeType?: string;
            sizes?: string[];
            theme?: "light" | "dark";
          }>;
          title?: string;
        }> = [];
        for (const [
          uriTemplate,
          registered,
        ] of state.registeredResourceTemplates.entries()) {
          if (registered.enabled) {
            // Find the name from config by matching uriTemplate
            const templateDef = config.resourceTemplates?.find(
              (t) => t.uriTemplate === uriTemplate,
            );
            allTemplates.push({
              uriTemplate: registered.resourceTemplate.uriTemplate.toString(),
              name: templateDef?.name || uriTemplate, // Fallback to uriTemplate if name not found
              title: registered.title,
              description:
                registered.metadata?.description || templateDef?.description,
              mimeType: registered.metadata?.mimeType,
              icons: registered.metadata?.icons,
            });
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allTemplates.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allTemplates.length ? endIndex.toString() : undefined;

        return {
          resourceTemplates: page as ResourceTemplate[],
          nextCursor,
        } as ListResourceTemplatesResult;
      },
    );
  }

  // Prompts pagination
  if (capabilities.prompts && maxPageSize.prompts !== undefined) {
    mcpServer.server.setRequestHandler("prompts/list", async (request) => {
      const cursor = request.params?.cursor;
      const pageSize = maxPageSize.prompts!;

      // Convert registered prompts to Prompt format. The argument descriptors
      // are derived from the config's raw arg shape (the SDK no longer exposes
      // a public shape-introspection helper).
      const allPrompts: Prompt[] = [];
      for (const [name, prompt] of state.registeredPrompts.entries()) {
        if (prompt.enabled) {
          const promptDef = config.prompts?.find((p) => p.name === name);
          const arguments_ = promptArgumentsFromRawShape(promptDef?.argsSchema);

          allPrompts.push({
            name,
            title: prompt.title,
            description: prompt.description,
            arguments: arguments_,
          } as Prompt);
        }
      }

      const startIndex = cursor ? parseInt(cursor, 10) : 0;
      const endIndex = startIndex + pageSize;
      const page = allPrompts.slice(startIndex, endIndex);
      const nextCursor =
        endIndex < allPrompts.length ? endIndex.toString() : undefined;

      return {
        prompts: page,
        nextCursor,
      } as ListPromptsResult;
    });
  }

  // --- Legacy tasks wiring (only when the tasks capability is enabled) ---
  if (taskStore) {
    wireTaskHandlers(mcpServer, taskStore, taskTools);
  }

  return mcpServer;
}

/** Structural view of the low-level `Server`'s request-handler registry. */
interface RawHandlerHost {
  _requestHandlers: Map<
    string,
    (request: unknown, ctx: unknown) => Promise<unknown>
  >;
}

/** Inbound `tools/call` request shape we read for task routing. */
interface ToolsCallRequest {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
}

/**
 * Wire up the 2025-11-25 task methods by hand:
 *  - override `tools/call` so a task tool returns a `{ task }` handle
 *    (`CreateTaskResult`) and runs its `createTask`, while ordinary tools fall
 *    through to the SDK's own handler;
 *  - register low-level `tasks/get` / `tasks/result` / `tasks/cancel` /
 *    `tasks/list` handlers backed by the in-memory store.
 *
 * The `tools/call` override is installed directly into the handler registry
 * (not via `setRequestHandler`) so the `{ task }` result skips the `Server`'s
 * `tools/call` result-schema validation — a task handle is not a `CallToolResult`
 * but is a valid legacy `tools/call` response.
 */
function wireTaskHandlers(
  mcpServer: McpServer,
  taskStore: InMemoryTaskStore,
  taskTools: Map<string, TaskToolDefinition>,
): void {
  const lowLevel = mcpServer.server;
  const registry = (lowLevel as unknown as RawHandlerHost)._requestHandlers;
  const sdkToolsCall = registry.get("tools/call");
  // Map each created task back to the tool that owns it, so tasks/get and
  // tasks/result route through that tool's handler.
  const taskOwners = new Map<string, TaskToolDefinition>();

  registry.set("tools/call", async (request, ctx) => {
    const req = request as ToolsCallRequest;
    const taskTool = taskTools.get(req.params.name);
    if (taskTool) {
      const mcpReq = (ctx as McpReqContext).mcpReq;
      // Task execution is fire-and-forget: it runs AFTER this `tools/call`
      // request has already responded with the task handle. Its server→client
      // requests (elicitation/sampling) and notifications (progress) must
      // therefore go on the server's STANDALONE stream, not the per-request
      // stream (`mcpReq.send`/`mcpReq.notify` tag `relatedRequestId` to this
      // now-closed request, so the client never sees them). Route through the
      // server's own `request`/`notification` instead.
      const extra: CreateTaskRequestHandlerExtra = {
        taskStore,
        _meta: req.params._meta ?? mcpReq?._meta,
        requestId: mcpReq?.id,
        sendRequest: ((request, resultSchema) =>
          mcpServer.server.request(
            request,
            resultSchema,
          )) as CreateTaskRequestHandlerExtra["sendRequest"],
        sendNotification: (notification) =>
          mcpServer.server.notification(notification),
      };
      const { task } = await taskTool.handler.createTask(
        req.params.arguments ?? {},
        extra,
      );
      taskOwners.set(task.taskId, taskTool);
      // Return a result that is BOTH a valid legacy `CreateTaskResult` (carries
      // `task`) AND a valid wire `CallToolResult` (carries `content`). The
      // Inspector's task-augmented `tools/call` is validated on the client
      // against the tools/call wire schema, whose SEP-2106 guard rejects a body
      // that carries `task` but no `content`; including a placeholder `content`
      // satisfies that guard while the `task` handle drives the task flow (the
      // real payload is later fetched via `tasks/result`).
      return {
        content: [{ type: "text", text: `Task ${task.taskId} created` }],
        task,
      };
    }
    if (!sdkToolsCall) {
      throw new Error("tools/call handler is not initialized");
    }
    return sdkToolsCall(request, ctx);
  });

  mcpServer.server.setRequestHandler(
    "tasks/get",
    { params: GetTaskRequestSchema.shape.params },
    async (params): Promise<GetTaskResult> => {
      const taskId = params.taskId;
      const owner = taskOwners.get(taskId);
      if (owner) {
        return owner.handler.getTask({}, { taskId, taskStore });
      }
      const task = await taskStore.getTask(taskId);
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }
      return task as GetTaskResult;
    },
  );

  mcpServer.server.setRequestHandler(
    "tasks/result",
    { params: GetTaskPayloadRequestSchema.shape.params },
    async (params): Promise<CallToolResult> => {
      const taskId = params.taskId;
      const owner = taskOwners.get(taskId);
      if (owner) {
        return owner.handler.getTaskResult({}, { taskId, taskStore });
      }
      return taskStore.getTaskResult(taskId);
    },
  );

  mcpServer.server.setRequestHandler(
    "tasks/cancel",
    { params: CancelTaskRequestSchema.shape.params },
    async (params): Promise<Task> => {
      const taskId = params.taskId;
      const task = await taskStore.updateTaskStatus(taskId, "cancelled");
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }
      return task;
    },
  );

  mcpServer.server.setRequestHandler(
    "tasks/list",
    { params: ListTasksRequestSchema.shape.params },
    async (): Promise<ListTasksResult> => {
      const tasks = await taskStore.listTasks();
      return { tasks };
    },
  );
}
