import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { JsonValue } from "@/utils/jsonUtils";

/**
 * Represents a saved MCP tool request that can be stored and replayed
 */
export interface McpJamRequest {
  /** Unique identifier for the request */
  id: string;

  /** Human-readable name for the request */
  name: string;

  /** Optional description of what this request does */
  description?: string;

  /** The tool that this request is for */
  toolName: string;

  /** The complete tool definition (for validation and UI purposes) */
  tool: Tool;

  /** The parameters to pass to the tool, following the tool's inputSchema */
  parameters: Record<string, JsonValue>;

  /** When this request was created */
  createdAt: Date;

  /** When this request was last modified */
  updatedAt: Date;

  /** Optional tags for categorization */
  tags?: string[];

  /** Whether this request is marked as a favorite */
  isFavorite?: boolean;

  /** The MCP client/server this request belongs to */
  clientId: string;
}

/**
 * Input type for creating a new McpJamRequest (without auto-generated fields)
 */
export interface CreateMcpJamRequestInput {
  name: string;
  description?: string;
  toolName: string;
  tool: Tool;
  parameters: Record<string, JsonValue>;
  tags?: string[];
  isFavorite?: boolean;
  clientId: string;
}

/**
 * Input type for updating an existing McpJamRequest
 */
export interface UpdateMcpJamRequestInput {
  name?: string;
  description?: string;
  parameters?: Record<string, JsonValue>;
  tags?: string[];
  isFavorite?: boolean;
}

/**
 * Collection of saved requests
 */
export interface McpJamRequestCollection {
  requests: McpJamRequest[];
  version: string;
  exportedAt: Date;
}
