/**
 * The CLI's write path for the server catalog (#2433): `servers/add`,
 * `servers/edit` and `servers/remove`.
 *
 * ## Why this drives the web backend's routes in-process
 *
 * The catalog is not just a JSON file. The web backend's `/api/servers`
 * routes (`core/mcp/remote/node/server.ts`) own every invariant a write has
 * to keep: secret values (stdio `env`, the OAuth client secret) are split out
 * of `mcp.json` into the selected secret store with a compensated
 * keychain → disk → cleanup ordering; ids are validated
 * (`validateStoreId`); duplicate and missing ids are checked with
 * own-property lookups; Inspector-extension fields are smuggle-guarded and
 * normalized; and the file is written atomically through `writeStoreFile`.
 * A second writer here would have to re-implement all of that and would
 * drift from it the first time either side changed.
 *
 * So this module builds the same Hono app (`createRemoteApp`) against the
 * catalog file and calls its routes with `app.request()` — no socket, no
 * listener, no auth token (`dangerouslyOmitAuth` is safe because nothing is
 * exposed: the requests never leave this process). The CLI therefore writes
 * byte-for-byte what the web UI would, and a running web backend picks the
 * change up through its file watcher like any other external edit.
 *
 * ## Read-only sources are refused
 *
 * Only the writable catalog (`--catalog`, `MCP_CATALOG_PATH`, or the default
 * `~/.mcp-inspector/mcp.json`) can be written. `--config` names a read-only
 * session file and is rejected outright, matching the web backend's 403.
 *
 * ## A session-scoped secret store is refused for new secrets
 *
 * The web backend, on a non-durable (in-memory) secret store, keeps newly
 * entered secrets in memory for the life of the process and never writes
 * them to disk. For a long-running web server that is a session; for a CLI
 * that exits immediately it is silent data loss. So when the store is not
 * durable and this invocation supplies `-e` values, the write is refused
 * with a pointer to `MCP_INSPECTOR_SECRET_STORE`.
 */
import { resolve } from "node:path";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import {
  defaultSecretStore,
  SECRET_STORE_ENV,
} from "@inspector/core/auth/node/secret-store-selection.js";
import {
  secretStoreIsDurable,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import {
  getDefaultMcpConfigPath,
  parseStore,
  readStoreFile,
} from "@inspector/core/storage/store-io.js";
import {
  resolveServerConfigs,
  type ServerConfigOptions,
} from "@inspector/core/mcp/node/config.js";
import { headersToServerSettings } from "@inspector/core/mcp/node/servers.js";
import {
  storedFieldsToInspectorSettings,
  stripInspectorFields,
} from "@inspector/core/mcp/serverList.js";
import type {
  InspectorServerSettings,
  MCPConfig,
  MCPServerConfig,
  ServerProtocolEra,
  StoredMCPServer,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";

/** The catalog-mutating `--method` values this module implements. */
export const CATALOG_WRITE_METHODS = [
  "servers/add",
  "servers/edit",
  "servers/remove",
] as const;

export type CatalogWriteMethod = (typeof CATALOG_WRITE_METHODS)[number];

export function isCatalogWriteMethod(
  method: string | undefined,
): method is CatalogWriteMethod {
  return (CATALOG_WRITE_METHODS as readonly string[]).includes(method ?? "");
}

/** The flags a catalog write reads, already parsed by commander. */
export interface CatalogWriteOptions {
  /** `--server`: the entry to add, edit, or remove. */
  server?: string;
  /** `--rename`: new name for `servers/edit`. */
  rename?: string;
  /** `--catalog`. */
  catalog?: string;
  /** `--config` — present only so it can be rejected as read-only. */
  config?: string;
  /** Positional command + args, or a URL. */
  target?: string[];
  transport?: "sse" | "http" | "stdio";
  serverUrl?: string;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  protocolEra?: ServerProtocolEra;
  /** Test injection; defaults to the host-selected store. */
  secretStore?: SecretStore;
}

/** What a successful write reports on stdout. */
export interface CatalogWriteResult {
  ok: true;
  action: "added" | "updated" | "removed";
  server: string;
  /** Present on a rename. */
  previousName?: string;
  catalog: string;
}

/**
 * Resolve the writable catalog path, refusing a read-only `--config`.
 * Precedence matches the read side: `--catalog` → `MCP_CATALOG_PATH` → the
 * default `~/.mcp-inspector/mcp.json`. Relative paths resolve against the
 * current directory, as `readServerListFile` resolves them.
 */
export function resolveWritableCatalogPath(
  options: Pick<CatalogWriteOptions, "catalog" | "config">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (options.config?.trim()) {
    throw new Error(
      "--config names a read-only session file; catalog writes need the writable catalog (--catalog <path>, MCP_CATALOG_PATH, or the default ~/.mcp-inspector/mcp.json).",
    );
  }
  const path =
    options.catalog?.trim() ||
    env.MCP_CATALOG_PATH?.trim() ||
    getDefaultMcpConfigPath();
  return resolve(process.cwd(), path);
}

function hasTransportTarget(options: CatalogWriteOptions): boolean {
  return (
    (options.target?.length ?? 0) > 0 || Boolean(options.serverUrl?.trim())
  );
}

/**
 * Build the SDK transport config from the same ad-hoc flags a one-shot run
 * takes (positional command/URL, `--transport`, `--server-url`, `-e`,
 * `--cwd`), through the shared `resolveServerConfigs` so `servers/add` and an
 * ad-hoc connect can never interpret the flags differently.
 */
function buildTransportConfig(options: CatalogWriteOptions): MCPServerConfig {
  const adHoc: ServerConfigOptions = {
    target: options.target,
    transport: options.transport,
    serverUrl: options.serverUrl,
    cwd: options.cwd,
    env: options.env,
  };
  // "single" with no catalog/config source always resolves the ad-hoc target.
  return resolveServerConfigs(adHoc, "single")[0]!;
}

/** A settings node at product defaults, for an entry that had none. */
function defaultSettings(): InspectorServerSettings {
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
 * Overlay `--header` / `--protocol-era` onto a settings node. Returns
 * undefined when neither flag was given, so the caller sends no `settings`
 * and the route preserves (PUT) or omits (POST) the node.
 *
 * `env` / `cwd` are removed: those are config fields the settings node only
 * mirrors, and every write here sends the config, which owns them.
 */
function settingsWithOverrides(
  base: InspectorServerSettings | undefined,
  options: CatalogWriteOptions,
): InspectorServerSettings | undefined {
  const fromHeaders = headersToServerSettings(options.headers);
  if (!fromHeaders && !options.protocolEra) return undefined;
  const next: InspectorServerSettings = { ...(base ?? defaultSettings()) };
  if (fromHeaders) next.headers = fromHeaders.headers;
  if (options.protocolEra) next.protocolEra = options.protocolEra;
  next.env = [];
  delete next.cwd;
  return next;
}

/**
 * Refuse to hand new secret values to a store that dies with this process.
 * See the module comment.
 */
async function assertSecretsPersist(
  store: SecretStore,
  options: CatalogWriteOptions,
): Promise<void> {
  if (!options.env || Object.keys(options.env).length === 0) return;
  if (await secretStoreIsDurable(store)) return;
  throw new Error(
    `The selected secret store is in-memory only, so the -e values would be lost when the CLI exits. Set ${SECRET_STORE_ENV}=file (or keyring) to persist them.`,
  );
}

/** Read the catalog's entry map straight off disk; a missing file is empty. */
async function readCatalogEntries(
  catalogPath: string,
): Promise<Record<string, unknown>> {
  const raw = await readStoreFile(catalogPath);
  if (raw === null) return {};
  const parsed = parseStore(raw) as { mcpServers?: unknown } | null;
  const servers = parsed?.mcpServers;
  return servers !== null && typeof servers === "object"
    ? (servers as Record<string, unknown>)
    : {};
}

type RouteCall = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<unknown>;

/**
 * Run `fn` against an in-process instance of the web backend's routes for
 * `catalogPath`, tearing the app down afterwards. A non-2xx response throws
 * the route's own `error` message.
 */
async function withCatalogRoutes<T>(
  catalogPath: string,
  secretStore: SecretStore,
  fn: (call: RouteCall) => Promise<T>,
): Promise<T> {
  const { app, close } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: catalogPath,
    writable: true,
    secretStore,
    initialConfig: { defaultEnvironment: {} },
  });
  const call: RouteCall = async (method, path, body) => {
    const res = await app.request(path, {
      method,
      ...(body !== undefined
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const payload = (await res.json()) as unknown;
    if (!res.ok) {
      /* v8 ignore next 6 -- every /api/servers error response carries a
         string `error`; the status fallback only guards a future route that
         answers otherwise. */
      const message =
        payload !== null &&
        typeof payload === "object" &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return payload;
  };
  try {
    return await fn(call);
  } finally {
    await close();
  }
}

function requireServerName(
  method: CatalogWriteMethod,
  server: string | undefined,
): string {
  const name = server?.trim();
  if (!name) {
    throw new Error(`${method} requires --server <name>.`);
  }
  return name;
}

/** `servers/add`: create a new catalog entry. */
export async function addCatalogServer(
  options: CatalogWriteOptions,
): Promise<CatalogWriteResult> {
  const name = requireServerName("servers/add", options.server);
  if (options.rename !== undefined) {
    throw new Error("--rename is only valid with servers/edit.");
  }
  const catalog = resolveWritableCatalogPath(options);
  if (!hasTransportTarget(options)) {
    throw new Error(
      "servers/add requires a command or URL (positional target, or --server-url).",
    );
  }
  const config = buildTransportConfig(options);
  const settings = settingsWithOverrides(undefined, options);
  const store = options.secretStore ?? defaultSecretStore();
  await assertSecretsPersist(store, options);
  await withCatalogRoutes(catalog, store, (call) =>
    call("POST", "/api/servers", {
      id: name,
      config,
      ...(settings ? { settings } : {}),
    }),
  );
  return { ok: true, action: "added", server: name, catalog };
}

/**
 * `servers/edit`: change an existing entry. A new target (positional or
 * `--server-url`) replaces the transport config; otherwise `-e` merges into
 * and `--cwd` replaces the stdio config's fields. `--header` replaces the
 * headers, `--protocol-era` sets the era, `--rename` renames. Everything not
 * named — OAuth, timeouts, metadata, roots — is preserved.
 */
export async function editCatalogServer(
  options: CatalogWriteOptions,
): Promise<CatalogWriteResult> {
  const name = requireServerName("servers/edit", options.server);
  const catalog = resolveWritableCatalogPath(options);
  const newName = options.rename?.trim() || name;
  const replacesTarget = hasTransportTarget(options);
  const patchesStdio =
    Object.keys(options.env ?? {}).length > 0 || Boolean(options.cwd?.trim());
  const changesSettings =
    Object.keys(options.headers ?? {}).length > 0 ||
    Boolean(options.protocolEra);
  if (
    !replacesTarget &&
    !patchesStdio &&
    !changesSettings &&
    newName === name
  ) {
    throw new Error(
      "servers/edit needs something to change: a new command/URL, -e, --cwd, --header, --protocol-era, or --rename.",
    );
  }
  if (options.transport && !replacesTarget) {
    throw new Error(
      "--transport on servers/edit requires the new command or URL it applies to.",
    );
  }
  // Checked against the raw file before the routes run: GET on a missing
  // catalog seeds the web UI's sample servers, which an edit must not do.
  const onDisk = await readCatalogEntries(catalog);
  if (!Object.hasOwn(onDisk, name)) {
    throw new Error(`Server '${name}' not found in catalog ${catalog}.`);
  }
  const store = options.secretStore ?? defaultSecretStore();
  await assertSecretsPersist(store, options);
  // A rename moves the entry's secrets from the old name to the new one. A
  // session store in this process is empty — whatever it would hold lives in
  // the memory of the process that wrote it (a running web backend) — so the
  // move would find nothing and the entry would come back under its new name
  // without them.
  if (newName !== name && !(await secretStoreIsDurable(store))) {
    throw new Error(
      `--rename needs a durable secret store to carry the entry's secrets to the new name; the selected store is in-memory only. Set ${SECRET_STORE_ENV}=file (or keyring), or rename it from the web UI.`,
    );
  }
  await withCatalogRoutes(catalog, store, async (call) => {
    // GET returns the entry with its secrets rehydrated, so the config sent
    // back below still carries the env values the user did not touch.
    const current = (await call("GET", "/api/servers")) as MCPConfig;
    if (!Object.hasOwn(current.mcpServers, name)) {
      throw new Error(`Server '${name}' not found in catalog ${catalog}.`);
    }
    const existing = current.mcpServers[name] as StoredMCPServer;
    let config: MCPServerConfig;
    if (replacesTarget) {
      config = buildTransportConfig(options);
    } else {
      config = stripInspectorFields(existing);
      if (patchesStdio) {
        if (config.type === "sse" || config.type === "streamable-http") {
          throw new Error(
            `-e and --cwd apply to stdio servers; '${name}' is ${config.type}.`,
          );
        }
        config = {
          ...config,
          ...(options.env && Object.keys(options.env).length > 0
            ? { env: { ...(config.env ?? {}), ...options.env } }
            : {}),
          ...(options.cwd?.trim() ? { cwd: options.cwd.trim() } : {}),
        };
      }
    }
    const settings = settingsWithOverrides(
      storedFieldsToInspectorSettings(existing),
      options,
    );
    await call("PUT", `/api/servers/${encodeURIComponent(name)}`, {
      id: newName,
      config,
      ...(settings ? { settings } : {}),
    });
  });
  return {
    ok: true,
    action: "updated",
    server: newName,
    ...(newName !== name ? { previousName: name } : {}),
    catalog,
  };
}

/** `servers/remove`: delete an entry and its stored secrets. */
export async function removeCatalogServer(
  options: CatalogWriteOptions,
): Promise<CatalogWriteResult> {
  const name = requireServerName("servers/remove", options.server);
  assertNoRemoveExtras(options);
  const catalog = resolveWritableCatalogPath(options);
  // The route's DELETE is idempotent; a CLI user who mistypes a name should
  // hear about it rather than see "removed".
  const onDisk = await readCatalogEntries(catalog);
  if (!Object.hasOwn(onDisk, name)) {
    throw new Error(`Server '${name}' not found in catalog ${catalog}.`);
  }
  const store = options.secretStore ?? defaultSecretStore();
  await withCatalogRoutes(catalog, store, (call) =>
    call("DELETE", `/api/servers/${encodeURIComponent(name)}`),
  );
  return { ok: true, action: "removed", server: name, catalog };
}

/**
 * Flags `servers/remove` would accept and then ignore. Rejected rather than
 * dropped, so a caller never reads success as "my flag took effect".
 */
function assertNoRemoveExtras(options: CatalogWriteOptions): void {
  const checks: [boolean, string][] = [
    [hasTransportTarget(options), "a command/URL"],
    [Boolean(options.transport), "--transport"],
    [Object.keys(options.env ?? {}).length > 0, "-e"],
    [Boolean(options.cwd?.trim()), "--cwd"],
    [Object.keys(options.headers ?? {}).length > 0, "--header"],
    [Boolean(options.protocolEra), "--protocol-era"],
    [options.rename !== undefined, "--rename"],
  ];
  const extras = checks.filter(([present]) => present).map(([, flag]) => flag);
  if (extras.length > 0) {
    throw new Error(
      `servers/remove takes only --server <name>; remove ${extras.join(", ")}.`,
    );
  }
}

/** Dispatch one catalog-write method. */
export function runCatalogWrite(
  method: CatalogWriteMethod,
  options: CatalogWriteOptions,
): Promise<CatalogWriteResult> {
  switch (method) {
    case "servers/add":
      return addCatalogServer(options);
    case "servers/edit":
      return editCatalogServer(options);
    case "servers/remove":
      return removeCatalogServer(options);
  }
}
