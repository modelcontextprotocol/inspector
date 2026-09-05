/**
 * Config loader for composable test server
 * Reads JSON or YAML config files with format inferred from extension or --json/--yaml flag
 */

import { readFileSync } from "fs";
import path from "path";
import YAML from "yaml";
import { isOriginRelativePath } from "./test-server-oauth.js";

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
  /** Serve RFC 9728 metadata from this path and advertise it on 401 (#2071). */
  resourceMetadataPath?: string;
  /** Serve RFC 8414 AS metadata from this path instead of the default (#2172). */
  asMetadataPath?: string;
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
  /** RFC 7009 revocation endpoint; default true (#2144). */
  supportRevocation?: boolean;
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
  /** Advertise the Skills extension (SEP-2640) and serve its fixture skills.
   * `directoryRead` advertises the `resources/directory/read` sub-option. */
  skills?: { directoryRead?: boolean };
  /** Advertise the MCP Apps `io.modelcontextprotocol/ui` extension with the nested
   * `elicitation` setting — the server half of app-rendered form elicitation
   * (#1854). Pair with the `app_choose_option` tool + `choose_option_app` resource. */
  appElicitation?: boolean;
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  /**
   * Names of registered tools to emit **twice** in `tools/list` (same `name`,
   * the second's title marked "(duplicate)") — the nonconforming-but-real shape
   * no preset can produce. See {@link ServerConfig.duplicateToolNames} (#1957).
   */
  duplicateToolNames?: string[];
  /**
   * Replace a registered tool's advertised `inputSchema`/`outputSchema` with a
   * raw JSON Schema document — the constructs a Zod-built preset cannot emit.
   * See {@link ServerConfig.rawToolSchemas} (#1005).
   */
  rawToolSchemas?: Record<
    string,
    { inputSchema?: unknown; outputSchema?: unknown }
  >;
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
      | {
          legacy?: "stateless" | "reject";
          injectSpecErrors?: boolean;
          neverAcknowledgeSubscriptions?: boolean | "after-first";
        };
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
    throw new Error(`Failed to parse config file ${filePath}: ${msg}`, {
      cause: err,
    });
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
    const metadataPath = oauth.resourceMetadataPath;
    if (metadataPath !== undefined && !isOriginRelativePath(metadataPath)) {
      throw new Error(
        `Invalid config in ${filePath}: oauth.resourceMetadataPath must be an origin-relative path (e.g. "/custom/protected-resource") — a value such as "//host/doc" would advertise a document the server does not serve`,
      );
    }
    const asPath = oauth.asMetadataPath;
    if (asPath !== undefined && !isOriginRelativePath(asPath)) {
      throw new Error(
        `Invalid config in ${filePath}: oauth.asMetadataPath must be an origin-relative path (e.g. "/.well-known/openid-configuration") — a value such as "//host/doc" would move the document off this server entirely`,
      );
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
