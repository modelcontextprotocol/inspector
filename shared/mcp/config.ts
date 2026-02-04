import { readFileSync } from "fs";
import { resolve } from "path";
import type {
  MCPConfig,
  MCPServerConfig,
  ServerType,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "./types.js";

/**
 * Returns the transport type for an MCP server configuration.
 * If type is omitted, defaults to "stdio". Throws if type is invalid.
 */
export function getServerType(config: MCPServerConfig): ServerType {
  if (!("type" in config) || config.type === undefined) {
    return "stdio";
  }
  const type = config.type;
  if (type === "stdio") {
    return "stdio";
  }
  if (type === "sse") {
    return "sse";
  }
  if (type === "streamable-http") {
    return "streamable-http";
  }
  throw new Error(
    `Invalid server type: ${type}. Valid types are: stdio, sse, streamable-http`,
  );
}

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
 * Converts CLI arguments to MCPServerConfig format.
 * Handles all CLI-specific logic including:
 * - Detecting if target is a URL or command
 * - Validating transport/URL combinations
 * - Auto-detecting transport type from URL path
 * - Converting CLI's "http" transport to "streamable-http"
 *
 * @param args - CLI arguments object with target (URL or command), transport, and headers
 * @returns MCPServerConfig suitable for creating an InspectorClient
 * @throws Error if arguments are invalid (e.g., args with URLs, stdio with URLs, etc.)
 */
export function argsToMcpServerConfig(args: {
  target: string[];
  transport?: "sse" | "stdio" | "http";
  headers?: Record<string, string>;
  env?: Record<string, string>;
}): MCPServerConfig {
  if (args.target.length === 0) {
    throw new Error(
      "Target is required. Specify a URL or a command to execute.",
    );
  }

  const [firstTarget, ...targetArgs] = args.target;

  if (!firstTarget) {
    throw new Error("Target is required.");
  }

  const isUrl =
    firstTarget.startsWith("http://") || firstTarget.startsWith("https://");

  // Validation: URLs cannot have additional arguments
  if (isUrl && targetArgs.length > 0) {
    throw new Error("Arguments cannot be passed to a URL-based MCP server.");
  }

  // Validation: Transport/URL combinations
  if (args.transport) {
    if (!isUrl && args.transport !== "stdio") {
      throw new Error("Only stdio transport can be used with local commands.");
    }
    if (isUrl && args.transport === "stdio") {
      throw new Error("stdio transport cannot be used with URLs.");
    }
  }

  // Handle URL-based transports (SSE or streamable-http)
  if (isUrl) {
    const url = new URL(firstTarget);

    // Determine transport type
    let transportType: "sse" | "streamable-http";
    if (args.transport) {
      // Convert CLI's "http" to "streamable-http"
      if (args.transport === "http") {
        transportType = "streamable-http";
      } else if (args.transport === "sse") {
        transportType = "sse";
      } else {
        // Should not happen due to validation above, but default to SSE
        transportType = "sse";
      }
    } else {
      // Auto-detect from URL path
      if (url.pathname.endsWith("/mcp")) {
        transportType = "streamable-http";
      } else if (url.pathname.endsWith("/sse")) {
        transportType = "sse";
      } else {
        // Default to SSE if path doesn't match known patterns
        transportType = "sse";
      }
    }

    // Create SSE or streamable-http config
    if (transportType === "sse") {
      const config: SseServerConfig = {
        type: "sse",
        url: firstTarget,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    } else {
      const config: StreamableHttpServerConfig = {
        type: "streamable-http",
        url: firstTarget,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    }
  }

  // Handle stdio transport (command-based)
  const config: StdioServerConfig = {
    type: "stdio",
    command: firstTarget,
  };

  if (targetArgs.length > 0) {
    config.args = targetArgs;
  }

  if (args.env && Object.keys(args.env).length > 0) {
    config.env = args.env;
  }

  return config;
}
