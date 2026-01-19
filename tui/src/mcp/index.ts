// Main MCP client module
// Re-exports the primary API for MCP client/server interaction

export { InspectorClient } from "./inspectorClient.js";
export type { InspectorClientOptions } from "./inspectorClient.js";

export { createTransport, getServerType } from "./transport.js";
export type {
  CreateTransportOptions,
  CreateTransportResult,
  ServerType,
} from "./transport.js";

export { createClient } from "./client.js";

export { MessageTrackingTransport } from "./messageTrackingTransport.js";
export type { MessageTrackingCallbacks } from "./messageTrackingTransport.js";

export { loadMcpServersConfig } from "./config.js";

// Re-export all types
export type {
  // Transport config types
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
  MCPServerConfig,
  MCPConfig,
  // Connection and state types
  ConnectionStatus,
  StderrLogEntry,
  MessageEntry,
  ServerState,
} from "./types.js";
