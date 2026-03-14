import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type {
  MCPConfig,
  MCPServerConfig,
  ServerType,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "../types.js";

/**
 * Options object passed to resolveServerConfigs by runners (parsed from argv).
 * Core exports this type so runners can type the subset they pass in.
 */
export interface ServerConfigOptions {
  configPath?: string;
  serverName?: string;
  /** Command + args for stdio, or [url] for SSE/HTTP. Positional / args after -- */
  target?: string[];
  transport?: "stdio" | "sse" | "http";
  serverUrl?: string;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Parse KEY=VALUE into a record. Used as Commander option coerce/accumulator for -e.
 * Pure function; no Commander dependency.
 */
export function parseKeyValuePair(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const parts = value.split("=");
  const key = parts[0] ?? "";
  const val = parts.slice(1).join("=");

  if (!key || val === undefined || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`,
    );
  }

  return { ...previous, [key]: val };
}

/**
 * Parse "HeaderName: Value" into a record. Used as Commander option coerce/accumulator for --header.
 * Pure function; no Commander dependency.
 */
export function parseHeaderPair(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const colonIndex = value.indexOf(":");

  if (colonIndex === -1) {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  const key = value.slice(0, colonIndex).trim();
  const val = value.slice(colonIndex + 1).trim();

  if (key === "" || val === "") {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  return { ...previous, [key]: val };
}

/**
 * Normalizes server type: missing → "stdio", "http" → "streamable-http".
 * Returns a new object; input may be parsed JSON with type omitted or "http".
 */
function normalizeServerType(
  config: Record<string, unknown> & { type?: string },
): MCPServerConfig {
  const type = config.type;
  const normalizedType: ServerType =
    type === undefined
      ? "stdio"
      : type === "http"
        ? "streamable-http"
        : (type as ServerType);
  return { ...config, type: normalizedType } as MCPServerConfig;
}

/**
 * Loads and validates an MCP servers configuration file.
 * Checks file existence before reading. Normalizes each server's type
 * (missing → "stdio", "http" → "streamable-http").
 *
 * @param configPath - Path to the config file (relative to process.cwd() or absolute)
 * @returns The parsed MCPConfig with normalized server types
 * @throws Error if the file is missing, cannot be loaded, parsed, or is invalid
 */
function loadMcpServersConfig(configPath: string): MCPConfig {
  try {
    const resolvedPath = resolve(process.cwd(), configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    const configContent = readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(configContent) as MCPConfig;

    if (!config.mcpServers) {
      throw new Error("Configuration file must contain an mcpServers element");
    }

    const normalizedServers: Record<string, MCPServerConfig> = {};
    for (const [name, raw] of Object.entries(config.mcpServers)) {
      normalizedServers[name] = normalizeServerType(
        raw as unknown as Record<string, unknown> & { type?: string },
      );
    }
    return { ...config, mcpServers: normalizedServers };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Error loading configuration: ${error.message}`);
    }
    throw new Error("Error loading configuration: Unknown error");
  }
}

/**
 * Loads a single server config from an MCP config file by name.
 * Delegates to loadMcpServersConfig (file existence and type normalization are done there).
 */
function loadServerFromConfig(
  configPath: string,
  serverName: string,
): MCPServerConfig {
  const config = loadMcpServersConfig(configPath);
  if (!config.mcpServers[serverName]) {
    const available = Object.keys(config.mcpServers).join(", ");
    throw new Error(
      `Server '${serverName}' not found in config file. Available servers: ${available}`,
    );
  }
  return config.mcpServers[serverName];
}

/** Build one MCPServerConfig from ad-hoc options (no config file). */
function buildConfigFromOptions(options: ServerConfigOptions): MCPServerConfig {
  const target = options.target ?? [];
  const first = target[0];
  const rest = target.slice(1);

  const urlFromTarget =
    first && (first.startsWith("http://") || first.startsWith("https://"))
      ? first
      : null;
  const url = urlFromTarget ?? options.serverUrl ?? null;

  if (url) {
    if (rest.length > 0 && urlFromTarget) {
      throw new Error("Arguments cannot be passed to a URL-based MCP server.");
    }
    let transportType: "sse" | "streamable-http";
    const t =
      options.transport === "http" ? "streamable-http" : options.transport;
    if (t === "sse" || t === "streamable-http") {
      transportType = t;
    } else {
      const u = new URL(url);
      if (u.pathname.endsWith("/mcp")) {
        transportType = "streamable-http";
      } else if (u.pathname.endsWith("/sse")) {
        transportType = "sse";
      } else {
        throw new Error(
          `Transport type not specified and could not be determined from URL: ${url}.`,
        );
      }
    }
    if (transportType === "sse") {
      const config: SseServerConfig = { type: "sse", url };
      if (options.headers && Object.keys(options.headers).length > 0) {
        config.headers = options.headers;
      }
      return config;
    }
    const config: StreamableHttpServerConfig = { type: "streamable-http", url };
    if (options.headers && Object.keys(options.headers).length > 0) {
      config.headers = options.headers;
    }
    return config;
  }

  if (target.length === 0 || !first) {
    throw new Error(
      "Target is required. Specify a URL or a command to execute.",
    );
  }

  if (options.transport && options.transport !== "stdio") {
    throw new Error("Only stdio transport can be used with local commands.");
  }

  const config: StdioServerConfig = { type: "stdio", command: first };
  if (rest.length > 0) config.args = rest;
  if (options.env && Object.keys(options.env).length > 0)
    config.env = options.env;
  if (options.cwd?.trim()) config.cwd = options.cwd.trim();
  return config;
}

/** Apply env/cwd overrides to a stdio config; headers to sse/streamable-http. */
function applyOverrides(
  config: MCPServerConfig,
  overrides: {
    env?: Record<string, string>;
    cwd?: string;
    headers?: Record<string, string>;
  },
): MCPServerConfig {
  if (config.type === "stdio") {
    const c = { ...config } as StdioServerConfig;
    if (overrides.env && Object.keys(overrides.env).length > 0) {
      c.env = { ...(c.env ?? {}), ...overrides.env };
    }
    if (overrides.cwd) c.cwd = overrides.cwd;
    return c;
  }
  if (config.type === "sse" || config.type === "streamable-http") {
    const c = { ...config };
    if (overrides.headers && Object.keys(overrides.headers).length > 0) {
      c.headers = { ...(c.headers ?? {}), ...overrides.headers };
    }
    return c;
  }
  return config;
}

export type ResolveServerConfigsMode = "single" | "multi";

/**
 * Resolves server config(s) from options and mode. Used by all runners.
 * Single mode: one config (from file + overrides, or from args).
 * Multi mode: all servers from file (with optional env/cwd/headers overrides), or one from args; errors if config path + transport/serverUrl/positional.
 */
export function resolveServerConfigs(
  options: ServerConfigOptions,
  mode: ResolveServerConfigsMode,
): MCPServerConfig[] {
  const hasConfigPath = Boolean(options.configPath?.trim());
  const hasAdHoc =
    (options.target && options.target.length > 0) ||
    Boolean(options.transport) ||
    Boolean(options.serverUrl);

  if (mode === "single") {
    if (hasConfigPath && options.serverName) {
      const config = loadServerFromConfig(
        options.configPath!,
        options.serverName,
      );
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd,
          headers: options.headers,
        }),
      ];
    }
    if (hasConfigPath && !options.serverName) {
      const configPath = options.configPath!;
      const mcpConfig = loadMcpServersConfig(configPath);
      const servers = Object.keys(mcpConfig.mcpServers);
      if (servers.length === 0)
        throw new Error("No servers found in config file");
      if (servers.length > 1) {
        throw new Error(
          `Multiple servers found in config file. Please specify one with --server. Available servers: ${servers.join(", ")}`,
        );
      }
      const serverName = servers[0];
      if (!serverName) throw new Error("No servers found in config file");
      const config = loadServerFromConfig(configPath, serverName);
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd,
          headers: options.headers,
        }),
      ];
    }
    return [buildConfigFromOptions(options)];
  }

  if (mode === "multi") {
    if (hasConfigPath && hasAdHoc) {
      throw new Error(
        "In multi-server mode with a config file, do not pass --transport, --server-url, or positional command/URL. Use only --config with optional -e, --cwd, --header.",
      );
    }
    if (hasConfigPath && options.configPath) {
      const configPath = options.configPath;
      const mcpConfig = loadMcpServersConfig(configPath);
      const configs = Object.values(mcpConfig.mcpServers).map((c) =>
        applyOverrides({ ...c } as MCPServerConfig, {
          env: options.env,
          cwd: options.cwd,
          headers: options.headers,
        }),
      );
      return configs;
    }
    return [buildConfigFromOptions(options)];
  }

  return [];
}

/**
 * Returns named server configs from a config file (multi-server). Use when the caller
 * needs server names (e.g. TUI). Errors if config path is missing or if ad-hoc options
 * (target, transport, serverUrl) are also provided.
 */
export function getNamedServerConfigs(
  options: ServerConfigOptions,
): Record<string, MCPServerConfig> {
  const hasConfigPath = Boolean(options.configPath?.trim());
  const hasAdHoc =
    (options.target && options.target.length > 0) ||
    Boolean(options.transport) ||
    Boolean(options.serverUrl);

  if (!hasConfigPath) {
    throw new Error("Config path is required for getNamedServerConfigs.");
  }
  if (hasAdHoc) {
    throw new Error(
      "With a config file, do not pass --transport, --server-url, or positional command/URL. Use only --config with optional -e, --cwd, --header.",
    );
  }

  const mcpConfig = loadMcpServersConfig(options.configPath!);
  const result: Record<string, MCPServerConfig> = {};
  for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
    result[name] = applyOverrides(
      { ...config },
      {
        env: options.env,
        cwd: options.cwd,
        headers: options.headers,
      },
    );
  }
  return result;
}
