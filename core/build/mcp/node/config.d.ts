import type { MCPConfig, MCPServerConfig } from "../types.js";
/**
 * Loads and validates an MCP servers configuration file
 * @param configPath - Path to the config file (relative to process.cwd() or absolute)
 * @returns The parsed MCPConfig
 * @throws Error if the file cannot be loaded, parsed, or is invalid
 */
export declare function loadMcpServersConfig(configPath: string): MCPConfig;
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
export declare function argsToMcpServerConfig(args: {
    target: string[];
    transport?: "sse" | "stdio" | "http";
    headers?: Record<string, string>;
    env?: Record<string, string>;
}): MCPServerConfig;
//# sourceMappingURL=config.d.ts.map