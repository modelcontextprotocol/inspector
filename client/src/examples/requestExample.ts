import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpJamRequest, CreateMcpJamRequestInput } from "@/lib/requestTypes";
import {
  createMcpJamRequest,
  validateRequestParameters,
  generateDefaultRequestName,
  createDefaultParameters,
} from "@/utils/requestUtils";
import { RequestStorage } from "@/utils/requestStorage";

/**
 * Example of how to create and save a McpJamRequest
 */
export function exampleCreateAndSaveRequest() {
  // Example tool (this would come from your MCP server)
  const exampleTool: Tool = {
    name: "file_search",
    description: "Search for files in a directory",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        directory: {
          type: "string",
          description: "Directory to search in",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether search should be case sensitive",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results to return",
        },
      },
      required: ["query"],
    },
  };

  // Create parameters for the request
  const parameters = {
    query: "*.tsx",
    directory: "/src/components",
    case_sensitive: false,
    max_results: 10,
  };

  // Validate parameters against the tool schema
  const validation = validateRequestParameters(exampleTool, parameters);
  if (!validation.isValid) {
    console.error("Invalid parameters:", validation.errors);
    return;
  }

  // Create the request input
  const requestInput: CreateMcpJamRequestInput = {
    name: generateDefaultRequestName(exampleTool, parameters),
    description: "Search for React components in the components directory",
    toolName: exampleTool.name,
    tool: exampleTool,
    parameters: parameters,
    tags: ["search", "files", "components"],
    isFavorite: false,
    clientId: "example-client", // ID of the MCP client/server
  };

  // Create the actual request object
  const request: McpJamRequest = createMcpJamRequest(requestInput);

  // Save to storage
  RequestStorage.addRequest(request);

  console.log("Created and saved request:", request);
  return request;
}

/**
 * Example of how to load and use saved requests
 */
export function exampleLoadAndUseRequests() {
  // Load all saved requests
  const savedRequests = RequestStorage.loadRequests();

  console.log(`Found ${savedRequests.length} saved requests`);

  // Find requests for a specific tool
  const fileSearchRequests = savedRequests.filter(
    (req) => req.toolName === "file_search",
  );

  console.log(`Found ${fileSearchRequests.length} file search requests`);

  // Get favorites
  const favorites = savedRequests.filter((req) => req.isFavorite);
  console.log(`Found ${favorites.length} favorite requests`);

  // Example of how you might execute a saved request
  if (savedRequests.length > 0) {
    const firstRequest = savedRequests[0];
    console.log("Would execute request:", {
      toolName: firstRequest.toolName,
      parameters: firstRequest.parameters,
    });

    // In your actual implementation, you would call:
    // await callTool(firstRequest.toolName, firstRequest.parameters);
  }
}

/**
 * Example of creating a request with default parameters
 */
export function exampleCreateWithDefaults(
  tool: Tool,
  clientId: string = "default-client",
) {
  // Generate default parameters based on the tool's schema
  const defaultParams = createDefaultParameters(tool);

  const requestInput: CreateMcpJamRequestInput = {
    name: `Default ${tool.name} Request`,
    toolName: tool.name,
    tool: tool,
    parameters: defaultParams,
    clientId: clientId,
  };

  const request = createMcpJamRequest(requestInput);
  return request;
}

/**
 * Example of managing storage
 */
export function exampleStorageManagement() {
  // Get storage statistics
  const stats = RequestStorage.getStats();
  console.log("Storage stats:", stats);

  // Export all requests to JSON (for backup)
  const exportedJson = RequestStorage.exportToJson();
  console.log("Exported requests:", exportedJson);

  // Example of importing (you would get this JSON from a file or user input)
  // RequestStorage.importFromJson(exportedJson, true); // merge with existing

  // Clear all requests (be careful!)
  // RequestStorage.clearAll();
}
