import type { SecretStore } from "../../auth/node/secret-store.js";
import { defaultSecretStore } from "../../auth/node/secret-store-selection.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  ServerProtocolEra,
} from "../types.js";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "../types.js";
import { mcpConfigToServerEntries } from "../serverList.js";
import {
  applyOverrides,
  resolveServerConfigs,
  resolveServerSource,
  serverSourceConflict,
  readServerListFile,
  hasAdHocServerOptions,
  withDefaultCatalogPath,
  type ServerConfigOptions,
} from "./config.js";
import { rehydrateMcpConfigFromKeychain } from "./server-secrets.js";
import { getOwnEntry } from "../../storage/own-entry.js";

/**
 * A server resolved from a catalog/config file or an ad-hoc target, paired with
 * the per-server settings (headers, timeouts, OAuth, etc.) lifted from the file.
 * `config` is the SDK-facing transport config; `settings` is the v2
 * `InspectorServerSettings` model (post-#1358 top-level shape).
 */
export type ResolvedServer = {
  config: MCPServerConfig;
  settings?: InspectorServerSettings;
};

/** Loader options: the shared source flags plus a single `--header` set and an
 * optional `--protocol-era`, both broadcast into every resolved server's
 * settings. */
export type ServerLoadOptions = ServerConfigOptions & {
  headers?: Record<string, string>;
  /** `--protocol-era`: overrides the file's `protocolEra` (or the legacy
   * default) the way `--header` overrides its headers (#2208). */
  protocolEra?: ServerProtocolEra;
  /** `--skill-catalog-max-skills` / `--skill-catalog-max-bytes`: override the
   * file's per-server skills catalog budget the same way (#2420). */
  skillCatalogMaxSkills?: number;
  skillCatalogMaxBytes?: number;
  /** Test injection; defaults to the selected store (see
   * `secret-store-selection.ts`) for catalog/config loads. */
  secretStore?: SecretStore;
};

/**
 * Build an `InspectorServerSettings` carrying only `--header` overrides (all
 * other fields defaulted). Returns undefined when no headers are given so it can
 * be used as a no-op base in `mergeSettings`.
 */
export function headersToServerSettings(
  headers?: Record<string, string>,
): InspectorServerSettings | undefined {
  if (!headers || Object.keys(headers).length === 0) {
    return undefined;
  }
  return {
    ...defaultServerSettings(),
    headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
  };
}

/** A settings node with every field at its product default. */
function defaultServerSettings(): InspectorServerSettings {
  return {
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
    autoRefreshOnListChanged: false,
    paginatedLists: false,
    roots: [],
  };
}

/**
 * Overlay `--header` / `--protocol-era` / `--skill-catalog-max-*` onto the
 * settings lifted from the file (or onto nothing, for an ad-hoc target). Only
 * those fields are overridden — timeouts, OAuth, and the rest of the file's
 * settings are preserved. Returns `base` untouched when no such flag was given.
 */
function mergeSettings(
  base: InspectorServerSettings | undefined,
  overrides: Pick<
    ServerLoadOptions,
    "headers" | "protocolEra" | "skillCatalogMaxSkills" | "skillCatalogMaxBytes"
  >,
): InspectorServerSettings | undefined {
  let settings = base;
  const fromHeaders = headersToServerSettings(overrides.headers);
  if (fromHeaders) {
    settings = settings
      ? { ...settings, headers: fromHeaders.headers }
      : fromHeaders;
  }
  if (overrides.protocolEra) {
    settings = {
      ...(settings ?? defaultServerSettings()),
      protocolEra: overrides.protocolEra,
    };
  }
  if (overrides.skillCatalogMaxSkills !== undefined) {
    settings = {
      ...(settings ?? defaultServerSettings()),
      skillCatalogMaxSkills: overrides.skillCatalogMaxSkills,
    };
  }
  if (overrides.skillCatalogMaxBytes !== undefined) {
    settings = {
      ...(settings ?? defaultServerSettings()),
      skillCatalogMaxBytes: overrides.skillCatalogMaxBytes,
    };
  }
  return settings;
}

/**
 * Resolve every server from a catalog/config file (or a single ad-hoc target)
 * into `{ config, settings }`, lifting disk-level headers/timeouts/OAuth into
 * `InspectorServerSettings` via `mcpConfigToServerEntries`. Shared by the CLI
 * and TUI so both apply the same file→settings resolution (issue #1482).
 *
 * Applies the default writable catalog when no source/ad-hoc target is given,
 * enforces the `--catalog`/`--config`/ad-hoc conflict matrix, and seeds an empty
 * writable catalog on first run (a missing read-only `--config` still errors).
 */
export async function loadServerEntries(
  serverOptions: ServerLoadOptions,
): Promise<Record<string, ResolvedServer>> {
  serverOptions = withDefaultCatalogPath(serverOptions);

  const conflict = serverSourceConflict({
    hasCatalog: Boolean(serverOptions.catalogPath?.trim()),
    hasConfig: Boolean(serverOptions.configPath?.trim()),
    hasAdHoc: hasAdHocServerOptions(serverOptions),
  });
  if (conflict) {
    throw new Error(conflict);
  }

  const source = resolveServerSource(serverOptions);

  if (source) {
    let config = readServerListFile(source.path, source.writable);
    const secretStore = serverOptions.secretStore ?? defaultSecretStore();
    config = await rehydrateMcpConfigFromKeychain(config, secretStore);
    const entries = mcpConfigToServerEntries(config);
    const result: Record<string, ResolvedServer> = {};
    for (const entry of entries) {
      result[entry.name] = {
        config: applyOverrides(entry.config, {
          env: serverOptions.env,
          cwd: serverOptions.cwd,
        }),
        // Deliberate broadcast: a single `--header` set (and `--protocol-era`,
        // `--skill-catalog-max-*`) is merged into EVERY server in the
        // catalog/config (fine for the common single-server case; for
        // multi-server files, prefer per-server settings in the file itself).
        settings: mergeSettings(entry.settings, serverOptions),
      };
    }
    return result;
  }

  const configs = resolveServerConfigs(serverOptions, "multi");
  if (configs.length === 0) {
    throw new Error(
      "At least one server is required. Use --catalog/--config <path> or an ad-hoc target (command/URL).",
    );
  }
  return {
    default: {
      config: configs[0]!,
      settings: mergeSettings(undefined, serverOptions),
    },
  };
}

/**
 * Pick a single resolved server for runners that connect to exactly one (the
 * CLI). With `serverName`, returns that entry or errors listing the available
 * names; otherwise requires exactly one server in the source.
 *
 * The unknown-name error is source-agnostic ("not found" rather than "not found
 * in config file") because `entries` may come from a file *or* a single ad-hoc
 * target — e.g. `--server foo` alongside a positional command resolves to just
 * `{ default }`, where "in config file" would be misleading.
 *
 * The lookup is an own-property read (`getOwnEntry`), so `--server constructor`
 * (or any other inherited `Object.prototype` name) absent from `entries`
 * reports "not found" rather than returning the inherited member (#2537).
 */
export function selectServerEntry(
  entries: Record<string, ResolvedServer>,
  serverName?: string,
): ResolvedServer {
  const names = Object.keys(entries);
  if (serverName) {
    const entry = getOwnEntry(entries, serverName);
    if (!entry) {
      throw new Error(
        `Server '${serverName}' not found. Available servers: ${names.join(", ")}`,
      );
    }
    return entry;
  }
  if (names.length === 0) {
    throw new Error("No servers found in config file");
  }
  if (names.length > 1) {
    throw new Error(
      `Multiple servers found in config file. Please specify one with --server. Available servers: ${names.join(", ")}`,
    );
  }
  return entries[names[0]!]!;
}
