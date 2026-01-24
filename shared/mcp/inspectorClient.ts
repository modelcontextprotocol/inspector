import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  MCPServerConfig,
  StderrLogEntry,
  ConnectionStatus,
  MessageEntry,
  FetchRequestEntry,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
} from "./types.js";
import {
  createTransport,
  type CreateTransportOptions,
  getServerType as getServerTypeFromConfig,
  type ServerType,
} from "./transport.js";
import {
  MessageTrackingTransport,
  type MessageTrackingCallbacks,
} from "./messageTrackingTransport.js";
import type {
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
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  RootsListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ProgressNotificationSchema,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ContentCache, type ReadOnlyContentCache } from "./contentCache.js";
import { InspectorClientEventTarget } from "./inspectorClientEventTarget.js";
import { SamplingCreateMessage } from "./samplingCreateMessage.js";
import { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
export interface InspectorClientOptions {
  /**
   * Client identity (name and version)
   */
  clientIdentity?: {
    name: string;
    version: string;
  };
  /**
   * Maximum number of messages to store (0 = unlimited, but not recommended)
   */
  maxMessages?: number;

  /**
   * Maximum number of stderr log entries to store (0 = unlimited, but not recommended)
   */
  maxStderrLogEvents?: number;

  /**
   * Maximum number of fetch requests to store (0 = unlimited, but not recommended)
   * Only applies to HTTP-based transports (SSE, streamable-http)
   */
  maxFetchRequests?: number;

  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;

  /**
   * Whether to automatically fetch server contents (tools, resources, prompts) on connect
   * (default: true for backward compatibility with TUI)
   */
  autoFetchServerContents?: boolean;

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
   * Whether to advertise elicitation capability (default: true)
   */
  elicit?: boolean;

  /**
   * Initial roots to configure. If provided (even if empty array), the client will
   * advertise roots capability and handle roots/list requests from the server.
   */
  roots?: Root[];

  /**
   * Whether to enable listChanged notification handlers (default: true)
   * If enabled, InspectorClient will automatically reload lists when notifications are received
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
}

/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - EventTarget interface for React hooks (cross-platform: works in browser and Node.js)
 * - Access to client functionality (prompts, resources, tools)
 */
// Maximum number of pages to fetch when paginating through lists
const MAX_PAGES = 100;

export class InspectorClient extends InspectorClientEventTarget {
  private client: Client | null = null;
  private transport: any = null;
  private baseTransport: any = null;
  private messages: MessageEntry[] = [];
  private stderrLogs: StderrLogEntry[] = [];
  private fetchRequests: FetchRequestEntry[] = [];
  private maxMessages: number;
  private maxStderrLogEvents: number;
  private maxFetchRequests: number;
  private autoFetchServerContents: boolean;
  private initialLoggingLevel?: LoggingLevel;
  private sample: boolean;
  private elicit: boolean;
  private progress: boolean;
  private status: ConnectionStatus = "disconnected";
  // Server data
  private tools: Tool[] = [];
  private resources: Resource[] = [];
  private resourceTemplates: ResourceTemplate[] = [];
  private prompts: Prompt[] = [];
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
  private cacheInternal: ContentCache;
  public readonly cache: ReadOnlyContentCache;
  // ListChanged notification configuration
  private listChangedNotifications: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
  // Resource subscriptions
  private subscribedResources: Set<string> = new Set();

  constructor(
    private transportConfig: MCPServerConfig,
    options: InspectorClientOptions = {},
  ) {
    super();
    // Initialize content cache
    this.cacheInternal = new ContentCache();
    this.cache = this.cacheInternal;
    this.maxMessages = options.maxMessages ?? 1000;
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
    this.maxFetchRequests = options.maxFetchRequests ?? 1000;
    this.autoFetchServerContents = options.autoFetchServerContents ?? true;
    this.initialLoggingLevel = options.initialLoggingLevel;
    this.sample = options.sample ?? true;
    this.elicit = options.elicit ?? true;
    this.progress = options.progress ?? true;
    // Only set roots if explicitly provided (even if empty array) - this enables roots capability
    this.roots = options.roots;
    // Initialize listChangedNotifications config (default: all enabled)
    this.listChangedNotifications = {
      tools: options.listChangedNotifications?.tools ?? true,
      resources: options.listChangedNotifications?.resources ?? true,
      prompts: options.listChangedNotifications?.prompts ?? true,
    };

    // Set up message tracking callbacks
    const messageTracking: MessageTrackingCallbacks = {
      trackRequest: (message: JSONRPCRequest) => {
        const entry: MessageEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "request",
          message,
        };
        this.addMessage(entry);
      },
      trackResponse: (
        message: JSONRPCResultResponse | JSONRPCErrorResponse,
      ) => {
        const messageId = message.id;
        // Find the matching request by message ID
        const requestEntry = this.messages.find(
          (e) =>
            e.direction === "request" &&
            "id" in e.message &&
            e.message.id === messageId,
        );

        if (requestEntry) {
          // Update the request entry with the response
          this.updateMessageResponse(requestEntry, message);
        } else {
          // No matching request found, create orphaned response entry
          const entry: MessageEntry = {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date(),
            direction: "response",
            message,
          };
          this.addMessage(entry);
        }
      },
      trackNotification: (message: JSONRPCNotification) => {
        const entry: MessageEntry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "notification",
          message,
        };
        this.addMessage(entry);
      },
    };

    // Create transport with stderr logging and fetch tracking if needed
    const transportOptions: CreateTransportOptions = {
      pipeStderr: options.pipeStderr ?? false,
      onStderr: (entry: StderrLogEntry) => {
        this.addStderrLog(entry);
      },
      onFetchRequest: (entry: FetchRequestEntry) => {
        this.addFetchRequest(entry);
      },
    };

    const { transport: baseTransport } = createTransport(
      transportConfig,
      transportOptions,
    );

    // Store base transport for event listeners (always listen to actual transport, not wrapper)
    this.baseTransport = baseTransport;

    // Wrap with MessageTrackingTransport if we're tracking messages
    this.transport =
      this.maxMessages > 0
        ? new MessageTrackingTransport(baseTransport, messageTracking)
        : baseTransport;

    // Set up transport event listeners on base transport to track disconnections
    this.baseTransport.onclose = () => {
      if (this.status !== "disconnected") {
        this.status = "disconnected";
        this.dispatchTypedEvent("statusChange", this.status);
        this.dispatchTypedEvent("disconnect");
      }
    };

    this.baseTransport.onerror = (error: Error) => {
      this.status = "error";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("error", error);
    };

    // Build client capabilities
    const clientOptions: { capabilities?: ClientCapabilities } = {};
    const capabilities: ClientCapabilities = {};
    if (this.sample) {
      capabilities.sampling = {};
    }
    if (this.elicit) {
      capabilities.elicitation = {};
    }
    // Advertise roots capability if roots option was provided (even if empty array)
    if (this.roots !== undefined) {
      capabilities.roots = { listChanged: true };
    }
    if (Object.keys(capabilities).length > 0) {
      clientOptions.capabilities = capabilities;
    }

    this.client = new Client(
      options.clientIdentity ?? {
        name: "@modelcontextprotocol/inspector",
        version: "0.18.0",
      },
      Object.keys(clientOptions).length > 0 ? clientOptions : undefined,
    );
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (!this.client || !this.transport) {
      throw new Error("Client or transport not initialized");
    }

    // If already connected, return early
    if (this.status === "connected") {
      return;
    }

    try {
      this.status = "connecting";
      this.dispatchTypedEvent("statusChange", this.status);

      // Clear message history on connect (start fresh for new session)
      // Don't clear stderrLogs - they persist across reconnects
      this.messages = [];
      this.dispatchTypedEvent("messagesChange");

      await this.client.connect(this.transport);
      this.status = "connected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("connect");

      // Always fetch server info (capabilities, serverInfo, instructions) - this is just cached data from initialize
      await this.fetchServerInfo();

      // Set initial logging level if configured and server supports it
      if (this.initialLoggingLevel && this.capabilities?.logging) {
        await this.client.setLoggingLevel(this.initialLoggingLevel);
      }

      // Auto-fetch server contents (tools, resources, prompts) if enabled
      if (this.autoFetchServerContents) {
        await this.fetchServerContents();
      }

      // Set up sampling request handler if sampling capability is enabled
      if (this.sample && this.client) {
        this.client.setRequestHandler(CreateMessageRequestSchema, (request) => {
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
              await this.listAllTools();
            },
          );
        }
        // Note: If handler should not be registered, we don't set it
        // The SDK client will ignore notifications for which no handler is registered

        // Resources listChanged handler (reloads both resources and resource templates)
        if (
          this.listChangedNotifications.resources &&
          this.capabilities?.resources?.listChanged
        ) {
          this.client.setNotificationHandler(
            ResourceListChangedNotificationSchema,
            async () => {
              // Resource templates are part of the resources capability
              await this.listAllResources();
              await this.listAllResourceTemplates();
            },
          );
        }

        // Prompts listChanged handler
        if (
          this.listChangedNotifications.prompts &&
          this.capabilities?.prompts?.listChanged
        ) {
          this.client.setNotificationHandler(
            PromptListChangedNotificationSchema,
            async () => {
              await this.listAllPrompts();
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
                // Clear cache for this resource (handles both regular resources and resource templates)
                this.cacheInternal.clearResourceAndResourceTemplate(uri);
                // Dispatch event to notify UI
                this.dispatchTypedEvent("resourceUpdated", { uri });
              }
            },
          );
        }

        // Progress notification handler
        if (this.progress) {
          this.client.setNotificationHandler(
            ProgressNotificationSchema,
            async (notification) => {
              // Dispatch event with full progress notification params
              this.dispatchTypedEvent(
                "progressNotification",
                notification.params,
              );
            },
          );
        }
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
      } catch (error) {
        // Ignore errors on close
      }
    }
    // Update status - transport onclose handler will also fire and clear state
    // But we also do it here in case disconnect() is called directly
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("disconnect");
    }

    // Clear server state (tools, resources, resource templates, prompts) on disconnect
    // These are only valid when connected
    this.tools = [];
    this.resources = [];
    this.resourceTemplates = [];
    this.prompts = [];
    this.pendingSamples = [];
    this.pendingElicitations = [];
    // Clear all cached content on disconnect
    this.cacheInternal.clearAll();
    // Clear resource subscriptions on disconnect
    this.subscribedResources.clear();
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.dispatchTypedEvent("toolsChange", this.tools);
    this.dispatchTypedEvent("resourcesChange", this.resources);
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent("promptsChange", this.prompts);
    this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
    this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
    this.dispatchTypedEvent("instructionsChange", this.instructions);
  }

  /**
   * Get the underlying MCP Client
   */
  getClient(): Client {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    return this.client;
  }

  /**
   * Get all messages
   */
  getMessages(): MessageEntry[] {
    return [...this.messages];
  }

  /**
   * Get all stderr logs
   */
  getStderrLogs(): StderrLogEntry[] {
    return [...this.stderrLogs];
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
   * Get all tools
   */
  getTools(): Tool[] {
    return [...this.tools];
  }

  /**
   * Get all resources
   */
  getResources(): Resource[] {
    return [...this.resources];
  }

  /**
   * Get resource templates
   * @returns Array of resource templates
   */
  getResourceTemplates(): ResourceTemplate[] {
    return [...this.resourceTemplates];
  }

  /**
   * Get all prompts
   */
  getPrompts(): Prompt[] {
    return [...this.prompts];
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
    await this.client.setLoggingLevel(level);
  }

  /**
   * Internal method to list tools without updating state or dispatching events
   * Used by callTool() to find tools without triggering state changes
   * @param metadata Optional metadata to include in the request
   * @returns Array of tools
   */
  private async listAllToolsInternal(
    metadata?: Record<string, string>,
  ): Promise<Tool[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const allTools: Tool[] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      do {
        const result = await this.listTools(cursor, metadata);
        allTools.push(...result.tools);
        cursor = result.nextCursor;
        pageCount++;
        if (pageCount >= MAX_PAGES) {
          throw new Error(
            `Maximum pagination limit (${MAX_PAGES} pages) reached while listing tools`,
          );
        }
      } while (cursor);

      return allTools;
    } catch (error) {
      throw new Error(
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List available tools with pagination support
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing tools array and optional nextCursor
   */
  async listTools(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ tools: Tool[]; nextCursor?: string }> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params: any =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await this.client.listTools(params);
      return {
        tools: response.tools || [],
        nextCursor: response.nextCursor,
      };
    } catch (error) {
      throw new Error(
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all available tools (fetches all pages)
   * @param metadata Optional metadata to include in the request
   * @returns Array of all tools
   */
  async listAllTools(metadata?: Record<string, string>): Promise<Tool[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const allTools = await this.listAllToolsInternal(metadata);

      // Find removed tool names by comparing with current tools
      const currentNames = new Set(this.tools.map((t) => t.name));
      const newNames = new Set(allTools.map((t) => t.name));
      // Clear cache for removed tools
      for (const name of currentNames) {
        if (!newNames.has(name)) {
          this.cacheInternal.clearToolCallResult(name);
        }
      }
      // Update internal state
      this.tools = allTools;
      // Dispatch change event
      this.dispatchTypedEvent("toolsChange", this.tools);
      return allTools;
    } catch (error) {
      throw new Error(
        `Failed to list all tools: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Call a tool by name
   * @param name Tool name
   * @param args Tool arguments
   * @param generalMetadata Optional general metadata
   * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
   * @returns Tool call response
   */
  async callTool(
    name: string,
    args: Record<string, JsonValue>,
    generalMetadata?: Record<string, string>,
    toolSpecificMetadata?: Record<string, string>,
  ): Promise<ToolCallInvocation> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const tools = await this.listAllToolsInternal(generalMetadata);
      const tool = tools.find((t) => t.name === name);

      let convertedArgs: Record<string, JsonValue> = args;

      if (tool) {
        // Convert parameters based on the tool's schema, but only for string values
        // since we now accept pre-parsed values from the CLI
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
      }

      // Merge general metadata with tool-specific metadata
      // Tool-specific metadata takes precedence over general metadata
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

      const result = await this.client.callTool({
        name: name,
        arguments: convertedArgs,
        _meta: metadata,
      });

      const invocation: ToolCallInvocation = {
        toolName: name,
        params: args,
        result: result as CallToolResult,
        timestamp,
        success: true,
        metadata,
      };

      // Store in cache
      this.cacheInternal.setToolCallResult(name, invocation);
      // Dispatch event
      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: name,
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
        toolName: name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata,
      };

      // Store in cache (even on error)
      this.cacheInternal.setToolCallResult(name, invocation);
      // Dispatch event
      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: invocation.error,
        metadata,
      });

      return invocation;
    }
  }

  /**
   * List available resources with pagination support
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
    try {
      const params: any =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await this.client.listResources(params);
      return {
        resources: response.resources || [],
        nextCursor: response.nextCursor,
      };
    } catch (error) {
      throw new Error(
        `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all available resources (fetches all pages)
   * @param metadata Optional metadata to include in the request
   * @returns Array of all resources
   */
  async listAllResources(
    metadata?: Record<string, string>,
  ): Promise<Resource[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const allResources: Resource[] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      do {
        const result = await this.listResources(cursor, metadata);
        allResources.push(...result.resources);
        cursor = result.nextCursor;
        pageCount++;
        if (pageCount >= MAX_PAGES) {
          throw new Error(
            `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resources`,
          );
        }
      } while (cursor);

      // Find removed URIs by comparing with current resources
      const currentUris = new Set(this.resources.map((r) => r.uri));
      const newUris = new Set(allResources.map((r) => r.uri));
      // Clear cache for removed resources
      for (const uri of currentUris) {
        if (!newUris.has(uri)) {
          this.cacheInternal.clearResource(uri);
        }
      }
      // Update internal state
      this.resources = allResources;
      // Dispatch change event
      this.dispatchTypedEvent("resourcesChange", this.resources);
      // Note: Cached content for existing resources is automatically preserved
      return allResources;
    } catch (error) {
      throw new Error(
        `Failed to list all resources: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    try {
      const params: any = { uri };
      if (metadata && Object.keys(metadata).length > 0) {
        params._meta = metadata;
      }
      const result = await this.client.readResource(params);
      const invocation: ResourceReadInvocation = {
        result,
        timestamp: new Date(),
        uri,
        metadata,
      };
      // Store in cache
      this.cacheInternal.setResource(uri, invocation);
      // Dispatch event
      this.dispatchTypedEvent("resourceContentChange", {
        uri,
        content: invocation,
        timestamp: invocation.timestamp,
      });
      return invocation;
    } catch (error) {
      throw new Error(
        `Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

    // Look up template in resourceTemplates by uriTemplate (the unique identifier)
    const template = this.resourceTemplates.find(
      (t) => t.uriTemplate === uriTemplate,
    );

    if (!template) {
      throw new Error(
        `Resource template with uriTemplate "${uriTemplate}" not found`,
      );
    }

    if (!template.uriTemplate) {
      throw new Error(`Resource template does not have a uriTemplate property`);
    }

    // Get the uriTemplate string (the unique ID of the template)
    const uriTemplateString = template.uriTemplate;

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

    // Store in cache
    this.cacheInternal.setResourceTemplate(uriTemplateString, invocation);
    // Dispatch event
    this.dispatchTypedEvent("resourceTemplateContentChange", {
      uriTemplate: uriTemplateString,
      content: invocation,
      params,
      timestamp: invocation.timestamp,
    });

    return invocation;
  }

  /**
   * List resource templates with pagination support
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
    try {
      const params: any =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await this.client.listResourceTemplates(params);
      return {
        resourceTemplates: response.resourceTemplates || [],
        nextCursor: response.nextCursor,
      };
    } catch (error) {
      throw new Error(
        `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all resource templates (fetches all pages)
   * @param metadata Optional metadata to include in the request
   * @returns Array of all resource templates
   */
  async listAllResourceTemplates(
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplate[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const allTemplates: ResourceTemplate[] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      do {
        const result = await this.listResourceTemplates(cursor, metadata);
        allTemplates.push(...result.resourceTemplates);
        cursor = result.nextCursor;
        pageCount++;
        if (pageCount >= MAX_PAGES) {
          throw new Error(
            `Maximum pagination limit (${MAX_PAGES} pages) reached while listing resource templates`,
          );
        }
      } while (cursor);

      // Find removed uriTemplates by comparing with current templates
      const currentUriTemplates = new Set(
        this.resourceTemplates.map((t) => t.uriTemplate),
      );
      const newUriTemplates = new Set(allTemplates.map((t) => t.uriTemplate));
      // Clear cache for removed templates
      for (const uriTemplate of currentUriTemplates) {
        if (!newUriTemplates.has(uriTemplate)) {
          this.cacheInternal.clearResourceTemplate(uriTemplate);
        }
      }
      // Update internal state
      this.resourceTemplates = allTemplates;
      // Dispatch change event
      this.dispatchTypedEvent(
        "resourceTemplatesChange",
        this.resourceTemplates,
      );
      // Note: Cached content for existing templates is automatically preserved
      return allTemplates;
    } catch (error) {
      throw new Error(
        `Failed to list all resource templates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    try {
      const params: any =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      if (cursor) {
        params.cursor = cursor;
      }
      const response = await this.client.listPrompts(params);
      return {
        prompts: response.prompts || [],
        nextCursor: response.nextCursor,
      };
    } catch (error) {
      throw new Error(
        `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all available prompts (fetches all pages)
   * @param metadata Optional metadata to include in the request
   * @returns Array of all prompts
   */
  async listAllPrompts(metadata?: Record<string, string>): Promise<Prompt[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const allPrompts: Prompt[] = [];
      let cursor: string | undefined;
      let pageCount = 0;

      do {
        const result = await this.listPrompts(cursor, metadata);
        allPrompts.push(...result.prompts);
        cursor = result.nextCursor;
        pageCount++;
        if (pageCount >= MAX_PAGES) {
          throw new Error(
            `Maximum pagination limit (${MAX_PAGES} pages) reached while listing prompts`,
          );
        }
      } while (cursor);

      // Find removed prompt names by comparing with current prompts
      const currentNames = new Set(this.prompts.map((p) => p.name));
      const newNames = new Set(allPrompts.map((p) => p.name));
      // Clear cache for removed prompts
      for (const name of currentNames) {
        if (!newNames.has(name)) {
          this.cacheInternal.clearPrompt(name);
        }
      }
      // Update internal state
      this.prompts = allPrompts;
      // Dispatch change event
      this.dispatchTypedEvent("promptsChange", this.prompts);
      // Note: Cached content for existing prompts is automatically preserved
      return allPrompts;
    } catch (error) {
      throw new Error(
        `Failed to list all prompts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    try {
      // Convert all arguments to strings for prompt arguments
      const stringArgs = args ? convertPromptArguments(args) : {};

      const params: any = {
        name,
        arguments: stringArgs,
      };

      if (metadata && Object.keys(metadata).length > 0) {
        params._meta = metadata;
      }

      const result = await this.client.getPrompt(params);

      const invocation: PromptGetInvocation = {
        result,
        timestamp: new Date(),
        name,
        params: Object.keys(stringArgs).length > 0 ? stringArgs : undefined,
        metadata,
      };

      // Store in cache
      this.cacheInternal.setPrompt(name, invocation);
      // Dispatch event
      this.dispatchTypedEvent("promptContentChange", {
        name,
        content: invocation,
        timestamp: invocation.timestamp,
      });

      return invocation;
    } catch (error) {
      throw new Error(
        `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
      const params: any = {
        ref,
        argument: {
          name: argumentName,
          value: argumentValue,
        },
      };

      if (context) {
        params.context = {
          arguments: context,
        };
      }

      if (metadata && Object.keys(metadata).length > 0) {
        params._meta = metadata;
      }

      const response = await this.client.complete(params);

      return {
        values: response.completion.values || [],
        total: response.completion.total,
        hasMore: response.completion.hasMore,
      };
    } catch (error: any) {
      // Handle MethodNotFound gracefully (server doesn't support completions)
      if (
        error?.code === -32601 ||
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
    } catch (error) {
      // Ignore errors in fetching server info
    }
  }

  /**
   * Fetch server contents (tools, resources, prompts) by sending MCP requests
   * This is only called when autoFetchServerContents is enabled
   * TODO: Add support for listChanged notifications to auto-refresh when server data changes
   */
  private async fetchServerContents(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      // Query resources, prompts, and tools based on capabilities
      // The list*() methods now handle state updates and event dispatching internally
      if (this.capabilities?.resources) {
        try {
          await this.listAllResources();
        } catch (err) {
          // Ignore errors, just leave empty
          this.resources = [];
          this.dispatchTypedEvent("resourcesChange", this.resources);
        }

        // Also fetch resource templates
        try {
          await this.listAllResourceTemplates();
        } catch (err) {
          // Ignore errors, just leave empty
          this.resourceTemplates = [];
          this.dispatchTypedEvent(
            "resourceTemplatesChange",
            this.resourceTemplates,
          );
        }
      }

      if (this.capabilities?.prompts) {
        try {
          await this.listAllPrompts();
        } catch (err) {
          // Ignore errors, just leave empty
          this.prompts = [];
          this.dispatchTypedEvent("promptsChange", this.prompts);
        }
      }

      if (this.capabilities?.tools) {
        try {
          await this.listAllTools();
        } catch (err) {
          // Ignore errors, just leave empty
          this.tools = [];
          this.dispatchTypedEvent("toolsChange", this.tools);
        }
      }
    } catch (error) {
      // Ignore errors in fetching server contents
    }
  }

  private addMessage(entry: MessageEntry): void {
    if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
      // Remove oldest message
      this.messages.shift();
    }
    this.messages.push(entry);
    this.dispatchTypedEvent("message", entry);
    this.dispatchTypedEvent("messagesChange");
  }

  private updateMessageResponse(
    requestEntry: MessageEntry,
    response: JSONRPCResultResponse | JSONRPCErrorResponse,
  ): void {
    const duration = Date.now() - requestEntry.timestamp.getTime();
    // Update the entry in place (mutate the object directly)
    requestEntry.response = response;
    requestEntry.duration = duration;
    this.dispatchTypedEvent("message", requestEntry);
    this.dispatchTypedEvent("messagesChange");
  }

  private addStderrLog(entry: StderrLogEntry): void {
    if (
      this.maxStderrLogEvents > 0 &&
      this.stderrLogs.length >= this.maxStderrLogEvents
    ) {
      // Remove oldest stderr log
      this.stderrLogs.shift();
    }
    this.stderrLogs.push(entry);
    this.dispatchTypedEvent("stderrLog", entry);
    this.dispatchTypedEvent("stderrLogsChange");
  }

  private addFetchRequest(entry: FetchRequestEntry): void {
    if (
      this.maxFetchRequests > 0 &&
      this.fetchRequests.length >= this.maxFetchRequests
    ) {
      // Remove oldest fetch request
      this.fetchRequests.shift();
    }
    this.fetchRequests.push(entry);
    this.dispatchTypedEvent("fetchRequest", entry);
    this.dispatchTypedEvent("fetchRequestsChange");
  }

  /**
   * Get all fetch requests
   */
  getFetchRequests(): FetchRequestEntry[] {
    return [...this.fetchRequests];
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
      await this.client.subscribeResource({ uri });
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
      await this.client.unsubscribeResource({ uri });
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
}
