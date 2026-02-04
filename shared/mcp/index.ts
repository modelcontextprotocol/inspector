// Main MCP client module
// Re-exports the primary API for MCP client/server interaction

export { InspectorClient } from "./inspectorClient.js";
export type { InspectorClientOptions } from "./inspectorClient.js";

// Transport factory for Node (TUI, CLI); web apps would provide RemoteClientTransport factory
export { createTransportNode } from "./transport.js";

// Re-export type-safe event target types for consumers
export type { InspectorClientEventMap } from "./inspectorClientEventTarget.js";

export {
  loadMcpServersConfig,
  argsToMcpServerConfig,
  getServerType,
} from "./config.js";

// Re-export ContentCache
export {
  ContentCache,
  type ReadOnlyContentCache,
  type ReadWriteContentCache,
} from "./contentCache.js";

// Re-export types used by consumers
export type {
  // Transport factory types (required by InspectorClient)
  CreateTransport,
  CreateTransportOptions,
  CreateTransportResult,
  // Config types
  MCPConfig,
  MCPServerConfig,
  ServerType,
  // Connection and state types (used by components and hooks)
  ConnectionStatus,
  StderrLogEntry,
  MessageEntry,
  FetchRequestEntry,
  ServerState,
  // Invocation types (returned from InspectorClient methods)
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
} from "./types.js";

// Re-export JSON utilities
export type { JsonValue } from "../json/jsonUtils.js";
export {
  convertParameterValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
