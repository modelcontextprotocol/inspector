// Main MCP client module
// Re-exports the primary API for MCP client/server interaction

export { InspectorClient } from "./inspectorClient.js";
export type { InspectorClientOptions } from "./inspectorClient.js";

export { loadMcpServersConfig } from "./config.js";

// Re-export types used by consumers
export type {
  // Config types
  MCPConfig,
  MCPServerConfig,
  // Connection and state types (used by components and hooks)
  ConnectionStatus,
  StderrLogEntry,
  MessageEntry,
  ServerState,
} from "./types.js";
