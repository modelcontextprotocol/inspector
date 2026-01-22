import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  MCPServerConfig,
  StderrLogEntry,
  ConnectionStatus,
  MessageEntry,
  FetchRequestEntry,
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
  Implementation,
  LoggingLevel,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  type JsonValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
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
  private status: ConnectionStatus = "disconnected";
  // Server data
  private tools: any[] = [];
  private resources: any[] = [];
  private resourceTemplates: any[] = [];
  private prompts: any[] = [];
  private capabilities?: ServerCapabilities;
  private serverInfo?: Implementation;
  private instructions?: string;

  constructor(
    private transportConfig: MCPServerConfig,
    options: InspectorClientOptions = {},
  ) {
    super();
    this.maxMessages = options.maxMessages ?? 1000;
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
    this.maxFetchRequests = options.maxFetchRequests ?? 1000;
    this.autoFetchServerContents = options.autoFetchServerContents ?? true;
    this.initialLoggingLevel = options.initialLoggingLevel;

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

    this.client = new Client(
      options.clientIdentity ?? {
        name: "@modelcontextprotocol/inspector",
        version: "0.18.0",
      },
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
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: this.tools }));
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: this.resources }),
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
  getTools(): any[] {
    return [...this.tools];
  }

  /**
   * Get all resources
   */
  getResources(): any[] {
    return [...this.resources];
  }

  /**
   * Get resource templates
   * @returns Array of resource templates
   */
  getResourceTemplates(): any[] {
    return [...this.resourceTemplates];
  }

  /**
   * Get all prompts
   */
  getPrompts(): any[] {
    return [...this.prompts];
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
   * @returns Response containing tools array
   */
  async listTools(
    metadata?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listTools(params);
      return response;
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
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const toolsResponse = await this.listTools(generalMetadata);
      const tools = (toolsResponse.tools as Tool[]) || [];
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

      const response = await this.client.callTool({
        name: name,
        arguments: convertedArgs,
        _meta:
          mergedMetadata && Object.keys(mergedMetadata).length > 0
            ? mergedMetadata
            : undefined,
      });
      return response;
    } catch (error) {
      throw new Error(
        `Failed to call tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List available resources
   * @param metadata Optional metadata to include in the request
   * @returns Response containing resources array
   */
  async listResources(
    metadata?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listResources(params);
      return response;
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
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params: any = { uri };
      if (metadata && Object.keys(metadata).length > 0) {
        params._meta = metadata;
      }
      const response = await this.client.readResource(params);
      return response;
    } catch (error) {
      throw new Error(
        `Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List resource templates
   * @param metadata Optional metadata to include in the request
   * @returns Response containing resource templates array
   */
  async listResourceTemplates(
    metadata?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listResourceTemplates(params);
      return response;
    } catch (error) {
      throw new Error(
        `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List available prompts
   * @param metadata Optional metadata to include in the request
   * @returns Response containing prompts array
   */
  async listPrompts(
    metadata?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      const params =
        metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
      const response = await this.client.listPrompts(params);
      return response;
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
  ): Promise<Record<string, unknown>> {
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

      const response = await this.client.getPrompt(params);

      return response;
    } catch (error) {
      throw new Error(
        `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
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
          const result = await this.client.listResources();
          this.resources = result.resources || [];
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
          const templatesResult = await this.client.listResourceTemplates();
          this.resourceTemplates = templatesResult.resourceTemplates || [];
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
          const result = await this.client.listPrompts();
          this.prompts = result.prompts || [];
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
          const result = await this.client.listTools();
          this.tools = result.tools || [];
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
}
