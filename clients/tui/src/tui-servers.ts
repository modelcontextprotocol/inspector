import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  MCPConfig,
  StdioServerConfig,
} from "@inspector/core/mcp/types.js";
import { DEFAULT_TASK_TTL_MS } from "@inspector/core/mcp/types.js";
import { mcpConfigToServerEntries } from "@inspector/core/mcp/serverList.js";
import {
  resolveServerConfigs,
  withDefaultConfigPath,
  type ServerConfigOptions,
} from "@inspector/core/mcp/node/config.js";

export type TuiServer = {
  config: MCPServerConfig;
  settings?: InspectorServerSettings;
};

export function headersToServerSettings(
  headers?: Record<string, string>,
): InspectorServerSettings | undefined {
  if (!headers || Object.keys(headers).length === 0) {
    return undefined;
  }
  return {
    headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
    metadata: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    autoRefreshOnListChanged: false,
    roots: [],
  };
}

function applyStdioOverrides(
  config: MCPServerConfig,
  overrides: { env?: Record<string, string>; cwd?: string },
): MCPServerConfig {
  if (config.type !== "stdio") return config;
  const c = { ...config } as StdioServerConfig;
  if (overrides.env && Object.keys(overrides.env).length > 0) {
    c.env = { ...(c.env ?? {}), ...overrides.env };
  }
  if (overrides.cwd?.trim()) {
    c.cwd = overrides.cwd.trim();
  }
  return c;
}

function mergeSettings(
  base: InspectorServerSettings | undefined,
  headers?: Record<string, string>,
): InspectorServerSettings | undefined {
  const fromHeaders = headersToServerSettings(headers);
  if (!fromHeaders) return base;
  if (!base) return fromHeaders;
  return { ...base, headers: fromHeaders.headers };
}

export function loadTuiServers(
  serverOptions: ServerConfigOptions & { headers?: Record<string, string> },
): Record<string, TuiServer> {
  serverOptions = withDefaultConfigPath(serverOptions);
  const hasConfigPath = Boolean(serverOptions.configPath?.trim());

  if (hasConfigPath) {
    const configPath = serverOptions.configPath!;
    const resolvedPath = resolve(process.cwd(), configPath);
    const config = JSON.parse(readFileSync(resolvedPath, "utf-8")) as MCPConfig;
    const entries = mcpConfigToServerEntries(config);
    const result: Record<string, TuiServer> = {};
    for (const entry of entries) {
      result[entry.name] = {
        config: applyStdioOverrides(entry.config, {
          env: serverOptions.env,
          cwd: serverOptions.cwd,
        }),
        settings: mergeSettings(entry.settings, serverOptions.headers),
      };
    }
    return result;
  }

  const configs = resolveServerConfigs(serverOptions, "multi");
  if (configs.length === 0) {
    throw new Error(
      "At least one server is required. Use --config <path> or ad-hoc target (command/URL).",
    );
  }
  return {
    default: {
      config: configs[0]!,
      settings: headersToServerSettings(serverOptions.headers),
    },
  };
}
