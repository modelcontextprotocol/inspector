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
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  transport: {
    type: "stdio" | "streamable-http" | "sse";
    port?: number;
  };
}

export type ConfigFormat = "json" | "yaml";

const VALID_EXTENSIONS = [".json", ".yaml", ".yml"];

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
  const transportType = (o.transport as Record<string, unknown>).type as string;
  if (!["stdio", "streamable-http", "sse"].includes(transportType)) {
    throw new Error(
      `Invalid config in ${filePath}: transport.type must be stdio, streamable-http, or sse`,
    );
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
