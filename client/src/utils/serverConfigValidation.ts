import {
  ServerConfig,
  StdioServerConfig,
  HttpServerConfig,
  StdioConfig,
  HttpConfig,
} from "../components/multiserver/types/multiserver";

/**
 * Type guard to check if a server config is a valid StdioServerConfig
 */
export function isStdioServerConfig(
  server: ServerConfig,
): server is StdioServerConfig {
  if (server.transportType !== "stdio") {
    return false;
  }

  // Check if config is nested under server.config
  if (
    server.config &&
    "command" in server.config &&
    typeof server.config.command === "string" &&
    server.config.command.trim() !== ""
  ) {
    return true;
  }

  // Check if config properties are directly on the server object (backend format)
  if (
    "command" in server &&
    typeof (server as any).command === "string" &&
    (server as any).command.trim() !== ""
  ) {
    return true;
  }

  return false;
}

/**
 * Type guard to check if a server config is a valid HttpServerConfig
 */
export function isHttpServerConfig(
  server: ServerConfig,
): server is HttpServerConfig {
  if (server.transportType !== "streamable-http") {
    return false;
  }

  // Check if config is nested under server.config
  if (
    server.config &&
    "url" in server.config &&
    typeof server.config.url === "string" &&
    server.config.url.trim() !== ""
  ) {
    return true;
  }

  // Check if config properties are directly on the server object (backend format)
  if (
    "url" in server &&
    typeof (server as any).url === "string" &&
    (server as any).url.trim() !== ""
  ) {
    return true;
  }

  return false;
}

/**
 * Safely get the command from a stdio server config
 */
export function getStdioCommand(server: ServerConfig): string | null {
  if (!isStdioServerConfig(server)) {
    return null;
  }

  // Check if config is nested under server.config
  if (server.config && "command" in server.config) {
    return server.config.command;
  }

  // Check if config properties are directly on the server object (backend format)
  if ("command" in server) {
    return (server as any).command;
  }

  return null;
}

/**
 * Safely get the URL from an HTTP server config
 */
export function getHttpUrl(server: ServerConfig): string | null {
  if (!isHttpServerConfig(server)) {
    return null;
  }

  // Check if config is nested under server.config
  if (server.config && "url" in server.config) {
    return server.config.url;
  }

  // Check if config properties are directly on the server object (backend format)
  if ("url" in server) {
    return (server as any).url;
  }

  return null;
}

/**
 * Safely get any config property with type safety
 */
export function safeGetConfigProperty<T>(
  server: ServerConfig,
  property: string,
): T | null {
  if (!server || typeof server !== "object") {
    return null;
  }

  // First check if config is nested under server.config
  if (server.config && typeof server.config === "object") {
    const config = server.config as any;
    if (config[property] !== undefined) {
      return config[property];
    }
  }

  // Then check if config properties are directly on the server object (backend format)
  const serverAny = server as any;
  if (serverAny[property] !== undefined) {
    return serverAny[property];
  }

  return null;
}

/**
 * Create a default stdio configuration
 */
export function createDefaultStdioConfig(): StdioConfig {
  return {
    command: "",
    args: [],
    env: {},
  };
}

/**
 * Create a default HTTP configuration
 */
export function createDefaultHttpConfig(): HttpConfig {
  return {
    url: "",
    headers: {},
    bearerToken: undefined,
    headerName: undefined,
    oauthClientId: undefined,
    oauthScope: undefined,
  };
}

/**
 * Validate and sanitize a server config object
 */
export function validateServerConfig(config: any): ServerConfig | null {
  if (!config || typeof config !== "object") {
    return null;
  }

  // Check required fields
  if (!config.id || !config.name || !config.transportType) {
    return null;
  }

  // Validate transport type
  if (
    config.transportType !== "stdio" &&
    config.transportType !== "streamable-http"
  ) {
    return null;
  }

  // Ensure config property exists
  if (!config.config) {
    // Create default config based on transport type
    if (config.transportType === "stdio") {
      config.config = createDefaultStdioConfig();
    } else {
      config.config = createDefaultHttpConfig();
    }
  }

  // Validate stdio config
  if (config.transportType === "stdio") {
    if (!config.config.command || typeof config.config.command !== "string") {
      config.config.command = "";
    }
    if (!Array.isArray(config.config.args)) {
      config.config.args = [];
    }
    if (!config.config.env || typeof config.config.env !== "object") {
      config.config.env = {};
    }
  }

  // Validate HTTP config
  if (config.transportType === "streamable-http") {
    if (!config.config.url || typeof config.config.url !== "string") {
      config.config.url = "";
    }
    if (config.config.headers && typeof config.config.headers !== "object") {
      config.config.headers = {};
    }
  }

  // Ensure dates are properly formatted
  if (config.createdAt && !(config.createdAt instanceof Date)) {
    config.createdAt = new Date(config.createdAt);
  }
  if (config.updatedAt && !(config.updatedAt instanceof Date)) {
    config.updatedAt = new Date(config.updatedAt);
  }

  return config as ServerConfig;
}

/**
 * Check if a server config has a valid configuration
 */
export function hasValidConfig(server: ServerConfig): boolean {
  if (server.transportType === "stdio") {
    return isStdioServerConfig(server);
  }

  if (server.transportType === "streamable-http") {
    return isHttpServerConfig(server);
  }

  return false;
}

/**
 * Get a display-friendly config summary
 */
export function getConfigSummary(server: ServerConfig): string {
  if (server.transportType === "stdio") {
    const command = getStdioCommand(server);
    return command || "No command configured";
  }

  if (server.transportType === "streamable-http") {
    const url = getHttpUrl(server);
    return url || "No URL configured";
  }

  return "Invalid configuration";
}
