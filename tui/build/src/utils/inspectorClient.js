import { createTransport } from "./transport.js";
import { createClient } from "./client.js";
import { MessageTrackingTransport } from "./messageTrackingTransport.js";
import { EventEmitter } from "events";
/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - Event emitter interface for React hooks
 * - Access to client functionality (prompts, resources, tools)
 */
export class InspectorClient extends EventEmitter {
  transportConfig;
  client = null;
  transport = null;
  baseTransport = null;
  messages = [];
  stderrLogs = [];
  maxMessages;
  maxStderrLogEvents;
  status = "disconnected";
  // Server data
  tools = [];
  resources = [];
  prompts = [];
  capabilities;
  serverInfo;
  instructions;
  constructor(transportConfig, options = {}) {
    super();
    this.transportConfig = transportConfig;
    this.maxMessages = options.maxMessages ?? 1000;
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
    // Set up message tracking callbacks
    const messageTracking = {
      trackRequest: (message) => {
        const entry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "request",
          message,
        };
        this.addMessage(entry);
      },
      trackResponse: (message) => {
        const messageId = message.id;
        // Find the matching request by message ID
        const requestIndex = this.messages.findIndex(
          (e) =>
            e.direction === "request" &&
            "id" in e.message &&
            e.message.id === messageId,
        );
        if (requestIndex !== -1) {
          // Update the request entry with the response
          this.updateMessageResponse(requestIndex, message);
        } else {
          // No matching request found, create orphaned response entry
          const entry = {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date(),
            direction: "response",
            message,
          };
          this.addMessage(entry);
        }
      },
      trackNotification: (message) => {
        const entry = {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "notification",
          message,
        };
        this.addMessage(entry);
      },
    };
    // Create transport with stderr logging if needed
    const transportOptions = {
      pipeStderr: options.pipeStderr ?? false,
      onStderr: (entry) => {
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
    this.baseTransport.onerror = (error) => {
      this.status = "error";
      this.emit("statusChange", this.status);
      this.emit("error", error);
    };
    // Create client
    this.client = createClient(this.transport);
  }
  /**
   * Connect to the MCP server
   */
  async connect() {
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
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        // Ignore errors on close
      }
    }
    // Update status - transport onclose handler will also fire, but we update here too
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.emit("statusChange", this.status);
      this.emit("disconnect");
    }
  }
  /**
   * Get the underlying MCP Client
   */
  getClient() {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    return this.client;
  }
  /**
   * Get all messages
   */
  getMessages() {
    return [...this.messages];
  }
  /**
   * Get all stderr logs
   */
  getStderrLogs() {
    return [...this.stderrLogs];
  }
  /**
   * Clear all messages
   */
  clearMessages() {
    this.messages = [];
    this.emit("messagesChange");
  }
  /**
   * Clear all stderr logs
   */
  clearStderrLogs() {
    this.stderrLogs = [];
    this.emit("stderrLogsChange");
  }
  /**
   * Get the current connection status
   */
  getStatus() {
    return this.status;
  }
  /**
   * Get the MCP server configuration used to create this client
   */
  getTransportConfig() {
    return this.transportConfig;
  }
  /**
   * Get all tools
   */
  getTools() {
    return [...this.tools];
  }
  /**
   * Get all resources
   */
  getResources() {
    return [...this.resources];
  }
  /**
   * Get all prompts
   */
  getPrompts() {
    return [...this.prompts];
  }
  /**
   * Get server capabilities
   */
  getCapabilities() {
    return this.capabilities;
  }
  /**
   * Get server info (name, version)
   */
  getServerInfo() {
    return this.serverInfo;
  }
  /**
   * Get server instructions
   */
  getInstructions() {
    return this.instructions;
  }
  /**
   * Fetch server data (capabilities, tools, resources, prompts, serverInfo, instructions)
   * Called automatically on connect, but can be called manually if needed.
   * TODO: Add support for listChanged notifications to auto-refresh when server data changes
   */
  async fetchServerData() {
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
  addMessage(entry) {
    if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
      // Remove oldest message
      this.messages.shift();
    }
    this.messages.push(entry);
    this.emit("message", entry);
    this.emit("messagesChange");
  }
  updateMessageResponse(requestIndex, response) {
    const requestEntry = this.messages[requestIndex];
    const duration = Date.now() - requestEntry.timestamp.getTime();
    this.messages[requestIndex] = {
      ...requestEntry,
      response,
      duration,
    };
    this.emit("message", this.messages[requestIndex]);
    this.emit("messagesChange");
  }
  addStderrLog(entry) {
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
