import type {
  ListToolsResult,
  CallToolResult,
  CompatibilityCallToolResult,
  ListPromptsResult,
  GetPromptResult,
  ListResourcesResult,
  ReadResourceResult,
  ListResourceTemplatesResult,
  EmptyResult,
} from "@modelcontextprotocol/sdk/types.js";

// Union type for all possible MCP response types
export type McpResponse =
  | ListToolsResult
  | CallToolResult
  | CompatibilityCallToolResult
  | ListPromptsResult
  | GetPromptResult
  | ListResourcesResult
  | ReadResourceResult
  | ListResourceTemplatesResult
  | EmptyResult;
