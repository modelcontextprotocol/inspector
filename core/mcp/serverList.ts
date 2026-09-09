/**
 * Pure converters between the on-disk `mcp.json` shape (`MCPConfig`) and the
 * in-memory list of `ServerEntry` records the UI consumes. No I/O, no Node
 * deps — safe to import from the browser side of core/ as well as the
 * remote-server route handlers.
 */

import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_MODERN_LOG_LEVEL,
  DEFAULT_PROTOCOL_ERA,
  DEFAULT_TASK_TTL_MS,
  isModernLogLevel,
} from "./types.js";
import type { Root } from "@modelcontextprotocol/client";
import type {
  InspectorServerSettings,
  RequestMetadata,
  MCPConfig,
  MCPServerConfig,
  ServerEntry,
  ServerProtocolEra,
  ServerType,
  StdioServerConfig,
  StoredMCPServer,
} from "./types.js";
import {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "../auth/secret-fields.js";
import { toRecord } from "../json/jsonUtils.js";
import type { JsonValue } from "../json/jsonUtils.js";
import { isSerializableJson } from "../json/jsonUtils.js";

// The full set of valid `type` discriminator values, used to reject anything
// else read off disk so unknown strings can't propagate to narrowing sites.
const VALID_SERVER_TYPES: ReadonlySet<ServerType> = new Set([
  "stdio",
  "sse",
  "streamable-http",
]);

const VALID_PROTOCOL_ERAS: ReadonlySet<ServerProtocolEra> = new Set([
  "legacy",
  "auto",
  "modern",
]);

/**
 * Runtime guard for the `protocolEra` literal. `StoredMCPServer` types the
 * field as `ServerProtocolEra`, but a hand-edited `mcp.json` read directly by
 * the CLI/TUI (which don't pass through the `/api/servers` route validators)
 * can carry any string. Dropping unknowns here keeps a garbage value from
 * reaching `eraToVersionNegotiation` — matching the read-side check the
 * `/api/servers` route already applies.
 */
export function isProtocolEra(value: unknown): value is ServerProtocolEra {
  return (
    typeof value === "string" &&
    VALID_PROTOCOL_ERAS.has(value as ServerProtocolEra)
  );
}

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
 * The shared roots normalizer — for a list from the web settings form, from
 * `mcp.json`, or from `setRoots()`. Puts them in the shape the Inspector
 * advertises and persists: drop entries whose `uri` is blank (the settings form
 * leaves a new row empty mid-edit) and drop a blank/whitespace `name`. Any other
 * fields a root carries (e.g. `_meta` from a hand-edited `mcp.json`) are
 * preserved — only `uri`/`name` are normalized. Every path roots take runs
 * through here — the settings → disk converter
 * (`inspectorSettingsToStoredFields`), the `InspectorClient` constructor and
 * `setRoots`, and all three clients' connect-time wiring — so what the server is
 * told matches what hits disk.
 *
 * `Root[]` is a compile-time type over hand-editable `mcp.json`, and every
 * client now feeds this straight from disk (#1797), so the shape is validated
 * at runtime too, rather than throwing at connect: a non-array bails to `[]`,
 * an entry without a string `uri` is dropped, and a non-string `name` is
 * dropped from an otherwise-usable entry. Each case warns.
 */
export function cleanRoots(roots: Root[]): Root[] {
  // Keep: the `Root[]` parameter narrows this branch to `never`, but the type is
  // a promise hand-edited `mcp.json` does not keep. Not dead code (#1797).
  if (!Array.isArray(roots)) {
    console.warn("Ignoring `roots`: expected an array, got", typeof roots);
    return [];
  }
  return roots
    .filter((r) => {
      // Keep: unreachable per the parameter type, reachable from disk.
      if (typeof r?.uri !== "string") {
        console.warn("Dropping root without a string `uri`:", r);
        return false;
      }
      return r.uri.trim() !== "";
    })
    .map((r) => {
      // `?.` would guard null/undefined but not a non-string `name` from disk,
      // which `.trim()` throws on — the `uri` case above, one field over.
      const rawName = r.name;
      if (rawName !== undefined && typeof rawName !== "string") {
        console.warn("Dropping non-string `name` on root:", r);
      }
      const trimmedName =
        typeof rawName === "string" ? rawName.trim() : undefined;
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
  | "protocolEra"
  | "modernLogLevel"
  | "connectionTimeout"
  | "requestTimeout"
  | "taskTtl"
  | "autoRefreshOnListChanged"
  | "paginatedLists"
  | "advertisedExtensions"
  | "maxFetchRequests"
  | "oauth"
  | "roots"
>;

/**
 * Convert a stored stdio `env` record into the controlled key/value rows the
 * settings form edits, preserving the object's key insertion order. Empty when
 * absent. Inverse of `envPairsToRecord`.
 *
 * The transform is generic key/value, so the OAuth authorization-parameters
 * record (#2018) reuses it rather than growing a second copy.
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
 *
 * Generic key/value like its inverse, so the OAuth authorization-parameters
 * rows (#2018) collapse through it too.
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
 * The stdio `env` / `cwd` **config** fields implied by a settings mirror.
 * `undefined` means "the field is not set" — i.e. remove it — which is how a
 * user clears a value through the Server Settings modal (empty env list, blank
 * cwd).
 *
 * `env` and `cwd` are the two fields the modal edits as *settings* while the
 * transport reads them off *config* (see `storedFieldsToInspectorSettings`), so
 * every consumer that has settings and needs a config has to perform this same
 * mapping. It lives here, once, because the two consumers are on opposite sides
 * of the wire — the `/api/servers` PUT write-through persists it, and the web
 * client applies it when constructing an `InspectorClient` (#2096) — and a
 * disagreement between them is invisible until a spawned child process gets an
 * environment the file does not describe.
 */
export function stdioConfigFieldsFromSettings(
  settings: InspectorServerSettings,
): { env: Record<string, string> | undefined; cwd: string | undefined } {
  const env = envPairsToRecord(settings.env);
  const cwd = settings.cwd?.trim();
  return {
    env: Object.keys(env).length > 0 ? env : undefined,
    cwd: cwd ? cwd : undefined,
  };
}

/**
 * A copy of `config` with the stdio `env` / `cwd` taken from `settings`.
 *
 * Used where a caller holds a settings value it trusts more than the config it
 * was read alongside — the web client's connect path, which resolves settings
 * through the last-persisted-write tracker while `config` still comes off a
 * `servers` entry that stops advancing once a list read fails (#2089). Without
 * this the two disagree and the child process is spawned with the *pre-save*
 * environment even though the save reached disk (#2096).
 *
 * Non-stdio configs are returned untouched — they carry neither field, matching
 * the modal's stdio-only UI. Absent settings likewise: a server with no settings
 * node has nothing to apply, and treating that as an empty mirror would clear a
 * config `env` the file does hold.
 */
export function applyStdioSettingsToConfig(
  config: MCPServerConfig,
  settings: InspectorServerSettings | undefined,
): MCPServerConfig {
  if (!settings) return config;
  if (!(config.type === "stdio" || config.type === undefined)) return config;
  const { env, cwd } = stdioConfigFieldsFromSettings(settings);
  const next: StdioServerConfig = { ...(config as StdioServerConfig) };
  if (env) next.env = env;
  else delete next.env;
  if (cwd) next.cwd = cwd;
  else delete next.cwd;
  return next;
}

/**
 * Read a server's `metadata` off disk into the in-memory `RequestMetadata`
 * object, accepting both the current object shape and the pre-#1910
 * `{ key, value }[]` pair array.
 *
 * The pair array is the shape every `mcp.json` written before #1910 carries, so
 * dropping it would silently stop sending a user's configured `_meta` on the
 * first read of an existing file. It is read here and never written back:
 * `inspectorSettingsToStoredFields` emits only the object form, so the file is
 * migrated the next time the entry is saved.
 *
 * Anything else — a string, a number, an array of non-pairs — is not metadata
 * the Inspector can send, so it is dropped with a warning rather than half-
 * interpreted, following `cleanRoots` / `cleanAuthorizationParams` above. A
 * pair whose key is blank is skipped for the same reason the write side omits
 * it: `_meta` has no meaningful empty key.
 */
export function normalizeStoredMetadata(
  metadata: StoredMCPServer["metadata"] | unknown,
): RequestMetadata {
  if (metadata === undefined || metadata === null) return {};

  if (Array.isArray(metadata)) {
    const out: RequestMetadata = {};
    for (const entry of metadata) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { key?: unknown }).key !== "string"
      ) {
        // Structural message only — never the entry. A malformed legacy row
        // still holds whatever the user put in it, which for `_meta` can be a
        // credential, and this goes to the console of every client that reads
        // the catalog.
        console.warn(
          "Ignoring malformed legacy metadata entry (expected `{ key, value }`).",
        );
        continue;
      }
      const { key, value } = entry as { key: string; value?: JsonValue };
      if (key.trim() === "") continue;
      // `??`, not `||`: `null` is a legal `_meta` value and must survive the
      // migration as `null`. Only a genuinely absent `value` becomes `""`.
      const resolved = value === undefined ? "" : value;
      if (!keepSerializable(key, resolved)) continue;
      defineMetadataKey(out, key, resolved);
    }
    return out;
  }

  if (typeof metadata === "object") {
    // A hand-edited catalog reaches this untouched by any editor, so it is a
    // real source of values that parse but cannot be sent — `1e400` becomes
    // `Infinity`, which the next serialization writes as `null`. Same
    // invariant the web editor and the CLI enforce, applied per key so one bad
    // value does not cost the rest.
    const out: RequestMetadata = {};
    for (const [key, value] of Object.entries(metadata as RequestMetadata)) {
      if (keepSerializable(key, value)) defineMetadataKey(out, key, value);
    }
    return out;
  }

  console.warn(
    `Ignoring malformed \`metadata\` (expected a JSON object, got ${describeJsonType(metadata)}).`,
  );
  return {};
}

/**
 * Store a metadata key as an **own** property.
 *
 * `out[key] = value` invokes the prototype setter for the key `"__proto__"`,
 * so the entry vanishes on reload and — for an object value — the returned
 * metadata is given a caller-controlled prototype. `_meta` keys come from a
 * file a user (or something that wrote that file) controls, so `"__proto__"`
 * is a key that can genuinely arrive.
 *
 * Both branches of `normalizeStoredMetadata` go through this rather than each
 * spelling it out. The object branch was originally a spread — safe, because
 * spread defines rather than sets — and rewriting it into a per-key loop for
 * value filtering silently reintroduced the hazard the legacy branch had
 * already fixed. One mechanism is what stops that recurring.
 */
function defineMetadataKey(
  out: RequestMetadata,
  key: string,
  value: JsonValue,
): void {
  Object.defineProperty(out, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Whether a metadata value can be sent as written, warning by key when it
 * cannot.
 *
 * Names the key and the offending type, never the value: `_meta` carries
 * whatever the user configured, credentials included, and these warnings reach
 * ordinary console output.
 */
function keepSerializable(key: string, value: unknown): boolean {
  if (isSerializableJson(value)) return true;
  console.warn(
    `Ignoring metadata key "${key}" — its value is not JSON that can be sent ` +
      `(got ${describeJsonType(value)}; note \`1e400\` parses to Infinity).`,
  );
  return false;
}

/** A one-word type name for a diagnostic that must not disclose the value. */
function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && !Number.isFinite(value)) {
    return Number.isNaN(value) ? "NaN" : "a non-finite number";
  }
  return typeof value;
}

/**
 * Validate a server's `oauth.authorizationParams` as it comes off disk, or
 * `undefined` when there is nothing usable. (#2018)
 *
 * `StoredMCPServer` types this as `Record<string, string>`, but that is a
 * compile-time promise a hand-edited `mcp.json` does not keep — and only the web
 * client's `/api/servers` route checks it, while the CLI and TUI read the file
 * directly. Without this, `authorizationParams: "oops"` enumerates as the
 * character-indexed pairs `0=o, 1=o, …` and `{ audience: 5 }` reaches
 * `URLSearchParams.set`, which stringifies it — either way the Inspector sends
 * query parameters the user never wrote. Each rejection warns, following
 * `cleanRoots` above, which guards the same class for `roots`.
 */
export function cleanAuthorizationParams(
  params: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (params === undefined) return undefined;
  // Keep: unreachable per the parameter type, reachable from disk.
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    console.warn(
      "Ignoring `oauth.authorizationParams`: expected an object of string values, got",
      Array.isArray(params) ? "array" : typeof params,
    );
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") {
      console.warn(
        `Dropping \`oauth.authorizationParams.${key}\`: expected a string value, got ${typeof value}.`,
      );
      continue;
    }
    if (key.trim() === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Collapse a server's custom authorization-parameter rows into the record the
 * `InspectorClientOptions.oauth.authorizationParams` option takes, or
 * `undefined` when nothing survives (no rows, or every row blank-keyed). Shared
 * by the web (`App.tsx`) and Node (`buildRunnerClientAuthOptions`) paths so both
 * derive the option identically. (#2018)
 */
export function oauthAuthorizationParamsFromSettings(
  settings: Pick<InspectorServerSettings, "oauthAuthorizationParams">,
): Record<string, string> | undefined {
  if (!settings.oauthAuthorizationParams) return undefined;
  const record = envPairsToRecord(settings.oauthAuthorizationParams);
  return Object.keys(record).length > 0 ? record : undefined;
}

/**
 * Validate one of a server's `oauth` endpoint overrides as it comes off disk,
 * or `undefined` when there is nothing usable. (#1906)
 *
 * Same reasoning as `cleanAuthorizationParams` above: `StoredMCPServer` types
 * these as `string`, but that is a compile-time promise a hand-edited file does
 * not keep, and the CLI/TUI read `mcp.json` directly. A non-string reaches
 * `oauthEndpointOverridesFromSettings`, which calls `.trim()` on it — so without
 * this the whole server list fails to load. URL *validity* is not checked here;
 * that happens where the override is applied, so a typo drops one field with a
 * warning instead of anything louder.
 */
export function cleanEndpointOverride(
  value: string | undefined,
  field: "authorizationUrl" | "tokenUrl",
): string | undefined {
  if (value === undefined) return undefined;
  // Keep: unreachable per the parameter type, reachable from disk.
  if (typeof value !== "string") {
    console.warn(
      `Ignoring \`oauth.${field}\`: expected a string, got ${typeof value}.`,
    );
    return undefined;
  }
  return value.trim() || undefined;
}

/**
 * Collapse a server's endpoint-override fields into the
 * `InspectorClientOptions.oauth` sub-shape, or `undefined` when neither is set.
 * Shared by the web (`App.tsx`) and Node (`buildRunnerClientAuthOptions`) paths
 * so both derive the option identically. The values are passed through as
 * typed; validation (absolute http(s) URL) happens once at the point of use, in
 * `core/auth/endpointOverrides.ts`. (#1906)
 */
export function oauthEndpointOverridesFromSettings(
  settings: Pick<
    InspectorServerSettings,
    "oauthAuthorizationUrl" | "oauthTokenUrl"
  >,
): { authorizationUrl?: string; tokenUrl?: string } | undefined {
  const authorizationUrl = settings.oauthAuthorizationUrl?.trim();
  const tokenUrl = settings.oauthTokenUrl?.trim();
  if (!authorizationUrl && !tokenUrl) return undefined;
  return {
    ...(authorizationUrl && { authorizationUrl }),
    ...(tokenUrl && { tokenUrl }),
  };
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
    stored.paginatedLists !== undefined ||
    stored.advertisedExtensions !== undefined ||
    stored.maxFetchRequests !== undefined ||
    stored.oauth !== undefined ||
    stored.roots !== undefined ||
    stored.protocolEra !== undefined ||
    stored.modernLogLevel !== undefined ||
    stored.env !== undefined ||
    stored.cwd !== undefined;
  if (!hasAny) return undefined;

  const headersPairs: { key: string; value: string }[] = stored.headers
    ? Object.entries(stored.headers).map(([key, value]) => ({ key, value }))
    : [];

  const settings: InspectorServerSettings = {
    headers: headersPairs,
    env: envRecordToPairs(stored.env),
    metadata: normalizeStoredMetadata(stored.metadata),
    connectionTimeout: stored.connectionTimeout ?? 0,
    requestTimeout: stored.requestTimeout ?? 0,
    // Unlike the timeouts (0 = "SDK default"), task TTL has a concrete product
    // default so the form shows it and "Run as task" has a value to send.
    taskTtl: stored.taskTtl ?? DEFAULT_TASK_TTL_MS,
    autoRefreshOnListChanged: stored.autoRefreshOnListChanged ?? false,
    paginatedLists: stored.paginatedLists ?? false,
    // Concrete default like taskTtl (not a 0-sentinel): the form needs a value
    // to render and the log state needs one to size its buffer. An absent
    // on-disk field reads back as the default, which the write side then omits.
    maxFetchRequests: stored.maxFetchRequests ?? DEFAULT_MAX_FETCH_REQUESTS,
    // Defaults to an empty list so the form always has a concrete array to
    // render controlled rows from. An absent on-disk `roots` reads back as
    // `[]`, which `inspectorSettingsToStoredFields` then omits on write.
    roots: stored.roots ?? [],
  };
  // Absent on disk reads back as the default era; the write side then omits the
  // default so a byte-stable round-trip never injects `protocolEra` into files
  // that never set it. An unknown literal from a hand-edited file is dropped
  // (→ default legacy) rather than passed through to `eraToVersionNegotiation`.
  if (isProtocolEra(stored.protocolEra)) {
    settings.protocolEra = stored.protocolEra;
  }
  // Like `protocolEra`: absent reads back as the default modern log level (the
  // form defaults via `?? DEFAULT_MODERN_LOG_LEVEL`), and an unknown literal from
  // a hand-edited file is dropped rather than surfaced.
  if (isModernLogLevel(stored.modernLogLevel)) {
    settings.modernLogLevel = stored.modernLogLevel;
  }
  // Optional map with no default; carried through only when the file has a
  // non-empty object. An absent/empty field reads back as unset, which the
  // write side then omits — keeping a byte-stable round-trip.
  if (
    stored.advertisedExtensions &&
    Object.keys(stored.advertisedExtensions).length > 0
  ) {
    settings.advertisedExtensions = { ...stored.advertisedExtensions };
  }
  // Truthiness drops empty-string OAuth fields — mirrors the write-side
  // coercion in `validateSettings` (server.ts) so a round-trip can't
  // accidentally surface `oauthClientId: ""` to the form, where the
  // OAuth manager would misread it as "configured."
  if (stored.oauth?.clientId) settings.oauthClientId = stored.oauth.clientId;
  if (stored.oauth?.clientSecret)
    settings.oauthClientSecret = stored.oauth.clientSecret;
  if (stored.oauth?.scopes) settings.oauthScopes = stored.oauth.scopes;
  // Optional record with no default; carried through only when the file has a
  // non-empty object, so an absent/empty field reads back as unset and the
  // write side then omits it — keeping a byte-stable round-trip. Sanitized
  // rather than trusted: only the web client's `/api/servers` route validates
  // this field, while the CLI/TUI read `mcp.json` straight off disk. (#2018)
  const authorizationParams = cleanAuthorizationParams(
    stored.oauth?.authorizationParams,
  );
  if (authorizationParams) {
    settings.oauthAuthorizationParams = envRecordToPairs(authorizationParams);
  }
  // Truthiness drops empty strings like the credential fields above, so a
  // cleared field reads back as unset rather than as an empty override. The
  // `string` type is a compile-time promise a hand-edited `mcp.json` does not
  // keep, and only the web client's `/api/servers` route checks it — the CLI and
  // TUI read the file directly and then call `.trim()` on these in
  // `oauthEndpointOverridesFromSettings`, so a non-string would crash the server
  // load. Sanitized like `authorizationParams` above rather than trusted.
  // (#1906)
  const authorizationUrl = cleanEndpointOverride(
    stored.oauth?.authorizationUrl,
    "authorizationUrl",
  );
  if (authorizationUrl) settings.oauthAuthorizationUrl = authorizationUrl;
  const tokenUrl = cleanEndpointOverride(stored.oauth?.tokenUrl, "tokenUrl");
  if (tokenUrl) settings.oauthTokenUrl = tokenUrl;
  if (stored.oauth?.onInsufficientScope) {
    settings.oauthOnInsufficientScope = stored.oauth.onInsufficientScope;
  }
  if (stored.oauth?.enterpriseManaged === true) {
    settings.enterpriseManaged = true;
  }
  // Inverted from the flags above: the default is *on*, so only an explicit
  // `false` is carried through. Anything else on disk (absent, or a
  // hand-edited non-boolean) reads back as unset, i.e. the default. (#2068)
  if (stored.oauth?.requestRefreshToken === false) {
    settings.oauthRequestRefreshToken = false;
  }
  // Same inverted default as the flag above: revocation is on unless the entry
  // explicitly opted out. (#2144)
  if (stored.oauth?.revokeOnClear === false) {
    settings.oauthRevokeOnClear = false;
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

  // Blank-key entries can't exist in the object form (an object has no blank
  // key the user can leave mid-edit, the way a `{key,value}` row could), so
  // there is nothing to filter — only the empty-object case to omit.
  if (Object.keys(settings.metadata).length > 0) {
    out.metadata = settings.metadata;
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

  // Persist only when enabled — absent reads back as false (above).
  if (settings.paginatedLists) {
    out.paginatedLists = true;
  }

  // Persist only when the user has toggled at least one extension override;
  // an empty map reads back as unset (above), keeping the diff minimal for the
  // common (no-override) case.
  if (
    settings.advertisedExtensions &&
    Object.keys(settings.advertisedExtensions).length > 0
  ) {
    out.advertisedExtensions = { ...settings.advertisedExtensions };
  }

  // Persist only when it differs from the default era. Absent reads back as
  // DEFAULT_PROTOCOL_ERA, so writing the default would inject the field into
  // hand-edited files that never had it and break byte-stable round-trips.
  if (
    settings.protocolEra !== undefined &&
    settings.protocolEra !== DEFAULT_PROTOCOL_ERA
  ) {
    out.protocolEra = settings.protocolEra;
  }

  // Persist only when it differs from the default modern log level; absent reads
  // back as DEFAULT_MODERN_LOG_LEVEL, so writing the default would inject the
  // field into files that never set it and break byte-stable round-trips.
  if (
    settings.modernLogLevel !== undefined &&
    settings.modernLogLevel !== DEFAULT_MODERN_LOG_LEVEL
  ) {
    out.modernLogLevel = settings.modernLogLevel;
  }

  // Persist only when it differs from the default. Unlike the timeouts, 0 is a
  // meaningful value here (unlimited), so the omit-sentinel is the default
  // itself rather than 0 — writing the default would inject the field into
  // hand-edited files that never had it and break byte-stable round-trips.
  if (settings.maxFetchRequests !== DEFAULT_MAX_FETCH_REQUESTS) {
    out.maxFetchRequests = settings.maxFetchRequests;
  }

  const oauthFields: NonNullable<StoredMCPServer["oauth"]> = {};
  if (settings.oauthClientId) oauthFields.clientId = settings.oauthClientId;
  if (settings.oauthClientSecret)
    oauthFields.clientSecret = settings.oauthClientSecret;
  if (settings.oauthScopes) oauthFields.scopes = settings.oauthScopes;
  // Blank-key rows (a row the user added but never filled in) are dropped, so
  // an all-blank list writes nothing — matching the read side's omit-on-empty.
  if (settings.oauthAuthorizationParams) {
    const authParams = envPairsToRecord(settings.oauthAuthorizationParams);
    if (Object.keys(authParams).length > 0) {
      oauthFields.authorizationParams = authParams;
    }
  }
  // Empty/blank reads back as unset (above), so a cleared field writes nothing
  // and the file diff stays minimal for servers that never set one. (#1906)
  if (settings.oauthAuthorizationUrl?.trim()) {
    oauthFields.authorizationUrl = settings.oauthAuthorizationUrl.trim();
  }
  if (settings.oauthTokenUrl?.trim()) {
    oauthFields.tokenUrl = settings.oauthTokenUrl.trim();
  }
  if (settings.oauthOnInsufficientScope) {
    oauthFields.onInsufficientScope = settings.oauthOnInsufficientScope;
  }
  if (settings.enterpriseManaged === true) {
    oauthFields.enterpriseManaged = true;
  }
  // Only the non-default (off) is written; an absent field reads back as the
  // default (on), so writing `true` would inject the key into files that never
  // set it and break byte-stable round-trips. (#2068)
  if (settings.oauthRequestRefreshToken === false) {
    oauthFields.requestRefreshToken = false;
  }
  // Same omit-the-default rule as the flag above. (#2144)
  if (settings.oauthRevokeOnClear === false) {
    oauthFields.revokeOnClear = false;
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
  protocolEra: true,
  modernLogLevel: true,
  connectionTimeout: true,
  requestTimeout: true,
  taskTtl: true,
  autoRefreshOnListChanged: true,
  paginatedLists: true,
  advertisedExtensions: true,
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
 *
 * Every Inspector-extension key is optional on `StoredMCPServer`, so deleting
 * them off a clone leaves a value still typed as (a subtype of)
 * `MCPServerConfig` — no cast needed.
 */
export function stripInspectorFields(stored: StoredMCPServer): MCPServerConfig {
  const out = { ...stored };
  for (const key of INSPECTOR_FIELD_KEYS) {
    delete out[key];
  }
  return out;
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
    // Partition the entry's keys into Inspector-extension vs SDK-only. Both
    // `raw` and `inspectorFields` are widened through `toRecord` (see its doc)
    // so the generic key iteration/assignment needs no per-site cast.
    const inspectorRecord = toRecord(inspectorFields);
    for (const [k, v] of Object.entries(toRecord(raw))) {
      if (INSPECTOR_FIELD_KEYS.has(k as keyof StoredInspectorFields)) {
        inspectorRecord[k] = v;
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
    // Keep every OAuth field except the one secret, rather than enumerating the
    // non-secret ones. An allow-list here is a standing trap: it silently drops
    // any field added to `oauth` afterwards, and it had already done so —
    // `onInsufficientScope` was lost whenever a server carried both a client
    // secret and a non-default SEP-2350 policy. Subtracting the secret instead
    // means a future field is preserved by construction. (#2018)
    const { clientSecret: _clientSecret, ...restOauth } = stored.oauth;
    if (Object.keys(restOauth).length > 0) {
      stripped.oauth = restOauth;
    } else {
      delete stripped.oauth;
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
 * Public MCP org demo server seeded as the remote example (#2201). It is the
 * feature-reference server the MCP org hosts, so pointing a shipped default at
 * it keeps the seed in-org rather than at a third-party endpoint.
 *
 * Its authorization server advertises Dynamic Client Registration and fronts a
 * *mock* upstream IdP, so the whole OAuth round trip completes with no account,
 * no API key and no pre-registered client — which is what makes it usable as a
 * seed at all. Everything it exposes is synthetic reference data.
 */
export const EXAMPLE_SERVER_URL =
  "https://example-server.modelcontextprotocol.io/mcp";

/**
 * Default seeds written to `~/.mcp-inspector/mcp.json` on first launch when
 * the file is absent. Picked to cover the three shapes a developer reaches for
 * first: a real filesystem scoped to /tmp, the canonical "everything"
 * reference server, and a remote Streamable HTTP server behind OAuth.
 *
 * The remote seed carries no `protocolEra`, so it connects under
 * `DEFAULT_PROTOCOL_ERA` (`"legacy"`) like every other entry that omits the
 * field. That matches the server, which answers the plain `initialize`
 * handshake at 2025-11-25 and rejects `server/discover` — it has no modern
 * (SEP-2663) era to negotiate, so `"auto"` would only cost a failed probe and
 * `"modern"` would fail the connection outright.
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
    "example-server-default": {
      type: "streamable-http",
      url: EXAMPLE_SERVER_URL,
    },
  },
};
