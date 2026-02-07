import type { MCPServerConfig } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import type { CustomHeaders } from "../types/customHeaders";
import { headersToRecord } from "../types/customHeaders";

/**
 * Converts web client configuration format to MCPServerConfig format.
 * This adapter bridges the gap between the web app's UI state and the
 * InspectorClient's expected configuration format.
 *
 * @param transportType - Transport type: "stdio", "sse", or "streamable-http"
 * @param command - Command to execute (required for stdio transport)
 * @param args - Space-separated arguments string (optional, for stdio)
 * @param sseUrl - Server URL (required for sse/streamable-http transports)
 * @param env - Environment variables (optional, for stdio)
 * @param customHeaders - Custom headers array (optional, for sse/streamable-http)
 * @returns MCPServerConfig suitable for creating an InspectorClient
 * @throws Error if required parameters are missing for the transport type
 */
export function webConfigToMcpServerConfig(
  transportType: "stdio" | "sse" | "streamable-http",
  command?: string,
  args?: string,
  sseUrl?: string,
  env?: Record<string, string>,
  customHeaders?: CustomHeaders,
): MCPServerConfig {
  switch (transportType) {
    case "stdio": {
      if (!command) {
        throw new Error("Command is required for stdio transport");
      }
      const config: MCPServerConfig = {
        type: "stdio",
        command,
      };
      if (args?.trim()) {
        config.args = args.split(/\s+/).filter((arg) => arg.length > 0);
      }
      if (env && Object.keys(env).length > 0) {
        config.env = env;
      }
      return config;
    }
    case "sse": {
      if (!sseUrl) {
        throw new Error("SSE URL is required for SSE transport");
      }
      const headers = customHeaders
        ? headersToRecord(customHeaders)
        : undefined;
      const config: MCPServerConfig = {
        type: "sse",
        url: sseUrl,
      };
      if (headers && Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      return config;
    }
    case "streamable-http": {
      if (!sseUrl) {
        throw new Error("Server URL is required for streamable-http transport");
      }
      const headers = customHeaders
        ? headersToRecord(customHeaders)
        : undefined;
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: sseUrl,
      };
      if (headers && Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      return config;
    }
  }
}
