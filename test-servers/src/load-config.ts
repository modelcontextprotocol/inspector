/**
 * Config loader for composable test server
 * Reads JSON or YAML config files with format inferred from extension or --json/--yaml flag
 */

import { readFileSync } from "fs";
import path from "path";
import YAML from "yaml";

export interface PresetRef {
  preset: string;
  params?: Record<string, unknown>;
  /** OAuth scopes the bearer token must include to use this capability. */
  requiredScopes?: string[];
}

export interface ConfigFileOAuth {
  enabled: boolean;
  mode?: "combined" | "protected-resource";
  authorizationServers?: string[];
  resource?: string;
  issuerUrl?: string;
  accessTokenIssuers?: string[];
  jwksUri?: string;
  resourceAudience?: string;
  scopesSupported?: string[];
  requireAuth?: boolean;
  staticClients?: Array<{
    clientId: string;
    clientSecret?: string;
    redirectUris?: string[];
  }>;
  supportDCR?: boolean;
  supportCIMD?: boolean;
  tokenExpirationSeconds?: number;
  supportRefreshTokens?: boolean;
}

export interface ConfigFile {
  serverInfo: {
    name: string;
    version: string;
  };
  tools?: Array<PresetRef | PresetRef[]>;
  resources?: PresetRef[];
  resourceTemplates?: PresetRef[];
  prompts?: PresetRef[];
  logging?: boolean;
  listChanged?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  subscriptions?: boolean;
  tasks?: {
    list?: boolean;
    cancel?: boolean;
  };
  /** Advertise the modern (SEP-2663) `io.modelcontextprotocol/tasks` extension
   * and wire its handlers + `modern_task` / `modern_input_task` tools. Pair with
   * `transport.modern`. */
  tasksExtension?: boolean;
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  /**
   * Gate a tool's `tools/list` visibility on a client-declared extension. Maps
   * extension id → tool name; the tool appears only when the connected client
   * advertised that extension (#1739 / #1633). Legacy stateful leg only. See
   * {@link ServerConfig.extensionGatedTools}.
   */
  extensionGatedTools?: Record<string, string>;
  oauth?: ConfigFileOAuth;
  transport: {
    type: "stdio" | "streamable-http" | "sse";
    port?: number;
    /**
     * Serve the modern (2026-07-28) protocol era via the SDK's
     * `createMcpHandler` (only valid with `type: "streamable-http"`). `true`
     * is shorthand for dual-era stateless serving; the object form selects the
     * legacy-fallback posture. See {@link ServerConfig.modern}.
     */
    modern?:
      | boolean
      | { legacy?: "stateless" | "reject"; injectSpecErrors?: boolean };
  };
}

export type ConfigFormat = "json" | "yaml";

function inferFormatFromPath(filePath: string): ConfigFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  return null;
}

function parseContent(
  content: string,
  format: ConfigFormat,
  filePath: string,
): unknown {
  try {
    if (format === "json") {
      return JSON.parse(content);
    }
    return YAML.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config file ${filePath}: ${msg}`);
  }
}

function validateConfig(
  obj: unknown,
  filePath: string,
): asserts obj is ConfigFile {
  if (obj === null || typeof obj !== "object") {
    throw new Error(`Invalid config in ${filePath}: expected object`);
  }
  const o = obj as Record<string, unknown>;
  if (
    !o.serverInfo ||
    typeof o.serverInfo !== "object" ||
    typeof (o.serverInfo as Record<string, unknown>).name !== "string" ||
    typeof (o.serverInfo as Record<string, unknown>).version !== "string"
  ) {
    throw new Error(
      `Invalid config in ${filePath}: serverInfo.name and serverInfo.version are required`,
    );
  }
  if (
    !o.transport ||
    typeof o.transport !== "object" ||
    typeof (o.transport as Record<string, unknown>).type !== "string"
  ) {
    throw new Error(
      `Invalid config in ${filePath}: transport.type is required`,
    );
  }
  const transport = o.transport as Record<string, unknown>;
  const transportType = transport.type as string;
  if (!["stdio", "streamable-http", "sse"].includes(transportType)) {
    throw new Error(
      `Invalid config in ${filePath}: transport.type must be stdio, streamable-http, or sse`,
    );
  }
  // Only reject *enabling* modern on a non-HTTP transport; a falsy `modern`
  // (e.g. `false`) is a no-op that `resolveConfig` normalizes away.
  if (transport.modern && transportType !== "streamable-http") {
    throw new Error(
      `Invalid config in ${filePath}: transport.modern requires transport.type "streamable-http"`,
    );
  }

  if (o.oauth && typeof o.oauth === "object") {
    const oauth = o.oauth as Record<string, unknown>;
    if (oauth.enabled !== true) {
      throw new Error(
        `Invalid config in ${filePath}: oauth.enabled must be true when oauth is present`,
      );
    }
    const mode = oauth.mode;
    if (
      mode !== undefined &&
      mode !== "combined" &&
      mode !== "protected-resource"
    ) {
      throw new Error(
        `Invalid config in ${filePath}: oauth.mode must be combined or protected-resource`,
      );
    }
    if (mode === "protected-resource") {
      const servers = oauth.authorizationServers;
      if (!Array.isArray(servers) || servers.length === 0) {
        throw new Error(
          `Invalid config in ${filePath}: oauth.authorizationServers is required when oauth.mode is protected-resource`,
        );
      }
      for (const url of servers) {
        if (typeof url !== "string" || url.trim() === "") {
          throw new Error(
            `Invalid config in ${filePath}: oauth.authorizationServers must be non-empty URL strings`,
          );
        }
      }
    }
    if (transportType === "stdio" && oauth.enabled === true) {
      throw new Error(
        `Invalid config in ${filePath}: oauth requires streamable-http or sse transport`,
      );
    }
  }
}

/**
 * Load config from file. Format is inferred from extension unless overridden by format option.
 * Paths in config are resolved relative to cwd.
 */
export function loadConfig(
  filePath: string,
  options?: { format?: ConfigFormat },
): ConfigFile {
  const explicitFormat = options?.format;
  const inferredFormat = inferFormatFromPath(filePath);

  let format: ConfigFormat;
  if (explicitFormat) {
    format = explicitFormat;
  } else if (inferredFormat) {
    format = inferredFormat;
  } else {
    throw new Error(
      `Cannot infer config format from path ${filePath}. ` +
        `Use .json, .yaml, or .yml extension, or pass --json or --yaml flag`,
    );
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const content = readFileSync(resolvedPath, "utf-8");
  const parsed = parseContent(content, format, resolvedPath);
  validateConfig(parsed, resolvedPath);
  return parsed as ConfigFile;
}
