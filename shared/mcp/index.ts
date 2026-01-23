// Main MCP client module
// Re-exports the primary API for MCP client/server interaction

export { InspectorClient, SamplingCreateMessage } from "./inspectorClient.js";
export type { InspectorClientOptions } from "./inspectorClient.js";

export { loadMcpServersConfig, argsToMcpServerConfig } from "./config.js";

// Re-export types used by consumers
export type {
  // Config types
  MCPConfig,
  MCPServerConfig,
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
