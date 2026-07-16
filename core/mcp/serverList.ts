/**
 * Pure converters between the on-disk `mcp.json` shape (`MCPConfig`) and the
 * in-memory list of `ServerEntry` records the UI consumes. No I/O, no Node
 * deps — safe to import from the browser side of core/ as well as the
 * remote-server route handlers.
 */

import { DEFAULT_MAX_FETCH_REQUESTS, DEFAULT_TASK_TTL_MS } from "./types.js";
import type { Root } from "@modelcontextprotocol/client";
import type {
  InspectorServerSettings,
  MCPConfig,
  MCPServerConfig,
  ServerEntry,
  ServerType,
  StdioServerConfig,
  StoredMCPServer,
} from "./types.js";
import {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "../auth/secret-fields.js";

// The full set of valid `type` discriminator values, used to reject anything
// else read off disk so unknown strings can't propagate to narrowing sites.
const VALID_SERVER_TYPES: ReadonlySet<ServerType> = new Set([
  "stdio",
  "sse",
  "streamable-http",
]);

/**
 * Normalizes server type:
 * - missing / unknown / non-string → "stdio" (matches Claude Desktop's default)
 * - "http" → "streamable-http" (legacy alias)
 * - valid ServerType → passed through unchanged
 *
 * Lives here (rather than in node/config.ts) so the file stays Node-free
 * and the same normalization is applied by every consumer of `mcp.json`.
 * The "unknown → stdio" branch keeps a hand-edited file with `"type":"websocket"`
 * or `"type": 42` from leaking through `as ServerType` casts into narrowing
 * sites that would then fall through in surprising ways.
 */
export function normalizeServerType(
  config: Record<string, unknown> & { type?: unknown },
): MCPServerConfig {
  const type = config.type;
  let normalizedType: ServerType;
  if (typeof type !== "string") {
    normalizedType = "stdio";
  } else if (type === "http") {
    normalizedType = "streamable-http";
  } else if (VALID_SERVER_TYPES.has(type as ServerType)) {
    normalizedType = type as ServerType;
  } else {
    normalizedType = "stdio";
  }
  return { ...config, type: normalizedType } as MCPServerConfig;
}

/**
 * Normalize the form's controlled root rows into the shape the Inspector
 * advertises and persists: drop rows whose `uri` is blank (the form leaves a
 * new row empty mid-edit) and drop a blank/whitespace `name`. Any other fields
 * a root carries (e.g. `_meta` from a hand-edited `mcp.json`) are preserved —
 * only `uri`/`name` are normalized. Shared by the settings → disk converter
 * (`inspectorSettingsToStoredFields`) and the web client's connect-time +
 * `setRoots` wiring so the roots told to the server match what hits disk.
 */
export function cleanRoots(roots: Root[]): Root[] {
  return roots
    .filter((r) => r.uri.trim() !== "")
    .map((r) => {
      const trimmedName = r.name?.trim();
      // Strip `name` off the carried-through rest so a cleared optional name
      // doesn't persist as `name: ""`; re-add it only when non-empty.
      const { name: _name, ...rest } = r;
      return trimmedName ? { ...rest, name: trimmedName } : rest;
    });
}

/**
 * The Inspector-extension fields that live as direct keys on a `StoredMCPServer`
 * (post-#1358) — split out from `MCPServerConfig` so both directions of the
 * converter can name them in one place. Equivalent to
 * `Pick<StoredMCPServer, "headers" | "metadata" | ...>` without re-listing.
 */
type StoredInspectorFields = Pick<
  StoredMCPServer,
  | "headers"
  | "metadata"
  | "connectionTimeout"
  | "requestTimeout"
  | "taskTtl"
  | "autoRefreshOnListChanged"
  | "maxFetchRequests"
  | "oauth"
  | "roots"
>;

/**
 * Convert a stored stdio `env` record into the controlled key/value rows the
 * settings form edits, preserving the object's key insertion order. Empty when
 * absent. Inverse of `envPairsToRecord`.
 */
export function envRecordToPairs(
  env: Record<string, string> | undefined,
): { key: string; value: string }[] {
  return env ? Object.entries(env).map(([key, value]) => ({ key, value })) : [];
}

/**
 * Collapse the form's controlled `env` rows back into a `Record`, dropping rows
 * with an empty/whitespace key (the form lets users leave a new row blank
 * mid-edit). Inverse of `envRecordToPairs`. Used by the `/api/servers` PUT
 * write-through that maps `settings.env` back onto `config.env`.
 */
export function envPairsToRecord(
  pairs: { key: string; value: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    if (key.trim() === "") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Lift the Inspector-extension fields off a freshly-read `StoredMCPServer`
 * into the pair-array / flat-OAuth `InspectorServerSettings` shape the form
 * and the rest of the in-memory layer consume. Returns `undefined` when none
 * of the source fields are present so callers can skip attaching a settings
 * node to entries that don't have one.
 *
 * `headers` becomes a pair-array preserving the object's key insertion order;
 * `oauth.*` becomes the flat `oauthClientId` / `oauthClientSecret` /
 * `oauthScopes` fields. Numeric timeouts default to 0 when absent — the form
 * needs concrete values to render and 0 is the SDK's "no timeout" signal.
 *
 * `env` / `cwd` are SDK config fields (not Inspector-extension keys), but they
 * are mirrored into the settings here so the Server Settings modal can edit
 * them for stdio servers. They are NOT re-emitted by
 * `inspectorSettingsToStoredFields` — the write side lives in the PUT route's
 * write-through (config stays the single on-disk owner). Their presence alone
 * is enough to materialize a settings node so a bare `{ command, env }` entry
 * surfaces its env in the form.
 */
export function storedFieldsToInspectorSettings(
  stored: StoredInspectorFields & {
    env?: Record<string, string>;
    cwd?: string;
  },
): InspectorServerSettings | undefined {
  const hasAny =
    stored.headers !== undefined ||
    stored.metadata !== undefined ||
    stored.connectionTimeout !== undefined ||
    stored.requestTimeout !== undefined ||
    stored.taskTtl !== undefined ||
    stored.autoRefreshOnListChanged !== undefined ||
    stored.maxFetchRequests !== undefined ||
    stored.oauth !== undefined ||
    stored.roots !== undefined ||
    stored.env !== undefined ||
    stored.cwd !== undefined;
  if (!hasAny) return undefined;

  const headersPairs: { key: string; value: string }[] = stored.headers
    ? Object.entries(stored.headers).map(([key, value]) => ({ key, value }))
    : [];

  const settings: InspectorServerSettings = {
    headers: headersPairs,
    env: envRecordToPairs(stored.env),
    metadata: stored.metadata ?? [],
    connectionTimeout: stored.connectionTimeout ?? 0,
    requestTimeout: stored.requestTimeout ?? 0,
    // Unlike the timeouts (0 = "SDK default"), task TTL has a concrete product
    // default so the form shows it and "Run as task" has a value to send.
    taskTtl: stored.taskTtl ?? DEFAULT_TASK_TTL_MS,
    autoRefreshOnListChanged: stored.autoRefreshOnListChanged ?? false,
    // Concrete default like taskTtl (not a 0-sentinel): the form needs a value
    // to render and the log state needs one to size its buffer. An absent
    // on-disk field reads back as the default, which the write side then omits.
    maxFetchRequests: stored.maxFetchRequests ?? DEFAULT_MAX_FETCH_REQUESTS,
    // Defaults to an empty list so the form always has a concrete array to
    // render controlled rows from. An absent on-disk `roots` reads back as
    // `[]`, which `inspectorSettingsToStoredFields` then omits on write.
    roots: stored.roots ?? [],
  };
  // Truthiness drops empty-string OAuth fields — mirrors the write-side
  // coercion in `validateSettings` (server.ts) so a round-trip can't
  // accidentally surface `oauthClientId: ""` to the form, where the
  // OAuth manager would misread it as "configured."
  if (stored.oauth?.clientId) settings.oauthClientId = stored.oauth.clientId;
  if (stored.oauth?.clientSecret)
    settings.oauthClientSecret = stored.oauth.clientSecret;
  if (stored.oauth?.scopes) settings.oauthScopes = stored.oauth.scopes;
  if (stored.oauth?.enterpriseManaged === true) {
    settings.enterpriseManaged = true;
  }
  // Mirror the stdio working directory for the form. Like the OAuth fields, an
  // empty string coerces to absent so the form's "(inherit)" placeholder shows.
  if (stored.cwd) settings.cwd = stored.cwd;
  return settings;
}

/**
 * Splat the form-shape `InspectorServerSettings` back into the on-disk
 * Inspector-extension fields (object-form `headers`, nested `oauth`, etc.).
 * Empty-key rows are dropped — the form lets users leave new rows blank
 * mid-edit and those shouldn't reach disk. Numeric timeouts at 0 are omitted
 * so the file diff stays minimal for entries that never touched them.
 *
 * Returns the field deltas to merge onto a `StoredMCPServer`; callers can
 * spread the result.
 */
export function inspectorSettingsToStoredFields(
  settings: InspectorServerSettings,
): StoredInspectorFields {
  const out: StoredInspectorFields = {};

  const headersRecord: Record<string, string> = {};
  for (const { key, value } of settings.headers) {
    if (key.trim() === "") continue;
    headersRecord[key] = value;
  }
  if (Object.keys(headersRecord).length > 0) {
    out.headers = headersRecord;
  }

  const metadataFiltered = settings.metadata.filter((m) => m.key.trim() !== "");
  if (metadataFiltered.length > 0) {
    out.metadata = metadataFiltered;
  }

  if (settings.connectionTimeout > 0) {
    out.connectionTimeout = settings.connectionTimeout;
  }
  if (settings.requestTimeout > 0) {
    out.requestTimeout = settings.requestTimeout;
  }
  // Persist taskTtl only when it's a non-default positive value. The product
  // default (DEFAULT_TASK_TTL_MS) is the omit-sentinel here — an absent field
  // reads back as the default (above), so writing the default would inject it
  // into hand-edited files that never had it and break byte-stable round-trips.
  if (settings.taskTtl > 0 && settings.taskTtl !== DEFAULT_TASK_TTL_MS) {
    out.taskTtl = settings.taskTtl;
  }

  // Persist only when enabled — absent reads back as false (above), keeping the
  // diff minimal for the common (default-off) case.
  if (settings.autoRefreshOnListChanged) {
    out.autoRefreshOnListChanged = true;
  }

  // Persist only when it differs from the default. Unlike the timeouts, 0 is a
  // meaningful value here (unlimited), so the omit-sentinel is the default
  // itself rather than 0 — writing the default would inject the field into
  // hand-edited files that never had it and break byte-stable round-trips.
  if (settings.maxFetchRequests !== DEFAULT_MAX_FETCH_REQUESTS) {
    out.maxFetchRequests = settings.maxFetchRequests;
  }

  const oauthFields: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
    enterpriseManaged?: boolean;
  } = {};
  if (settings.oauthClientId) oauthFields.clientId = settings.oauthClientId;
  if (settings.oauthClientSecret)
    oauthFields.clientSecret = settings.oauthClientSecret;
  if (settings.oauthScopes) oauthFields.scopes = settings.oauthScopes;
  if (settings.enterpriseManaged === true) {
    oauthFields.enterpriseManaged = true;
  }
  if (Object.keys(oauthFields).length > 0) {
    out.oauth = oauthFields;
  }

  // Drop empty-uri rows / blank names via the shared normalizer; omit the
  // field entirely when nothing survives, keeping the diff minimal for entries
  // that never configured roots.
  const rootsFiltered = cleanRoots(settings.roots);
  if (rootsFiltered.length > 0) {
    out.roots = rootsFiltered;
  }

  return out;
}

/**
 * Source of truth for the set of Inspector-extension keys that live at the
 * top level of a `StoredMCPServer`. Enumerated through a map keyed by
 * `keyof StoredInspectorFields` with a `satisfies` constraint so any new
 * field added to the type forces a compile error here — the disk → memory
 * converter slice, the server-side smuggle guard, and the PUT preserve
 * path all derive from this single source.
 *
 * Don't replace this with a hand-typed string array — `satisfies
 * Record<keyof StoredInspectorFields, true>` is what gives us the
 * exhaustive check. `as const` plus the `satisfies` clause yields a
 * narrow tuple-of-literals type that downstream consumers can use as
 * `(keyof StoredInspectorFields)[]`.
 */
const INSPECTOR_FIELD_KEY_MAP = {
  headers: true,
  metadata: true,
  connectionTimeout: true,
  requestTimeout: true,
  taskTtl: true,
  autoRefreshOnListChanged: true,
  maxFetchRequests: true,
  oauth: true,
  roots: true,
} as const satisfies Record<keyof StoredInspectorFields, true>;

export const INSPECTOR_FIELD_KEYS = new Set(
  Object.keys(INSPECTOR_FIELD_KEY_MAP) as (keyof StoredInspectorFields)[],
);

/**
 * Strip the Inspector-extension fields off a `StoredMCPServer` so the
 * remainder is the pure SDK config shape the PUT route's preserve path
 * needs. Source-of-truth driven via `INSPECTOR_FIELD_KEYS` so adding a
 * new extension field doesn't silently leak through this slice — the
 * `satisfies` constraint above forces the map update, which propagates
 * here.
 */
export function stripInspectorFields(stored: StoredMCPServer): MCPServerConfig {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(
    stored as unknown as Record<string, unknown>,
  )) {
    if (INSPECTOR_FIELD_KEYS.has(k as keyof StoredInspectorFields)) continue;
    out[k] = v;
  }
  return out as unknown as MCPServerConfig;
}

/**
 * Convert the on-disk `MCPConfig` into the `ServerEntry[]` the Servers screen
 * consumes. Map key becomes both `id` and `name`. Connection state initializes
 * to `disconnected` — the React layer drives it from there. Inspector-extension
 * fields (post-#1358 flat shape) are lifted into `ServerEntry.settings` so the
 * rest of the app sees `config` as the pure SDK shape.
 */
export function mcpConfigToServerEntries(config: MCPConfig): ServerEntry[] {
  return Object.entries(config.mcpServers).map(([id, raw]) => {
    // Separate Inspector-extension fields from the SDK-only config so the
    // transport never sees `entry.config.headers` (which would be ambiguous
    // — pair-array in memory, object on disk). Headers live on the wire via
    // `InspectorServerSettings` only.
    const inspectorFields: StoredInspectorFields = {};
    const sdkOnly: Record<string, unknown> = {};
    // Widen the typed config object to a generic record to iterate its keys.
    // `StoredMCPServer` has no index signature, so TS requires the `unknown`
    // step (`as Record<string, unknown>` alone is TS2352). This is a plain
    // structural widening, not an SDK-shape workaround. (Pre-existing pattern,
    // also at the `serverEntryToStored` / oauth-strip casts in this file.)
    for (const [k, v] of Object.entries(
      raw as unknown as Record<string, unknown>,
    )) {
      if (INSPECTOR_FIELD_KEYS.has(k as keyof StoredInspectorFields)) {
        (inspectorFields as Record<string, unknown>)[k] = v;
      } else {
        sdkOnly[k] = v;
      }
    }
    const normalizedConfig = normalizeServerType(
      sdkOnly as Record<string, unknown> & { type?: string },
    );
    const entry: ServerEntry = {
      id,
      name: id,
      config: normalizedConfig,
      connection: { status: "disconnected" },
    };
    // Mirror the stdio `env` / `cwd` (SDK config fields) into the settings so
    // the Server Settings modal can edit them. They stay on `config` for the
    // transport. Gate on the stdio type rather than blindly casting — a non-
    // stdio config carries neither field, matching the modal's stdio-only UI.
    const isStdio =
      normalizedConfig.type === "stdio" || normalizedConfig.type === undefined;
    const stdioConfig = isStdio
      ? (normalizedConfig as StdioServerConfig)
      : undefined;
    const settings = storedFieldsToInspectorSettings({
      ...inspectorFields,
      env: stdioConfig?.env,
      cwd: stdioConfig?.cwd,
    });
    if (settings !== undefined) entry.settings = settings;
    return entry;
  });
}

/**
 * Convert `ServerEntry[]` back into `MCPConfig` for serialization. Strips
 * runtime-only fields (connection, info, name); persists `config` plus the
 * Inspector-extension fields as direct keys on the entry (post-#1358 flat
 * shape) so the file matches the Claude Code / Cursor / Cline `.mcp.json`
 * convention.
 */
export function serverEntriesToMcpConfig(entries: ServerEntry[]): MCPConfig {
  const mcpServers: Record<string, StoredMCPServer> = {};
  for (const entry of entries) {
    const stored: StoredMCPServer = { ...entry.config } as StoredMCPServer;
    if (entry.settings !== undefined) {
      Object.assign(stored, inspectorSettingsToStoredFields(entry.settings));
    }
    mcpServers[entry.id] = stored;
  }
  return { mcpServers };
}

/**
 * Canonical JSON serialization for `mcp.json` files. Two-space indent — the
 * same format `serializeStore` in core/storage/store-io.ts writes on the
 * backend, so a round-trip through export → hand-edit → import preserves
 * the on-disk shape. Browser-safe (no Node imports); the backend uses the
 * Node-only serializeStore but the formatting must match.
 */
export function serializeMcpConfig(entries: ServerEntry[]): string {
  return JSON.stringify(serverEntriesToMcpConfig(entries), null, 2);
}

/**
 * Result of splitting secret values off a `StoredMCPServer` for keychain
 * persistence. `stripped` is what gets written to `mcp.json` on disk;
 * `secrets` is the (field → value) map the keychain backend writes.
 *
 * Empty-string values are not written to keychain (they have the same
 * semantic meaning as absence). Callers that want full reconcile
 * semantics on update should also call `deleteAllForServer` first.
 */
export interface ExtractedSecrets {
  stripped: StoredMCPServer;
  secrets: Record<string, string>;
}

/**
 * Type guard for the stdio branch of `MCPServerConfig`. The `type` field
 * is optional on `StdioServerConfig` because stdio is the implicit
 * default for entries written without a `type` key (matches Claude
 * Desktop). So both `undefined` and the literal "stdio" route here.
 */
const isStdioStored = (
  stored: StoredMCPServer,
): stored is StdioServerConfig & StoredMCPServer =>
  stored.type === "stdio" || stored.type === undefined;

/**
 * Strip secret values from a single on-disk entry. Returns the
 * sanitized disk shape (oauth.clientSecret removed; stdio env values
 * cleared to "") plus the map of field → value the keychain should
 * hold.
 *
 * stdio env keys are preserved with empty-string values rather than
 * dropped, so the on-disk file still documents the env interface the
 * server expects (a user reading mcp.json can see "this server uses
 * API_KEY and DB_PASSWORD" even though the values live in the
 * keychain). Round-tripping with another tool that reads mcp.json
 * gets the same key set but empty values, which is the intended
 * trade-off: the secret never reaches another tool, but the key list
 * is still visible.
 */
export function extractSecretsFromStored(
  stored: StoredMCPServer,
): ExtractedSecrets {
  const secrets: Record<string, string> = {};
  const stripped: StoredMCPServer = { ...stored };

  if (stored.oauth?.clientSecret) {
    secrets[SECRET_FIELD_OAUTH_CLIENT_SECRET] = stored.oauth.clientSecret;
    const restOauth: {
      clientId?: string;
      scopes?: string;
      enterpriseManaged?: boolean;
    } = {};
    if (stored.oauth.clientId !== undefined)
      restOauth.clientId = stored.oauth.clientId;
    if (stored.oauth.scopes !== undefined)
      restOauth.scopes = stored.oauth.scopes;
    if (stored.oauth.enterpriseManaged === true) {
      restOauth.enterpriseManaged = true;
    }
    if (Object.keys(restOauth).length > 0) {
      stripped.oauth = restOauth;
    } else {
      delete (stripped as unknown as Record<string, unknown>).oauth;
    }
  }

  if (isStdioStored(stripped)) {
    const env = stripped.env;
    if (env) {
      const newEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string" && v.length > 0) {
          secrets[envSecretField(k)] = v;
        }
        newEnv[k] = "";
      }
      stripped.env = newEnv;
    }
  }

  return { stripped, secrets };
}

/**
 * Inverse of `extractSecretsFromStored`. Merges a pre-fetched secrets
 * record back into an on-disk entry. Used at the `/api/servers` GET
 * boundary so the browser receives the same effective shape it has
 * today.
 *
 * A missing key in `secrets` leaves the corresponding field alone,
 * which matters for stdio env: if the keychain doesn't have a value
 * for `env:KEY`, the on-disk empty string passes through unchanged.
 */
export function mergeSecretsIntoStored(
  stored: StoredMCPServer,
  secrets: Record<string, string>,
): StoredMCPServer {
  const out: StoredMCPServer = { ...stored };

  const oauthSecret = secrets[SECRET_FIELD_OAUTH_CLIENT_SECRET];
  if (oauthSecret) {
    out.oauth = { ...(out.oauth ?? {}), clientSecret: oauthSecret };
  }

  if (isStdioStored(out) && out.env) {
    const newEnv: Record<string, string> = { ...out.env };
    let mutated = false;
    for (const k of Object.keys(out.env)) {
      const val = secrets[envSecretField(k)];
      if (val !== undefined) {
        newEnv[k] = val;
        mutated = true;
      }
    }
    if (mutated) {
      out.env = newEnv;
    }
  }

  return out;
}

/**
 * Enumerate the keychain field identifiers an on-disk entry expects
 * to find values for. Handlers use this to know which keychain entries
 * to fetch when rehydrating a server, and which keys to reconcile on
 * update (env keys removed by the user should drop their keychain
 * entries).
 *
 * Order is stable: OAuth first, then env keys in object iteration
 * order. Callers that diff old vs new field sets rely on stable
 * enumeration to avoid spurious churn.
 */
export function expectedSecretFields(stored: StoredMCPServer): string[] {
  const fields: string[] = [];
  // Always include OAuth slot — even if the entry has no `oauth` block
  // on disk, the keychain may hold a leftover entry from a prior
  // configuration that we want callers to be able to reconcile.
  fields.push(SECRET_FIELD_OAUTH_CLIENT_SECRET);
  if (isStdioStored(stored) && stored.env) {
    for (const k of Object.keys(stored.env)) {
      fields.push(envSecretField(k));
    }
  }
  return fields;
}

/**
 * Default seeds written to `~/.mcp-inspector/mcp.json` on first launch when
 * the file is absent. Picked to cover the two shapes a developer reaches for
 * first: a real filesystem scoped to /tmp, and the canonical "everything"
 * reference server.
 */
export const DEFAULT_SEED_CONFIG: MCPConfig = {
  mcpServers: {
    "filesystem-server-default": {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    "everything-server-default": {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
};
