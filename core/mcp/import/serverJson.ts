/**
 * Parser for the official MCP Registry `server.json` format (the file
 * `mcp-publisher init` generates and publishes). Distinct from the client-config
 * parsers: a `server.json` describes a *single* server via one or more runnable
 * `packages` and/or `remotes`, and carries publish-time metadata
 * (`environmentVariables`, `packageArguments`, URL `variables`) that has to be
 * mapped onto a runnable Inspector `MCPServerConfig`.
 *
 * Pure + isomorphic (no Node deps). The web wiring layer (`useServerJsonImport`)
 * turns the parsed options into the props the dumb `ImportServerJsonPanel`
 * renders, then calls `buildServerConfig` once the user has filled in env vars.
 *
 * Schema reference: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
 * The published `server.json` file uses camelCase keys (`registryType`,
 * `runtimeHint`, `environmentVariables`, …); the registry REST API has
 * historically returned the same fields in snake_case. We read both so a blob
 * copied from either source imports cleanly.
 */
import type { MCPServerConfig, StdioServerConfig } from "../types.js";
import { validateStoreId } from "../../storage/store-id.js";

/** A registry package's environment-variable declaration. */
export interface ServerJsonEnvVar {
  name: string;
  description?: string;
  required: boolean;
  /** Declared default/value, pre-filled into the form when present. */
  default?: string;
  isSecret?: boolean;
}

/**
 * One runnable way to launch the server — either a package (npm/pypi/oci/nuget)
 * resolved to a stdio command, or a remote (streamable-http/sse) URL. The dumb
 * panel renders these as the package-selection radios; `buildServerConfig`
 * turns the chosen one + env overrides into the final config.
 */
export interface ServerJsonOption {
  /** Registry/transport label source: "npm" | "pypi" | "oci" | "nuget" | "streamable-http" | "sse". */
  registryType: string;
  /** Package identifier or remote URL — shown in the radio label. */
  identifier: string;
  /** The runtime/transport used to launch it (e.g. "npx", "uvx", "docker", "streamable-http"). */
  runtimeHint: string;
  /**
   * The runnable config with all statically-known values resolved (runtime
   * command, args, declared env defaults, URL variable defaults). Env vars the
   * user must supply are surfaced via `envVars` and merged in by
   * `buildServerConfig`.
   */
  baseConfig: MCPServerConfig;
  /** Env vars declared for this option (empty for remotes). */
  envVars: ServerJsonEnvVar[];
}

export interface ParsedServerJson {
  /** Sanitized default server id, derived from the last segment of `name`. */
  serverName: string;
  /** The full registry name (e.g. "io.github.foo/weather"). */
  fullName: string;
  /** Runnable launch options, packages first then remotes. */
  options: ServerJsonOption[];
}

/** Read a field by its camelCase or snake_case key. */
function pick(
  obj: Record<string, unknown>,
  camel: string,
  snake: string,
): unknown {
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Derive a safe Inspector server id from a registry name. The registry name is
 * a reverse-DNS-ish string ("io.github.user/weather"); we take the segment
 * after the last "/" and strip anything outside `[A-Za-z0-9_-]`. Falls back to
 * "server" when nothing usable remains.
 */
export function deriveServerId(fullName: string): string {
  const lastSegment = fullName.split("/").pop() ?? fullName;
  const cleaned = lastSegment
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "server";
}

/** Parse an `environmentVariables` array into our env-var descriptors. */
function parseEnvVars(rawList: unknown[]): ServerJsonEnvVar[] {
  const out: ServerJsonEnvVar[] = [];
  for (const entry of rawList) {
    const obj = asObject(entry);
    if (!obj) continue;
    const name = asString(obj.name);
    if (!name) continue;
    const required = Boolean(pick(obj, "isRequired", "is_required"));
    const isSecret = Boolean(pick(obj, "isSecret", "is_secret"));
    // The schema's `value` is a *fixed* value and `default` a suggestion; we
    // prefill both as the (editable) input value. We don't currently lock a
    // fixed `value` against editing — acceptable for an import preview the user
    // reviews before saving.
    const def = asString(obj.default) ?? asString(obj.value);
    out.push({
      name,
      description: asString(obj.description),
      required,
      ...(def !== undefined ? { default: def } : {}),
      ...(isSecret ? { isSecret: true } : {}),
    });
  }
  return out;
}

/**
 * Resolve a registry `Argument` list (positional/named) into argv strings.
 * Best-effort: positional args contribute their `value`/`default`; named args
 * contribute their flag `name` plus any `value`/`default`. Arguments with
 * neither a value nor a default are skipped (the user can add them via the edit
 * form afterward); advanced features (`isRepeated`, `variables`) are ignored.
 */
function resolveArguments(rawList: unknown[]): string[] {
  const out: string[] = [];
  for (const entry of rawList) {
    const obj = asObject(entry);
    if (!obj) continue;
    const type = asString(obj.type) ?? "positional";
    const value = asString(obj.value) ?? asString(obj.default);
    if (type === "named") {
      const name = asString(obj.name);
      if (!name) continue;
      out.push(name);
      if (value !== undefined) out.push(value);
    } else {
      if (value !== undefined) out.push(value);
    }
  }
  return out;
}

/** Build the env map for a package: declared defaults only (overrides applied later). */
function defaultEnv(envVars: ServerJsonEnvVar[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const v of envVars) {
    if (v.default !== undefined) env[v.name] = v.default;
  }
  return env;
}

/** runtime command + base args for a given registry package type, or null if unsupported. */
function runtimeForPackage(
  registryType: string,
  identifier: string,
  version: string | undefined,
): { command: string; runtimeHint: string; ref: string } | null {
  const versioned = (sep: string) =>
    version ? `${identifier}${sep}${version}` : identifier;
  switch (registryType) {
    case "npm":
      return { command: "npx", runtimeHint: "npx", ref: versioned("@") };
    case "pypi":
      return { command: "uvx", runtimeHint: "uvx", ref: identifier };
    case "oci":
      return { command: "docker", runtimeHint: "docker", ref: identifier };
    case "nuget":
      return { command: "dnx", runtimeHint: "dnx", ref: versioned("@") };
    // mcpb artifacts are downloadable bundles, not a runnable command — skip.
    default:
      return null;
  }
}

/** Map a single `packages[]` entry to a launch option, or null if unsupported. */
function parsePackage(raw: Record<string, unknown>): ServerJsonOption | null {
  const registryType =
    asString(pick(raw, "registryType", "registry_type")) ?? "";
  const identifier = asString(raw.identifier) ?? "";
  if (!registryType || !identifier) return null;
  const version = asString(raw.version);
  const runtime = runtimeForPackage(registryType, identifier, version);
  if (!runtime) return null;

  const envVars = parseEnvVars(
    asArray(pick(raw, "environmentVariables", "environment_variables")),
  );
  const runtimeArgs = resolveArguments(
    asArray(pick(raw, "runtimeArguments", "runtime_arguments")),
  );
  const packageArgs = resolveArguments(
    asArray(pick(raw, "packageArguments", "package_arguments")),
  );

  const env = defaultEnv(envVars);

  // docker needs `run -i --rm` before the image; package args go to the
  // container after the image. Declared env vars must be forwarded into the
  // container with `-e KEY` flags — otherwise they'd only set the `docker` CLI
  // process's environment (via config.env) and never reach the server. `-e KEY`
  // (no value) tells docker to pass KEY through from that process env, which is
  // where buildServerConfig merges the user-supplied values. Other runtimes
  // inherit config.env directly, so they need no extra flags.
  const dockerEnvArgs = envVars.flatMap((v) => ["-e", v.name]);
  const args =
    runtime.command === "docker"
      ? [
          "run",
          "-i",
          "--rm",
          ...runtimeArgs,
          ...dockerEnvArgs,
          runtime.ref,
          ...packageArgs,
        ]
      : registryType === "npm"
        ? [...runtimeArgs, "-y", runtime.ref, ...packageArgs]
        : [...runtimeArgs, runtime.ref, ...packageArgs];

  const baseConfig: StdioServerConfig = {
    type: "stdio",
    command: runtime.command,
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
  return {
    registryType,
    identifier,
    runtimeHint: runtime.runtimeHint,
    baseConfig,
    envVars,
  };
}

/** Substitute `{var}` template tokens in a remote URL with their declared defaults. */
function resolveRemoteUrl(
  url: string,
  variables: Record<string, unknown> | undefined,
): string {
  if (!variables) return url;
  return url.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const v = asObject(variables[name]);
    const def = v ? asString(v.default) : undefined;
    return def ?? match;
  });
}

/** Map a single `remotes[]` entry to a launch option, or null if unsupported. */
function parseRemote(raw: Record<string, unknown>): ServerJsonOption | null {
  const type = asString(raw.type);
  const url = asString(raw.url);
  if (!url) return null;
  const transport = type === "sse" ? "sse" : "streamable-http";
  const resolvedUrl = resolveRemoteUrl(url, asObject(raw.variables));
  const baseConfig: MCPServerConfig =
    transport === "sse"
      ? { type: "sse", url: resolvedUrl }
      : { type: "streamable-http", url: resolvedUrl };
  // Label remotes as "remote" (the install method); the transport variant
  // (streamable-http / sse) is carried in runtimeHint so the picker shows
  // e.g. "remote: https://… (streamable-http)".
  return {
    registryType: "remote",
    identifier: resolvedUrl,
    runtimeHint: transport,
    baseConfig,
    envVars: [],
  };
}

/**
 * Parse a registry `server.json` blob into its runnable options. Accepts either
 * a bare server object or a `{ server: {...} }` wrapper (some registry API
 * responses nest it). Throws when the blob is not a server object or exposes no
 * runnable package/remote.
 */
export function parseServerJson(raw: string): ParsedServerJson {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON: ${detail}`);
  }
  const top = asObject(data);
  if (!top) throw new Error("Expected a JSON object at the top level");
  const server = asObject(top.server) ?? top;

  const fullName = asString(server.name);
  if (!fullName) {
    throw new Error("server.json is missing a 'name' field");
  }

  const options: ServerJsonOption[] = [];
  for (const pkg of asArray(server.packages)) {
    const obj = asObject(pkg);
    if (!obj) continue;
    const option = parsePackage(obj);
    if (option) options.push(option);
  }
  for (const remote of asArray(server.remotes)) {
    const obj = asObject(remote);
    if (!obj) continue;
    const option = parseRemote(obj);
    if (option) options.push(option);
  }

  if (options.length === 0) {
    throw new Error(
      "No runnable package or remote found in server.json (mcpb-only or unsupported registry types are not importable)",
    );
  }

  return {
    serverName: deriveServerId(fullName),
    fullName,
    options,
  };
}

/**
 * Build the final runnable config for a chosen option, merging user-supplied
 * env overrides over the declared defaults. Empty-string values are dropped so
 * an untouched required var doesn't persist as `KEY=""`. Remotes ignore env
 * overrides (their config carries no env).
 */
export function buildServerConfig(
  option: ServerJsonOption,
  envOverrides: Record<string, string>,
): MCPServerConfig {
  if (option.baseConfig.type !== "stdio") {
    return { ...option.baseConfig };
  }
  const merged: Record<string, string> = { ...(option.baseConfig.env ?? {}) };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === "") delete merged[key];
    else merged[key] = value;
  }
  // Drop the original `env` from the base (via destructure) so it isn't spread
  // back in; re-add it only when the merged map is non-empty. This keeps an
  // entry whose overrides emptied everything out from persisting a stale env.
  const { env: _baseEnv, ...base } = option.baseConfig;
  return {
    ...base,
    ...(Object.keys(merged).length > 0 ? { env: merged } : {}),
  };
}

/** The id a parsed server.json will be saved under: the override (if any) wins. */
export function resolveServerId(
  parsed: ParsedServerJson,
  idOverride?: string,
): string {
  const trimmed = (idOverride ?? "").trim();
  return trimmed || parsed.serverName;
}

/** The chosen launch option plus the resulting id and its validity. */
export interface ServerJsonSelection {
  selectedIndex: number;
  selectedOption: ServerJsonOption;
  serverId: string;
  idIsValid: boolean;
  idIsDuplicate: boolean;
}

/**
 * Resolve which option a parsed server.json will import as, the id it will use,
 * and whether that id is valid + free. Pure, so both the web wiring and a future
 * CLI/TUI import can share the selection logic. `selectedIndex` is clamped to the
 * available options.
 */
export function selectServerJsonOption(
  parsed: ParsedServerJson,
  opts: {
    selectedIndex?: number;
    idOverride?: string;
    existingIds?: readonly string[];
  } = {},
): ServerJsonSelection {
  const selectedIndex = Math.min(
    opts.selectedIndex ?? 0,
    Math.max(parsed.options.length - 1, 0),
  );
  const serverId = resolveServerId(parsed, opts.idOverride);
  return {
    selectedIndex,
    selectedOption: parsed.options[selectedIndex],
    serverId,
    idIsValid: validateStoreId(serverId),
    idIsDuplicate: (opts.existingIds ?? []).includes(serverId),
  };
}

/**
 * Merge the user's env overrides for the *selected* option only (env vars the
 * option doesn't declare are ignored) and build the runnable config.
 */
export function buildServerConfigForSelection(
  option: ServerJsonOption,
  envOverrides: Record<string, string>,
): MCPServerConfig {
  const overrides: Record<string, string> = {};
  for (const v of option.envVars) {
    const value = envOverrides[v.name];
    if (value !== undefined) overrides[v.name] = value;
  }
  return buildServerConfig(option, overrides);
}
