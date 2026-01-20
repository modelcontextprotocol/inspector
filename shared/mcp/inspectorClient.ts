import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  MCPServerConfig,
  StderrLogEntry,
  ConnectionStatus,
  MessageEntry,
} from "./types.js";
import {
  createTransport,
  type CreateTransportOptions,
  getServerType as getServerTypeFromConfig,
  type ServerType,
} from "./transport.js";
import { createClient } from "./client.js";
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
} from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";

export interface InspectorClientOptions {
  /**
   * Maximum number of messages to store (0 = unlimited, but not recommended)
   */
  maxMessages?: number;

  /**
   * Maximum number of stderr log entries to store (0 = unlimited, but not recommended)
   */
  maxStderrLogEvents?: number;

  /**
   * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
   */
  pipeStderr?: boolean;
}

/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - Event emitter interface for React hooks
 * - Access to client functionality (prompts, resources, tools)
 */
export class InspectorClient extends EventEmitter {
  private client: Client | null = null;
  private transport: any = null;
  private baseTransport: any = null;
  private messages: MessageEntry[] = [];
  private stderrLogs: StderrLogEntry[] = [];
  private maxMessages: number;
  private maxStderrLogEvents: number;
  private status: ConnectionStatus = "disconnected";
  // Server data
  private tools: any[] = [];
  private resources: any[] = [];
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

    // Create transport with stderr logging if needed
    const transportOptions: CreateTransportOptions = {
      pipeStderr: options.pipeStderr ?? false,
      onStderr: (entry: StderrLogEntry) => {
        this.addStderrLog(entry);
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
        this.emit("statusChange", this.status);
        this.emit("disconnect");
      }
    };

    this.baseTransport.onerror = (error: Error) => {
      this.status = "error";
      this.emit("statusChange", this.status);
      this.emit("error", error);
    };

    this.client = createClient();
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
      this.emit("statusChange", this.status);

      // Clear message history on connect (start fresh for new session)
      // Don't clear stderrLogs - they persist across reconnects
      this.messages = [];
      this.emit("messagesChange");

      await this.client.connect(this.transport);
      this.status = "connected";
      this.emit("statusChange", this.status);
      this.emit("connect");

      // Auto-fetch server data on connect
      await this.fetchServerData();
    } catch (error) {
      this.status = "error";
      this.emit("statusChange", this.status);
      this.emit("error", error);
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
      this.emit("statusChange", this.status);
      this.emit("disconnect");
    }

    // Clear server state (tools, resources, prompts) on disconnect
    // These are only valid when connected
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.capabilities = undefined;
    this.serverInfo = undefined;
    this.instructions = undefined;
    this.emit("toolsChange", this.tools);
    this.emit("resourcesChange", this.resources);
    this.emit("promptsChange", this.prompts);
    this.emit("capabilitiesChange", this.capabilities);
    this.emit("serverInfoChange", this.serverInfo);
    this.emit("instructionsChange", this.instructions);
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
   * Fetch server data (capabilities, tools, resources, prompts, serverInfo, instructions)
   * Called automatically on connect, but can be called manually if needed.
   * TODO: Add support for listChanged notifications to auto-refresh when server data changes
   */
  private async fetchServerData(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      // Get server capabilities
      this.capabilities = this.client.getServerCapabilities();
      this.emit("capabilitiesChange", this.capabilities);

      // Get server info (name, version) and instructions
      this.serverInfo = this.client.getServerVersion();
      this.instructions = this.client.getInstructions();
      this.emit("serverInfoChange", this.serverInfo);
      if (this.instructions !== undefined) {
        this.emit("instructionsChange", this.instructions);
      }

      // Query resources, prompts, and tools based on capabilities
      if (this.capabilities?.resources) {
        try {
          const result = await this.client.listResources();
          this.resources = result.resources || [];
          this.emit("resourcesChange", this.resources);
        } catch (err) {
          // Ignore errors, just leave empty
          this.resources = [];
          this.emit("resourcesChange", this.resources);
        }
      }

      if (this.capabilities?.prompts) {
        try {
          const result = await this.client.listPrompts();
          this.prompts = result.prompts || [];
          this.emit("promptsChange", this.prompts);
        } catch (err) {
          // Ignore errors, just leave empty
          this.prompts = [];
          this.emit("promptsChange", this.prompts);
        }
      }

      if (this.capabilities?.tools) {
        try {
          const result = await this.client.listTools();
          this.tools = result.tools || [];
          this.emit("toolsChange", this.tools);
        } catch (err) {
          // Ignore errors, just leave empty
          this.tools = [];
          this.emit("toolsChange", this.tools);
        }
      }
    } catch (error) {
      // If fetching fails, we still consider the connection successful
      // but log the error
      this.emit("error", error);
    }
  }

  private addMessage(entry: MessageEntry): void {
    if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
      // Remove oldest message
      this.messages.shift();
    }
    this.messages.push(entry);
    this.emit("message", entry);
    this.emit("messagesChange");
  }

  private updateMessageResponse(
    requestEntry: MessageEntry,
    response: JSONRPCResultResponse | JSONRPCErrorResponse,
  ): void {
    const duration = Date.now() - requestEntry.timestamp.getTime();
    // Update the entry in place (mutate the object directly)
    requestEntry.response = response;
    requestEntry.duration = duration;
    this.emit("message", requestEntry);
    this.emit("messagesChange");
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
    this.emit("stderrLog", entry);
    this.emit("stderrLogsChange");
  }
}
