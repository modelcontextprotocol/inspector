import { readFileSync } from "fs";
import { resolve } from "path";
import type {
  MCPConfig,
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "./types.js";

/**
 * Loads and validates an MCP servers configuration file
 * @param configPath - Path to the config file (relative to process.cwd() or absolute)
 * @returns The parsed MCPConfig
 * @throws Error if the file cannot be loaded, parsed, or is invalid
 */
export function loadMcpServersConfig(configPath: string): MCPConfig {
  try {
    const resolvedPath = resolve(process.cwd(), configPath);
    const configContent = readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(configContent) as MCPConfig;

    if (!config.mcpServers) {
      throw new Error("Configuration file must contain an mcpServers element");
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Error loading configuration: ${error.message}`);
    }
    throw new Error("Error loading configuration: Unknown error");
  }
}

/**
 * Converts CLI arguments to MCPServerConfig format
 * @param args - CLI arguments object
 * @returns MCPServerConfig suitable for creating an InspectorClient
 */
export function argsToMcpServerConfig(args: {
  command?: string;
  args?: string[];
  envArgs?: Record<string, string>;
  transport?: "stdio" | "sse" | "streamable-http";
  serverUrl?: string;
  headers?: Record<string, string>;
}): MCPServerConfig {
  // If serverUrl is provided, it's an HTTP-based transport
  if (args.serverUrl) {
    const url = new URL(args.serverUrl);

    // Determine transport type
    let transportType: "sse" | "streamableHttp";
    if (args.transport) {
      // Map "streamable-http" to "streamableHttp"
      if (args.transport === "streamable-http") {
        transportType = "streamableHttp";
      } else if (args.transport === "sse") {
        transportType = "sse";
      } else {
        // Default to SSE for URLs if transport is not recognized
        transportType = "sse";
      }
    } else {
      // Auto-detect from URL path
      if (url.pathname.endsWith("/mcp")) {
        transportType = "streamableHttp";
      } else {
        transportType = "sse";
      }
    }

    if (transportType === "sse") {
      const config: SseServerConfig = {
        type: "sse",
        url: args.serverUrl,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    } else {
      const config: StreamableHttpServerConfig = {
        type: "streamableHttp",
        url: args.serverUrl,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    }
  }

  // Otherwise, it's a stdio transport
  if (!args.command) {
    throw new Error("Command is required for stdio transport");
  }

  const config: StdioServerConfig = {
    type: "stdio",
    command: args.command,
  };

  if (args.args && args.args.length > 0) {
    config.args = args.args;
  }

  if (args.envArgs && Object.keys(args.envArgs).length > 0) {
    config.env = args.envArgs;
  }

  return config;
}
