import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { OpenAIFunction } from "../chat-types";

/**
 * Converts MCP Tool definitions to OpenAI function definitions
 */
export function convertMCPToolToOpenAIFunction(tool: Tool): OpenAIFunction {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  // Convert tool schema properties
  if (tool.inputSchema?.properties) {
    for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
      properties[key] = convertSchemaProperty(prop as any);
    }
  }

  // Extract required fields
  if (tool.inputSchema?.required) {
    required.push(...(Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [tool.inputSchema.required]));
  }

  return {
    name: tool.name,
    description: tool.description || `Execute ${tool.name} tool`,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

/**
 * Convert a JSON schema property to OpenAI function parameter format
 */
function convertSchemaProperty(prop: any): any {
  const result: any = {
    type: prop.type,
  };

  if (prop.description) {
    result.description = prop.description;
  }

  if (prop.enum) {
    result.enum = prop.enum;
  }

  if (prop.type === "array" && prop.items) {
    result.items = convertSchemaProperty(prop.items);
  }

  if (prop.type === "object" && prop.properties) {
    result.properties = {};
    for (const [key, subProp] of Object.entries(prop.properties)) {
      result.properties[key] = convertSchemaProperty(subProp);
    }
    if (prop.required) {
      result.required = prop.required;
    }
  }

  return result;
}

/**
 * Generate a unique ID for chat messages and tool calls
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Format tool result for display in chat
 */
export function formatToolResult(result: any): string {
  if (typeof result === "string") {
    return result;
  }

  if (result && typeof result === "object") {
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((item: any) => {
          if (item.type === "text") {
            return item.text;
          } else if (item.type === "image") {
            return `[Image: ${item.mimeType || "unknown format"}]`;
          } else if (item.type === "resource") {
            return `[Resource: ${item.resource?.uri || "unknown"}]`;
          }
          return JSON.stringify(item, null, 2);
        })
        .join("\n");
    }
  }

  return JSON.stringify(result, null, 2);
}
