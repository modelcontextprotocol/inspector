import type { MCPServerConfig, ServerType } from "./types.js";

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

/** OAuth and enterprise-managed auth apply only to remote HTTP-based transports. */
export function isOAuthCapableServerType(type: ServerType): boolean {
  return type === "sse" || type === "streamable-http";
}

/**
 * MCP server URL used as the OAuth storage key (includes path, for discovery).
 * Undefined for stdio transports.
 */
export function getOAuthServerUrl(config: MCPServerConfig): string | undefined {
  if (config.type === "sse" || config.type === "streamable-http") {
    return config.url;
  }
  return undefined;
}
