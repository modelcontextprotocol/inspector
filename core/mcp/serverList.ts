/**
 * Pure converters between the on-disk `mcp.json` shape (`MCPConfig`) and the
 * in-memory list of `ServerEntry` records the UI consumes. No I/O, no Node
 * deps — safe to import from the browser side of core/ as well as the
 * remote-server route handlers.
 */

import type {
  InspectorServerSettings,
  MCPConfig,
  MCPServerConfig,
  ServerEntry,
  ServerType,
  StoredMCPServer,
} from "./types.js";

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
 * The Inspector-extension fields that live as direct keys on a `StoredMCPServer`
 * (post-#1358) — split out from `MCPServerConfig` so both directions of the
 * converter can name them in one place. Equivalent to
 * `Pick<StoredMCPServer, "headers" | "metadata" | ...>` without re-listing.
 */
type StoredInspectorFields = Pick<
  StoredMCPServer,
  "headers" | "metadata" | "connectionTimeout" | "requestTimeout" | "oauth"
>;

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
 */
export function storedFieldsToInspectorSettings(
  stored: StoredInspectorFields,
): InspectorServerSettings | undefined {
  const hasAny =
    stored.headers !== undefined ||
    stored.metadata !== undefined ||
    stored.connectionTimeout !== undefined ||
    stored.requestTimeout !== undefined ||
    stored.oauth !== undefined;
  if (!hasAny) return undefined;

  const headersPairs: { key: string; value: string }[] = stored.headers
    ? Object.entries(stored.headers).map(([key, value]) => ({ key, value }))
    : [];

  const settings: InspectorServerSettings = {
    headers: headersPairs,
    metadata: stored.metadata ?? [],
    connectionTimeout: stored.connectionTimeout ?? 0,
    requestTimeout: stored.requestTimeout ?? 0,
  };
  // Truthiness drops empty-string OAuth fields — mirrors the write-side
  // coercion in `validateSettings` (server.ts) so a round-trip can't
  // accidentally surface `oauthClientId: ""` to the form, where the
  // OAuth manager would misread it as "configured."
  if (stored.oauth?.clientId) settings.oauthClientId = stored.oauth.clientId;
  if (stored.oauth?.clientSecret)
    settings.oauthClientSecret = stored.oauth.clientSecret;
  if (stored.oauth?.scopes) settings.oauthScopes = stored.oauth.scopes;
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

  const metadataFiltered = settings.metadata.filter(
    (m) => m.key.trim() !== "",
  );
  if (metadataFiltered.length > 0) {
    out.metadata = metadataFiltered;
  }

  if (settings.connectionTimeout > 0) {
    out.connectionTimeout = settings.connectionTimeout;
  }
  if (settings.requestTimeout > 0) {
    out.requestTimeout = settings.requestTimeout;
  }

  const oauthFields: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string;
  } = {};
  if (settings.oauthClientId) oauthFields.clientId = settings.oauthClientId;
  if (settings.oauthClientSecret)
    oauthFields.clientSecret = settings.oauthClientSecret;
  if (settings.oauthScopes) oauthFields.scopes = settings.oauthScopes;
  if (Object.keys(oauthFields).length > 0) {
    out.oauth = oauthFields;
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
  oauth: true,
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
export function stripInspectorFields(
  stored: StoredMCPServer,
): MCPServerConfig {
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
    for (const [k, v] of Object.entries(raw as unknown as Record<string, unknown>)) {
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
    const settings = storedFieldsToInspectorSettings(inspectorFields);
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
