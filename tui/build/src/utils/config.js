import { readFileSync } from "fs";
import { resolve } from "path";
/**
 * Loads and validates an MCP servers configuration file
 * @param configPath - Path to the config file (relative to process.cwd() or absolute)
 * @returns The parsed MCPConfig
 * @throws Error if the file cannot be loaded, parsed, or is invalid
 */
export function loadMcpServersConfig(configPath) {
  try {
    const resolvedPath = resolve(process.cwd(), configPath);
    const configContent = readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(configContent);
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
