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
  ReadResourceResult,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  RootsListChangedNotificationSchema,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ContentCache, type ReadOnlyContentCache } from "./contentCache.js";
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
}

/**
 * Represents a pending sampling request from the server
 */
export class SamplingCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: CreateMessageRequest;
  private resolvePromise?: (result: CreateMessageResult) => void;
  private rejectPromise?: (error: Error) => void;

  constructor(
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
    private onRemove: (id: string) => void,
  ) {
    this.id = `sampling-${Date.now()}-${Math.random()}`;
    this.timestamp = new Date();
    this.request = request;
    this.resolvePromise = resolve;
    this.rejectPromise = reject;
  }

  /**
   * Respond to the sampling request with a result
   */
  async respond(result: CreateMessageResult): Promise<void> {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.resolvePromise(result);
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    // Remove from pending list after responding
    this.remove();
  }

  /**
   * Reject the sampling request with an error
   */
  async reject(error: Error): Promise<void> {
    if (!this.rejectPromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.rejectPromise(error);
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    // Remove from pending list after rejecting
    this.remove();
  }

  /**
   * Remove this pending sample from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}

/**
 * Represents a pending elicitation request from the server
 */
export class ElicitationCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: ElicitRequest;
  private resolvePromise?: (result: ElicitResult) => void;

  constructor(
    request: ElicitRequest,
    resolve: (result: ElicitResult) => void,
    private onRemove: (id: string) => void,
  ) {
    this.id = `elicitation-${Date.now()}-${Math.random()}`;
    this.timestamp = new Date();
    this.request = request;
    this.resolvePromise = resolve;
  }

  /**
   * Respond to the elicitation request with a result
   */
  async respond(result: ElicitResult): Promise<void> {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved");
    }
    this.resolvePromise(result);
    this.resolvePromise = undefined;
    // Remove from pending list after responding
    this.remove();
  }

  /**
   * Remove this pending elicitation from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}

/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - EventTarget interface for React hooks (cross-platform: works in browser and Node.js)
 * - Access to client functionality (prompts, resources, tools)
 */
export class InspectorClient extends EventTarget {
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
    // Only set roots if explicitly provided (even if empty array) - this enables roots capability
    this.roots = options.roots;

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
        this.dispatchEvent(
          new CustomEvent("statusChange", { detail: this.status }),
        );
        this.dispatchEvent(new Event("disconnect"));
      }
    };

    this.baseTransport.onerror = (error: Error) => {
      this.status = "error";
      this.dispatchEvent(
        new CustomEvent("statusChange", { detail: this.status }),
      );
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
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
      this.dispatchEvent(
        new CustomEvent("statusChange", { detail: this.status }),
      );

      // Clear message history on connect (start fresh for new session)
      // Don't clear stderrLogs - they persist across reconnects
      this.messages = [];
      this.dispatchEvent(new Event("messagesChange"));

      await this.client.connect(this.transport);
      this.status = "connected";
      this.dispatchEvent(
        new CustomEvent("statusChange", { detail: this.status }),
      );
      this.dispatchEvent(new Event("connect"));

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
            this.dispatchEvent(new Event("rootsChange"));
          },
        );
      }
    } catch (error) {
      this.status = "error";
      this.dispatchEvent(
        new CustomEvent("statusChange", { detail: this.status }),
      );
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
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
      this.dispatchEvent(
        new CustomEvent("statusChange", { detail: this.status }),
      );
      this.dispatchEvent(new Event("disconnect"));
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
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: this.tools }));
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: this.resources }),
    );
    this.dispatchEvent(
      new CustomEvent("pendingSamplesChange", { detail: this.pendingSamples }),
    );
    this.dispatchEvent(
      new CustomEvent("promptsChange", { detail: this.prompts }),
    );
    this.dispatchEvent(
      new CustomEvent("capabilitiesChange", { detail: this.capabilities }),
    );
    this.dispatchEvent(
      new CustomEvent("serverInfoChange", { detail: this.serverInfo }),
    );
    this.dispatchEvent(
      new CustomEvent("instructionsChange", { detail: this.instructions }),
    );
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
    this.dispatchEvent(
      new CustomEvent("pendingSamplesChange", { detail: this.pendingSamples }),
    );
    this.dispatchEvent(new CustomEvent("newPendingSample", { detail: sample }));
  }

  /**
   * Remove a pending sampling request by ID
   */
  removePendingSample(id: string): void {
    const index = this.pendingSamples.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.pendingSamples.splice(index, 1);
      this.dispatchEvent(
        new CustomEvent("pendingSamplesChange", {
          detail: this.pendingSamples,
        }),
      );
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
    this.dispatchEvent(
      new CustomEvent("pendingElicitationsChange", {
        detail: this.pendingElicitations,
      }),
    );
    this.dispatchEvent(
      new CustomEvent("newPendingElicitation", { detail: elicitation }),
    );
  }

  /**
   * Remove a pending elicitation request by ID
   */
  removePendingElicitation(id: string): void {
    const index = this.pendingElicitations.findIndex((e) => e.id === id);
    if (index !== -1) {
      this.pendingElicitations.splice(index, 1);
      this.dispatchEvent(
        new CustomEvent("pendingElicitationsChange", {
          detail: this.pendingElicitations,
        }),
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
   * List available tools
   * @param metadata Optional metadata to include in the request
   * @returns Array of tools
   */
  async listTools(metadata?: Record<string, string>): Promise<Tool[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listTools(params);
      return response.tools || [];
    } catch (error) {
      throw new Error(
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
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
      const tools = await this.listTools(generalMetadata);
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
      this.dispatchEvent(
        new CustomEvent("toolCallResultChange", {
          detail: {
            toolName: name,
            params: args,
            result: invocation.result,
            timestamp,
            success: true,
            metadata,
          },
        }),
      );

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
      this.dispatchEvent(
        new CustomEvent("toolCallResultChange", {
          detail: {
            toolName: name,
            params: args,
            result: null,
            timestamp,
            success: false,
            error: invocation.error,
            metadata,
          },
        }),
      );

      return invocation;
    }
  }

  /**
   * List available resources
   * @param metadata Optional metadata to include in the request
   * @returns Array of resources
   */
  async listResources(metadata?: Record<string, string>): Promise<Resource[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listResources(params);
      return response.resources || [];
    } catch (error) {
      throw new Error(
        `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
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
      this.dispatchEvent(
        new CustomEvent("resourceContentChange", {
          detail: {
            uri,
            content: invocation,
            timestamp: invocation.timestamp,
          },
        }),
      );
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
    this.dispatchEvent(
      new CustomEvent("resourceTemplateContentChange", {
        detail: {
          uriTemplate: uriTemplateString,
          expandedUri,
          content: invocation,
          params,
          timestamp: invocation.timestamp,
        },
      }),
    );

    return invocation;
  }

  /**
   * List resource templates
   * @param metadata Optional metadata to include in the request
   * @returns Array of resource templates
   */
  async listResourceTemplates(
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplate[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listResourceTemplates(params);
      return response.resourceTemplates || [];
    } catch (error) {
      throw new Error(
        `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List available prompts
   * @param metadata Optional metadata to include in the request
   * @returns Array of prompts
   */
  async listPrompts(metadata?: Record<string, string>): Promise<Prompt[]> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listPrompts(params);
      return response.prompts || [];
    } catch (error) {
      throw new Error(
        `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`,
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
      this.dispatchEvent(
        new CustomEvent("promptContentChange", {
          detail: {
            name,
            content: invocation,
            params: invocation.params,
            timestamp: invocation.timestamp,
          },
        }),
      );

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
      this.dispatchEvent(
        new CustomEvent("capabilitiesChange", { detail: this.capabilities }),
      );

      // Get server info (name, version) and instructions (cached from initialize response)
      this.serverInfo = this.client.getServerVersion();
      this.instructions = this.client.getInstructions();
      this.dispatchEvent(
        new CustomEvent("serverInfoChange", { detail: this.serverInfo }),
      );
      if (this.instructions !== undefined) {
        this.dispatchEvent(
          new CustomEvent("instructionsChange", { detail: this.instructions }),
        );
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
      if (this.capabilities?.resources) {
        try {
          this.resources = await this.listResources();
          this.dispatchEvent(
            new CustomEvent("resourcesChange", { detail: this.resources }),
          );
        } catch (err) {
          // Ignore errors, just leave empty
          this.resources = [];
          this.dispatchEvent(
            new CustomEvent("resourcesChange", { detail: this.resources }),
          );
        }

        // Also fetch resource templates
        try {
          this.resourceTemplates = await this.listResourceTemplates();
          this.dispatchEvent(
            new CustomEvent("resourceTemplatesChange", {
              detail: this.resourceTemplates,
            }),
          );
        } catch (err) {
          // Ignore errors, just leave empty
          this.resourceTemplates = [];
          this.dispatchEvent(
            new CustomEvent("resourceTemplatesChange", {
              detail: this.resourceTemplates,
            }),
          );
        }
      }

      if (this.capabilities?.prompts) {
        try {
          this.prompts = await this.listPrompts();
          this.dispatchEvent(
            new CustomEvent("promptsChange", { detail: this.prompts }),
          );
        } catch (err) {
          // Ignore errors, just leave empty
          this.prompts = [];
          this.dispatchEvent(
            new CustomEvent("promptsChange", { detail: this.prompts }),
          );
        }
      }

      if (this.capabilities?.tools) {
        try {
          this.tools = await this.listTools();
          this.dispatchEvent(
            new CustomEvent("toolsChange", { detail: this.tools }),
          );
        } catch (err) {
          // Ignore errors, just leave empty
          this.tools = [];
          this.dispatchEvent(
            new CustomEvent("toolsChange", { detail: this.tools }),
          );
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
    this.dispatchEvent(new CustomEvent("message", { detail: entry }));
    this.dispatchEvent(new Event("messagesChange"));
  }

  private updateMessageResponse(
    requestEntry: MessageEntry,
    response: JSONRPCResultResponse | JSONRPCErrorResponse,
  ): void {
    const duration = Date.now() - requestEntry.timestamp.getTime();
    // Update the entry in place (mutate the object directly)
    requestEntry.response = response;
    requestEntry.duration = duration;
    this.dispatchEvent(new CustomEvent("message", { detail: requestEntry }));
    this.dispatchEvent(new Event("messagesChange"));
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
    this.dispatchEvent(new CustomEvent("stderrLog", { detail: entry }));
    this.dispatchEvent(new Event("stderrLogsChange"));
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
    this.dispatchEvent(new CustomEvent("fetchRequest", { detail: entry }));
    this.dispatchEvent(new Event("fetchRequestsChange"));
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
    this.dispatchEvent(new CustomEvent("rootsChange", { detail: this.roots }));

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
}
