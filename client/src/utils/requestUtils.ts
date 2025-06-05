import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { JsonValue, JsonSchemaType } from "./jsonUtils";
import {
  McpJamRequest,
  CreateMcpJamRequestInput,
  UpdateMcpJamRequestInput,
  McpJamRequestCollection,
} from "@/lib/requestTypes";
import { generateDefaultValue } from "./schemaUtils";

/**
 * Generates a unique ID for a request
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates a new McpJamRequest from input data
 */
export function createMcpJamRequest(
  input: CreateMcpJamRequestInput,
): McpJamRequest {
  const now = new Date();

  return {
    id: generateRequestId(),
    name: input.name,
    description: input.description,
    toolName: input.toolName,
    tool: input.tool,
    parameters: input.parameters,
    createdAt: now,
    updatedAt: now,
    tags: input.tags || [],
    isFavorite: input.isFavorite || false,
    clientId: input.clientId,
  };
}

/**
 * Updates an existing McpJamRequest with new data
 */
export function updateMcpJamRequest(
  existing: McpJamRequest,
  updates: UpdateMcpJamRequestInput,
): McpJamRequest {
  return {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };
}

/**
 * Validates that the parameters match the tool's input schema
 */
export function validateRequestParameters(
  tool: Tool,
  parameters: Record<string, JsonValue>,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const schema = tool.inputSchema;

  // Check required parameters
  const required = schema.required || [];
  for (const requiredParam of required) {
    if (
      !(requiredParam in parameters) ||
      parameters[requiredParam] === undefined
    ) {
      errors.push(`Missing required parameter: ${requiredParam}`);
    }
  }

  // Check parameter types (basic validation)
  const properties = schema.properties || {};
  for (const [paramName, paramValue] of Object.entries(parameters)) {
    if (paramValue === undefined) continue;

    const paramSchema = properties[paramName] as JsonSchemaType | undefined;
    if (!paramSchema) {
      errors.push(`Unknown parameter: ${paramName}`);
      continue;
    }

    // Basic type checking
    const expectedType = paramSchema.type;
    const actualType = getJsonValueType(paramValue);

    if (expectedType && actualType !== expectedType && actualType !== "null") {
      errors.push(
        `Parameter ${paramName} expected type ${expectedType}, got ${actualType}`,
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Gets the JSON schema type of a JsonValue
 */
function getJsonValueType(value: JsonValue): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

/**
 * Creates default parameters for a tool based on its schema
 */
export function createDefaultParameters(tool: Tool): Record<string, JsonValue> {
  const parameters: Record<string, JsonValue> = {};
  const properties = tool.inputSchema.properties || {};

  for (const [key, schema] of Object.entries(properties)) {
    parameters[key] = generateDefaultValue(schema as JsonSchemaType);
  }

  return parameters;
}

/**
 * Generates a default name for a request based on the tool and parameters
 */
export function generateDefaultRequestName(
  tool: Tool,
  parameters: Record<string, JsonValue>,
): string {
  const toolName = tool.name;

  // Try to find a meaningful parameter to include in the name
  const meaningfulParams = Object.entries(parameters)
    .filter(
      ([, value]) => value && typeof value === "string" && value.length > 0,
    )
    .slice(0, 1); // Take first meaningful parameter

  if (meaningfulParams.length > 0) {
    const [, paramValue] = meaningfulParams[0];
    const shortValue = String(paramValue).slice(0, 30);
    return `${toolName} - ${shortValue}${String(paramValue).length > 30 ? "..." : ""}`;
  }

  return `${toolName} Request`;
}

/**
 * Exports a collection of requests to JSON
 */
export function exportRequestCollection(
  requests: McpJamRequest[],
): McpJamRequestCollection {
  return {
    requests,
    version: "1.0.0",
    exportedAt: new Date(),
  };
}

/**
 * Imports a collection of requests from JSON
 */
export function importRequestCollection(
  data: McpJamRequestCollection,
): McpJamRequest[] {
  // Convert date strings back to Date objects and handle missing clientId for migration
  return data.requests.map((request) => ({
    ...request,
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
    // Provide default clientId for requests that don't have one (migration)
    clientId: request.clientId || "unknown",
  }));
}

/**
 * Filters requests by various criteria
 */
export function filterRequests(
  requests: McpJamRequest[],
  filters: {
    search?: string;
    toolName?: string;
    tags?: string[];
    isFavorite?: boolean;
    clientId?: string;
  },
): McpJamRequest[] {
  return requests.filter((request) => {
    // Client ID filter
    if (filters.clientId && request.clientId !== filters.clientId) {
      return false;
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSearch =
        request.name.toLowerCase().includes(searchLower) ||
        request.description?.toLowerCase().includes(searchLower) ||
        request.toolName.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;
    }

    // Tool name filter
    if (filters.toolName && request.toolName !== filters.toolName) {
      return false;
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      const hasMatchingTag = filters.tags.some((tag) =>
        request.tags?.includes(tag),
      );
      if (!hasMatchingTag) return false;
    }

    // Favorite filter
    if (
      filters.isFavorite !== undefined &&
      request.isFavorite !== filters.isFavorite
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Sorts requests by various criteria
 */
export function sortRequests(
  requests: McpJamRequest[],
  sortBy: "name" | "createdAt" | "updatedAt" | "toolName",
  order: "asc" | "desc" = "desc",
): McpJamRequest[] {
  return [...requests].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "toolName":
        comparison = a.toolName.localeCompare(b.toolName);
        break;
      case "createdAt":
        comparison = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case "updatedAt":
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
    }

    return order === "asc" ? comparison : -comparison;
  });
}

/**
 * Gets all requests for a specific client
 */
export function getRequestsForClient(
  requests: McpJamRequest[],
  clientId: string,
): McpJamRequest[] {
  return filterRequests(requests, { clientId });
}
