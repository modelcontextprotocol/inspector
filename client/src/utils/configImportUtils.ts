import { MCPJamServerConfig } from "@/lib/serverTypes";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfigEntry>;
}

export interface MCPServerConfigEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: "sse" | "streamable-http";
  requestInit?: StreamableHTTPClientTransportOptions["requestInit"];
  eventSourceInit?: SSEClientTransportOptions["eventSourceInit"];
  reconnectionOptions?: StreamableHTTPClientTransportOptions["reconnectionOptions"];
  sessionId?: StreamableHTTPClientTransportOptions["sessionId"];
  timeout?: number;
  capabilities?: ClientCapabilities;
  enableServerLogs?: boolean;
}

export interface ParsedServerConfig {
  name: string;
  config: MCPJamServerConfig;
}

export interface ConfigImportResult {
  success: boolean;
  servers: ParsedServerConfig[];
  errors: string[];
}

/**
 * Validates if a string is valid JSON
 */
export function isValidJSON(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if the parsed JSON has the expected MCP config structure
 */
export function isValidMCPConfig(config: unknown): config is MCPConfigFile {
  return (
    typeof config === "object" &&
    config !== null &&
    "mcpServers" in config &&
    typeof (config as Record<string, unknown>).mcpServers === "object" &&
    (config as Record<string, unknown>).mcpServers !== null
  );
}

/**
 * Checks if the config is a single server configuration
 */
export function isValidServerConfig(
  config: unknown,
): config is MCPServerConfigEntry {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const configObj = config as Record<string, unknown>;

  // Must have either command or url
  const hasCommand =
    "command" in configObj && typeof configObj.command === "string";
  const hasUrl = "url" in configObj && typeof configObj.url === "string";

  return hasCommand || hasUrl;
}

/**
 * Checks if the config is a single named server configuration
 */
export function isSingleNamedServerConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const configObj = config as Record<string, unknown>;
  const keys = Object.keys(configObj);

  // Should have exactly one key, and that key should map to a valid server config
  if (keys.length !== 1) {
    return false;
  }

  const serverConfig = configObj[keys[0]];
  return isValidServerConfig(serverConfig);
}

/**
 * Provides detailed validation for MCP config structure
 */
export function validateMCPConfigStructure(config: unknown): {
  isGlobal: boolean;
  isSingleNamed: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof config !== "object" || config === null) {
    errors.push("Configuration must be a JSON object");
    return { isGlobal: false, isSingleNamed: false, errors };
  }

  // Check if it's a global config (has mcpServers)
  if (isValidMCPConfig(config)) {
    const mcpServers = (config as MCPConfigFile).mcpServers;
    const serverNames = Object.keys(mcpServers);

    if (serverNames.length === 0) {
      errors.push(
        '"mcpServers" object is empty. Please add at least one server configuration',
      );
    }

    return { isGlobal: true, isSingleNamed: false, errors };
  }

  // Check if it's a single named server config (e.g., {"servername": {"command": "..."}})
  if (isSingleNamedServerConfig(config)) {
    return { isGlobal: false, isSingleNamed: true, errors };
  }

  // Neither format is valid
  errors.push(
    "Invalid configuration format. Please provide either:\n" +
      '• A global config: {"mcpServers": {"server-name": {...}}}\n' +
      '• A named server config: {"server-name": {"command": "npx", "args": [...]}}',
  );

  return { isGlobal: false, isSingleNamed: false, errors };
}

/**
 * Converts a raw server config entry to MCPJamServerConfig
 */
export function convertToMCPJamServerConfig(
  entry: MCPServerConfigEntry,
): MCPJamServerConfig {
  // Determine transport type
  if (entry.command) {
    // STDIO configuration
    return {
      transportType: "stdio",
      command: entry.command,
      args: entry.args,
      env: entry.env,
      timeout: entry.timeout,
      capabilities: entry.capabilities,
      enableServerLogs: entry.enableServerLogs,
    };
  } else if (entry.url) {
    // HTTP configuration (SSE or Streamable HTTP)
    // Auto-detect SSE from URL if type is not specified
    let transportType: "sse" | "streamable-http";

    if (entry.type) {
      transportType = entry.type === "sse" ? "sse" : "streamable-http";
    } else {
      // Auto-detect: if URL contains "sse", use SSE, otherwise use streamable-http
      transportType = entry.url.toLowerCase().includes("sse")
        ? "sse"
        : "streamable-http";
    }

    return {
      transportType,
      url: new URL(entry.url),
      requestInit: entry.requestInit,
      eventSourceInit: entry.eventSourceInit,
      reconnectionOptions: entry.reconnectionOptions,
      sessionId: entry.sessionId,
      timeout: entry.timeout,
      capabilities: entry.capabilities,
      enableServerLogs: entry.enableServerLogs,
    };
  } else {
    throw new Error("Invalid server configuration: missing command or url");
  }
}

/**
 * Validates a single server configuration entry
 */
export function validateServerConfig(
  name: string,
  entry: MCPServerConfigEntry,
): string[] {
  const errors: string[] = [];

  if (!entry.command && !entry.url) {
    errors.push(
      `Server "${name}": Must have either 'command' (for STDIO) or 'url' (for HTTP/SSE). ` +
        `Example: {"command": "npx", "args": ["server-package"]} or {"url": "https://...", "type": "sse"}`,
    );
  }

  if (entry.command && entry.url) {
    errors.push(
      `Server "${name}": Cannot have both 'command' and 'url'. ` +
        `Use 'command' for STDIO servers or 'url' for HTTP/SSE servers, but not both`,
    );
  }

  if (entry.command) {
    if (typeof entry.command !== "string" || entry.command.trim() === "") {
      errors.push(
        `Server "${name}": 'command' must be a non-empty string. ` +
          `Example: "npx", "node", "python", etc.`,
      );
    }

    if (entry.args && !Array.isArray(entry.args)) {
      errors.push(
        `Server "${name}": 'args' must be an array of strings. ` +
          `Example: ["@modelcontextprotocol/server-everything"] or ["build/index.js", "--port", "3000"]`,
      );
    }

    if (entry.env && typeof entry.env !== "object") {
      errors.push(
        `Server "${name}": 'env' must be an object with string keys and values. ` +
          `Example: {"API_KEY": "your-key", "DEBUG": "true"}`,
      );
    }
  }

  if (entry.url) {
    try {
      new URL(entry.url);
    } catch {
      errors.push(
        `Server "${name}": 'url' must be a valid URL. ` +
          `Example: "https://api.example.com/mcp" or "https://localhost:3000/sse"`,
      );
    }

    if (entry.type && !["sse", "streamable-http"].includes(entry.type)) {
      errors.push(
        `Server "${name}": 'type' must be either 'sse' or 'streamable-http'. ` +
          `If not specified, defaults to 'streamable-http'`,
      );
    }
  }

  return errors;
}

/**
 * Parses and validates an MCP configuration JSON string
 */
export function parseConfigFile(jsonString: string): ConfigImportResult {
  const result: ConfigImportResult = {
    success: false,
    servers: [],
    errors: [],
  };

  // Validate JSON syntax
  if (!isValidJSON(jsonString)) {
    result.errors.push(
      "Invalid JSON format. Please check for missing quotes, commas, or brackets",
    );
    return result;
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(jsonString);
  } catch (error) {
    result.errors.push(
      `JSON parsing error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }

  // Validate config structure
  const {
    isGlobal,
    isSingleNamed,
    errors: structureErrors,
  } = validateMCPConfigStructure(parsedConfig);
  if (structureErrors.length > 0) {
    result.errors.push(...structureErrors);
    return result;
  }

  // Validate and convert servers
  const servers: ParsedServerConfig[] = [];
  const allErrors: string[] = [];

  if (isGlobal) {
    // Handle global config format
    const validConfig = parsedConfig as MCPConfigFile;

    for (const [serverName, serverConfig] of Object.entries(
      validConfig.mcpServers,
    )) {
      if (typeof serverName !== "string" || serverName.trim() === "") {
        allErrors.push("Server names must be non-empty strings");
        continue;
      }

      const validationErrors = validateServerConfig(serverName, serverConfig);
      if (validationErrors.length > 0) {
        allErrors.push(...validationErrors);
        continue;
      }

      try {
        const mcpConfig = convertToMCPJamServerConfig(serverConfig);
        servers.push({
          name: serverName,
          config: mcpConfig,
        });
      } catch (error) {
        allErrors.push(
          `Server "${serverName}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } else if (isSingleNamed) {
    // Handle single named server config format
    const serverConfig = parsedConfig as Record<string, MCPServerConfigEntry>;
    const serverName = Object.keys(serverConfig)[0];

    const validationErrors = validateServerConfig(
      serverName,
      serverConfig[serverName],
    );
    if (validationErrors.length > 0) {
      allErrors.push(...validationErrors);
    } else {
      try {
        const mcpConfig = convertToMCPJamServerConfig(serverConfig[serverName]);
        servers.push({
          name: serverName,
          config: mcpConfig,
        });
      } catch (error) {
        allErrors.push(
          `Server configuration: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  result.servers = servers;
  result.errors = allErrors;
  result.success = allErrors.length === 0 && servers.length > 0;

  return result;
}

/**
 * Generates example MCP configuration JSON
 */
export function generateExampleConfig(): string {
  const exampleConfig: MCPConfigFile = {
    mcpServers: {
      "example-stdio-server": {
        command: "npx",
        args: ["@modelcontextprotocol/server-everything"],
        env: {
          API_KEY: "your-api-key",
          DEBUG: "true",
        },
      },
      "example-sse-server": {
        url: "https://api.example.com/mcp/sse",
        type: "sse",
      },
      "example-http-server": {
        url: "https://api.example.com/mcp/http",
        type: "streamable-http",
      },
    },
  };

  return JSON.stringify(exampleConfig, null, 2);
}
