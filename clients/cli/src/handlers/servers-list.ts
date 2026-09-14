import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";
import {
  loadServerEntries,
  selectServerEntry,
  type ServerLoadOptions,
} from "@inspector/core/mcp/node/index.js";

/** One catalog/config entry as returned by `servers/list`. */
export type ServerListEntry = {
  name: string;
  type: string;
  /** Command line, URL, or other short identity for display. */
  detail: string;
  /**
   * Optional live-session name when a caller annotates catalog entries
   * with connected sessions (omitted for plain catalog listing).
   */
  session?: string;
  /** True when that session is the most-recently-used connected session. */
  isMru?: boolean;
};

/** Minimal session shape needed to annotate catalog entries. */
export type SessionListRef = {
  name: string;
  isMru?: boolean;
};

/**
 * Mark catalog entries that have a live session with the same name.
 * Does not mutate `entries`.
 *
 * TODO(#1432): consumed by the experimental session CLI (`mcpi`); kept here so
 * that client can reuse catalog listing without duplicating this helper.
 */
export function annotateServerEntriesWithSessions(
  entries: ServerListEntry[],
  sessions: SessionListRef[],
): ServerListEntry[] {
  if (sessions.length === 0) return entries;
  const byName = new Map(sessions.map((s) => [s.name, s] as const));
  return entries.map((entry) => {
    const session = byName.get(entry.name);
    if (!session) return entry;
    return {
      ...entry,
      session: session.name,
      ...(session.isMru === true ? { isMru: true } : {}),
    };
  });
}

/** Detail view for `servers/show` (secrets redacted). */
export type ServerShowEntry = {
  name: string;
  type: string;
  detail: string;
  config: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

const REDACTED = "[redacted]";

/**
 * Summarise an {@link MCPServerConfig} for catalog listing (no connection).
 */
export function summarizeServerConfig(config: MCPServerConfig): {
  type: string;
  detail: string;
} {
  // Narrow on the URL-bearing transports first — stdio's `type` is optional, so
  // an else-after-`=== "stdio"` check would still leave `StdioServerConfig` in
  // the residual union (see `StdioServerConfig` in core/mcp/types.ts).
  if (config.type === "sse" || config.type === "streamable-http") {
    return { type: config.type, detail: config.url ?? "" };
  }
  const args = config.args?.length ? ` ${config.args.join(" ")}` : "";
  return { type: "stdio", detail: `${config.command}${args}` };
}

/**
 * Load catalog/config entries and return a sorted name + summary list.
 * Uses an empty in-memory secret store by default so listing never touches the
 * OS keychain (names/types/details do not need rehydrated secrets).
 */
export async function listServerEntries(
  serverOptions: ServerLoadOptions = {},
): Promise<ServerListEntry[]> {
  const entries = await loadServerEntries({
    ...serverOptions,
    secretStore: serverOptions.secretStore ?? new InMemorySecretStore(),
  });
  return Object.entries(entries)
    .map(([name, resolved]) => {
      const { type, detail } = summarizeServerConfig(resolved.config);
      return { name, type, detail };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve one catalog/config entry for `servers/show` (no MCP connection).
 * Secret-bearing fields (env values, OAuth client secret, sensitive headers)
 * are replaced with {@link REDACTED}.
 */
export async function showServerEntry(
  serverName: string,
  serverOptions: ServerLoadOptions = {},
): Promise<ServerShowEntry> {
  const name = serverName.trim();
  if (!name) {
    throw new Error("servers/show requires a server name.");
  }
  const entries = await loadServerEntries(serverOptions);
  const selected = selectServerEntry(entries, name);
  const { type, detail } = summarizeServerConfig(selected.config);
  const result: ServerShowEntry = {
    name,
    type,
    detail,
    config: sanitizeServerConfig(selected.config),
  };
  if (selected.settings) {
    result.settings = sanitizeServerSettings(selected.settings);
  }
  return result;
}

/** Visible for tests. */
export function sanitizeServerConfig(
  config: MCPServerConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  if ("env" in config && config.env) {
    out.env = redactStringRecord(config.env);
  }
  if ("requestInit" in config && isPlainObject(config.requestInit)) {
    out.requestInit = sanitizeInitRecord(config.requestInit);
  }
  if ("eventSourceInit" in config && isPlainObject(config.eventSourceInit)) {
    out.eventSourceInit = sanitizeInitRecord(config.eventSourceInit);
  }
  return out;
}

/** Visible for tests. */
export function sanitizeServerSettings(
  settings: InspectorServerSettings,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...settings,
    headers: (settings.headers ?? []).map((h) => ({
      key: h.key,
      value: isSensitiveHeader(h.key) ? REDACTED : h.value,
    })),
    // Metadata values may be any JSON (#1910), so the redaction has to descend:
    // a top-level key that is not itself sensitive can hold a nested one that
    // is. See `redactMetadataValue`.
    metadata: redactMetadataValue(settings.metadata ?? {}),
    env: (settings.env ?? []).map((e) => ({
      key: e.key,
      value: REDACTED,
    })),
  };
  if (settings.oauthClientSecret !== undefined) {
    out.oauthClientSecret = REDACTED;
  }
  return out;
}

function redactStringRecord(
  record: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Redact sensitive header values inside requestInit / eventSourceInit. */
function sanitizeInitRecord(
  init: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...init };
  if (isPlainObject(init.headers)) {
    out.headers = Object.fromEntries(
      Object.entries(init.headers).map(([key, value]) => [
        key,
        isSensitiveHeader(key) ? REDACTED : value,
      ]),
    );
  } else if (Array.isArray(init.headers)) {
    // HeadersInit pair form: [["Authorization", "Bearer …"], …]
    out.headers = init.headers.map((entry) => {
      if (
        Array.isArray(entry) &&
        entry.length >= 2 &&
        typeof entry[0] === "string"
      ) {
        const key = entry[0];
        const value = entry[1];
        return [key, isSensitiveHeader(key) ? REDACTED : value];
      }
      return entry;
    });
  }
  return out;
}

/**
 * Redact secret-bearing entries anywhere inside a `_meta` payload.
 *
 * The pre-#1910 version only had to check the top level, because a value was
 * always a string — a secret could not hide below one. Now that a value may be
 * an object or an array, `{ trace: { accessToken: "…" } }` would sail through a
 * top-level-only check: `trace` is not sensitive, so the whole subtree,
 * `accessToken` included, would print. `servers/show` output is meant to be
 * safe to paste into an issue, so the walk has to reach every key.
 *
 * A key matching {@link isSensitiveHeader} replaces its **entire** value rather
 * than being descended into, so a sensitive key holding an object cannot leak
 * through its members either. Arrays are mapped elementwise: their indices are
 * not names anyone can mark sensitive, but objects inside them can be.
 *
 * Recursion is bounded by the payload, which came from `JSON.parse` and so is a
 * finite tree with no cycles.
 */
function redactMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMetadataValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        isSensitiveHeader(key) ? REDACTED : redactMetadataValue(member),
      ]),
    );
  }
  return value;
}

function isSensitiveHeader(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("auth") ||
    k.includes("cookie") ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("password") ||
    k.includes("api-key") ||
    k.includes("apikey")
  );
}
