import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { getDefaultMcpConfigPath } from "../../storage/store-io.js";
import type {
  MCPConfig,
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "../types.js";
import { normalizeServerType } from "../serverList.js";

/**
 * Options object passed to resolveServerConfigs by runners (parsed from argv).
 * Core exports this type so runners can type the subset they pass in.
 */
export interface ServerConfigOptions {
  /**
   * Writable catalog file (`--catalog` / `MCP_CATALOG_PATH`): seeded as an empty
   * catalog if it doesn't exist, then served. This is the slot the no-flag
   * default (`~/.mcp-inspector/mcp.json`) fills. Wins over `configPath`.
   */
  catalogPath?: string;
  /**
   * Read-only session file (`--config`): served as-is and never written, seeded,
   * or migrated. Errors if absent (so a typo'd path is a clear error, not a
   * silently empty list). Used when `catalogPath` is unset.
   */
  configPath?: string;
  serverName?: string;
  /** Command + args for stdio, or [url] for SSE/HTTP. Positional / args after -- */
  target?: string[];
  transport?: "stdio" | "sse" | "http";
  serverUrl?: string;
  cwd?: string;
  env?: Record<string, string>;
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
 * Write an empty catalog (`{ "mcpServers": {} }`) to `resolvedPath`, creating
 * parent directories. Seeds a writable catalog on first run so CLI/TUI match
 * the web backend instead of erroring on a missing default file.
 */
function seedEmptyCatalog(resolvedPath: string): void {
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(
    resolvedPath,
    `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Read the raw contents of a server-list file. A missing *writable* catalog is
 * seeded as an empty catalog and its contents returned; a missing *read-only*
 * config throws so a typo'd path is a clear error, not a silently empty list.
 */
function readServerListContent(configPath: string, writable: boolean): string {
  const resolvedPath = resolve(process.cwd(), configPath);
  if (!existsSync(resolvedPath)) {
    if (writable) {
      seedEmptyCatalog(resolvedPath);
      return JSON.stringify({ mcpServers: {} });
    }
    throw new Error(`Config file not found: ${resolvedPath}`);
  }
  return readFileSync(resolvedPath, "utf-8");
}

/**
 * Loads and validates an MCP servers configuration file.
 * Seeds an empty catalog when `writable` and the file is missing; otherwise a
 * missing file throws. Normalizes each server's type (missing → "stdio",
 * "http" → "streamable-http").
 *
 * @param configPath - Path to the config file (relative to process.cwd() or absolute)
 * @param writable - true for a `--catalog`/default source (seed-if-missing); false for `--config` (error-if-missing)
 * @returns The parsed MCPConfig with normalized server types
 * @throws Error if a read-only file is missing, or any file cannot be loaded, parsed, or is invalid
 */
function loadMcpServersConfig(
  configPath: string,
  writable: boolean,
): MCPConfig {
  try {
    const configContent = readServerListContent(configPath, writable);
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
  writable: boolean,
): MCPServerConfig {
  const config = loadMcpServersConfig(configPath, writable);
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
      return config;
    }
    const config: StreamableHttpServerConfig = { type: "streamable-http", url };
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

/** Apply env/cwd overrides to a stdio config. SSE / streamable-http configs
 * carry no overridable per-request fields here — custom headers live in
 * `InspectorServerSettings.headers` (the persisted per-server settings node),
 * not on `MCPServerConfig`. */
function applyOverrides(
  config: MCPServerConfig,
  overrides: {
    env?: Record<string, string>;
    cwd?: string;
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
  return config;
}

export type ResolveServerConfigsMode = "single" | "multi";

export function hasAdHocServerOptions(options: ServerConfigOptions): boolean {
  return (
    (options.target != null && options.target.length > 0) ||
    Boolean(options.transport) ||
    Boolean(options.serverUrl?.trim())
  );
}

/**
 * Identify the active server-list source and whether it's writable.
 * `--catalog` (writable: seeded if missing) wins over `--config` (read-only:
 * served as-is, never seeded/written). Returns null when neither is set
 * (ad-hoc / no source).
 */
export function resolveServerSource(
  options: ServerConfigOptions,
): { path: string; writable: boolean } | null {
  if (options.catalogPath?.trim()) {
    return { path: options.catalogPath, writable: true };
  }
  if (options.configPath?.trim()) {
    return { path: options.configPath, writable: false };
  }
  return null;
}

export interface ServerSourceFlags {
  hasCatalog: boolean;
  hasConfig: boolean;
  hasAdHoc: boolean;
}

/**
 * Validate the `--catalog` / `--config` / ad-hoc combination shared by all
 * runners (mirrors the web `run-web` conflict matrix). Returns an error message
 * for an illegal combination, or null when the flags are coherent.
 */
export function serverSourceConflict(flags: ServerSourceFlags): string | null {
  if (flags.hasCatalog && flags.hasConfig) {
    return "--catalog and --config are mutually exclusive. --catalog is the writable catalog; --config is a read-only session file.";
  }
  if (flags.hasCatalog && flags.hasAdHoc) {
    return "--catalog cannot be combined with an ad-hoc server URL/command.";
  }
  if (flags.hasConfig && flags.hasAdHoc) {
    return "--config cannot be combined with an ad-hoc server URL/command. --config selects a read-only session file.";
  }
  return null;
}

/**
 * Public catalog/config loader for runners that need the raw server map (e.g.
 * the TUI, which derives per-server settings via `mcpConfigToServerEntries`).
 * Applies the same seed-if-writable / error-if-read-only semantics as
 * `resolveServerConfigs`; server `type` fields are normalized.
 */
export function readServerListFile(
  configPath: string,
  writable: boolean,
): MCPConfig {
  return loadMcpServersConfig(configPath, writable);
}

/**
 * When no `--catalog`, no `--config`, and no ad-hoc target is given, default the
 * writable catalog to ~/.mcp-inspector/mcp.json (the same file the web backend
 * uses). Fills the *catalog* (writable, seed-if-missing) slot — not `--config`.
 */
export function withDefaultCatalogPath(
  options: ServerConfigOptions,
): ServerConfigOptions {
  if (
    options.catalogPath?.trim() ||
    options.configPath?.trim() ||
    hasAdHocServerOptions(options)
  ) {
    return options;
  }
  return { ...options, catalogPath: getDefaultMcpConfigPath() };
}

/**
 * Resolves server config(s) from explicit options and mode.
 * Single mode: one config (from file + overrides, or from args).
 * Multi mode: all servers from file (with optional env/cwd/headers overrides), or one from args; errors if config path + transport/serverUrl/positional.
 */
export function resolveServerConfigs(
  options: ServerConfigOptions,
  mode: ResolveServerConfigsMode,
): MCPServerConfig[] {
  const source = resolveServerSource(options);
  const hasAdHoc = hasAdHocServerOptions(options);

  if (mode === "single") {
    if (source && options.serverName) {
      const config = loadServerFromConfig(
        source.path,
        options.serverName,
        source.writable,
      );
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd,
        }),
      ];
    }
    if (source && !options.serverName) {
      const mcpConfig = loadMcpServersConfig(source.path, source.writable);
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
      const config = loadServerFromConfig(
        source.path,
        serverName,
        source.writable,
      );
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd,
        }),
      ];
    }
    return [buildConfigFromOptions(options)];
  }

  if (mode === "multi") {
    if (source && hasAdHoc) {
      throw new Error(
        "In multi-server mode with a config file, do not pass --transport, --server-url, or positional command/URL. Use only --config with optional -e, --cwd.",
      );
    }
    if (source) {
      const mcpConfig = loadMcpServersConfig(source.path, source.writable);
      const configs = Object.values(mcpConfig.mcpServers).map((c) =>
        applyOverrides({ ...c } as MCPServerConfig, {
          env: options.env,
          cwd: options.cwd,
        }),
      );
      return configs;
    }
    return [buildConfigFromOptions(options)];
  }

  return [];
}

/**
 * Launch-time resolver for CLI/TUI: applies the default writable catalog path
 * when no `--catalog`, `--config`, or ad-hoc target is given, then delegates to
 * `resolveServerConfigs`.
 */
export function resolveLaunchServerConfigs(
  options: ServerConfigOptions,
  mode: ResolveServerConfigsMode,
): MCPServerConfig[] {
  return resolveServerConfigs(withDefaultCatalogPath(options), mode);
}

/**
 * Returns named server configs from a catalog/config file (multi-server). Use
 * when the caller needs server names. Resolves the active source via
 * `resolveServerSource` (a writable `--catalog` is seeded if missing; a
 * read-only `--config` errors if absent). Errors if neither source is set or if
 * ad-hoc options (target, transport, serverUrl) are also provided.
 */
export function getNamedServerConfigs(
  options: ServerConfigOptions,
): Record<string, MCPServerConfig> {
  const source = resolveServerSource(options);
  const hasAdHoc = hasAdHocServerOptions(options);

  if (!source) {
    throw new Error("Config path is required for getNamedServerConfigs.");
  }
  if (hasAdHoc) {
    throw new Error(
      "With a config file, do not pass --transport, --server-url, or positional command/URL. Use only --config with optional -e, --cwd.",
    );
  }

  const mcpConfig = loadMcpServersConfig(source.path, source.writable);
  const result: Record<string, MCPServerConfig> = {};
  for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
    result[name] = applyOverrides(
      { ...config },
      {
        env: options.env,
        cwd: options.cwd,
      },
    );
  }
  return result;
}
