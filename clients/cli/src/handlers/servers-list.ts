import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
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
   * Live session name when a daemon session’s name matches this entry
   * (session CLI only; omitted on one-shot).
   */
  session?: string;
  /** True when that session is the daemon MRU. */
  isMru?: boolean;
};

/** Minimal session shape needed to annotate catalog entries. */
export type SessionListRef = {
  name: string;
  isMru?: boolean;
};

/**
 * Mark catalog entries that have a live session with the same name
 * (`mcpi connect <entry>` default). Does not mutate `entries`.
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
    return { type: config.type, detail: config.url };
  }
  const args = config.args?.length ? ` ${config.args.join(" ")}` : "";
  return { type: "stdio", detail: `${config.command}${args}` };
}

/**
 * Load catalog/config entries and return a sorted name + summary list.
 * Shared by one-shot `--method servers/list` and `mcpi servers/list`.
 */
export async function listServerEntries(
  serverOptions: ServerLoadOptions = {},
): Promise<ServerListEntry[]> {
  const entries = await loadServerEntries(serverOptions);
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
    headers: settings.headers.map((h) => ({
      key: h.key,
      value: isSensitiveHeader(h.key) ? REDACTED : h.value,
    })),
    env: settings.env.map((e) => ({
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

function isSensitiveHeader(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "authorization" ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("password") ||
    k.includes("api-key") ||
    k.includes("apikey")
  );
}
