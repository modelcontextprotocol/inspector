/**
 * Pure converters between the on-disk `mcp.json` shape (`MCPConfig`) and the
 * in-memory list of `ServerEntry` records the UI consumes. No I/O, no Node
 * deps — safe to import from the browser side of core/ as well as the
 * remote-server route handlers.
 */

import type {
  MCPConfig,
  MCPServerConfig,
  ServerEntry,
  ServerType,
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
 * Convert the on-disk `MCPConfig` into the `ServerEntry[]` the Servers screen
 * consumes. Map key becomes both `id` and `name`. Connection state initializes
 * to `disconnected` — the React layer drives it from there.
 */
export function mcpConfigToServerEntries(config: MCPConfig): ServerEntry[] {
  return Object.entries(config.mcpServers).map(([id, raw]) => ({
    id,
    name: id,
    config: normalizeServerType(
      raw as unknown as Record<string, unknown> & { type?: string },
    ),
    connection: { status: "disconnected" },
  }));
}

/**
 * Convert `ServerEntry[]` back into `MCPConfig` for serialization. Strips
 * runtime-only fields (connection, info, name) — only id and config make it
 * to disk so the file stays a clean canonical `mcp.json`.
 */
export function serverEntriesToMcpConfig(entries: ServerEntry[]): MCPConfig {
  const mcpServers: Record<string, MCPServerConfig> = {};
  for (const entry of entries) {
    mcpServers[entry.id] = entry.config;
  }
  return { mcpServers };
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
