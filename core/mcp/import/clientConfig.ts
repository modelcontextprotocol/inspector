/**
 * Parsers that turn another MCP client's config file into the canonical
 * Inspector `MCPConfig`. Pure + isomorphic (no Node deps).
 *
 * Two shapes are handled:
 *  - the common `{ mcpServers: { ... } }` shape used by Claude Desktop, Cursor,
 *    Cline, Claude Code (`parseMcpServersConfig`);
 *  - VS Code's native MCP shape with a top-level `servers` map (and an optional
 *    `inputs` array we ignore) (`parseVsCodeConfig`).
 *
 * Both delegate per-server normalization to `normalizeServerType` so a missing
 * `type` defaults to `stdio` and the `http` alias maps to `streamable-http`,
 * matching how Inspector reads its own `mcp.json`.
 */
import type { MCPConfig, StoredMCPServer } from "../types.js";
import { normalizeServerType } from "../serverList.js";

/** Parse JSON, throwing a uniform, human-readable message on failure. */
function parseJsonObject(raw: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON: ${detail}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected a JSON object at the top level");
  }
  return data as Record<string, unknown>;
}

/**
 * Normalize a raw server map (`Record<id, rawConfig>`) into canonical
 * `mcpServers`. Non-object entries are skipped (a hand-edited file can carry a
 * `null` or a stray scalar); each surviving entry has its `type` normalized and
 * any Inspector-extension fields preserved as-is on the `StoredMCPServer`.
 */
function normalizeServerMap(
  servers: Record<string, unknown>,
): Record<string, StoredMCPServer> {
  const out: Record<string, StoredMCPServer> = {};
  for (const [id, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const normalized = normalizeServerType(
      raw as Record<string, unknown> & { type?: unknown },
    );
    // Carry through any extra keys (headers, env, oauth, …) the source file
    // had; normalizeServerType already spreads them, we just widen the type.
    out[id] = normalized as StoredMCPServer;
  }
  return out;
}

/**
 * Parse the common `{ mcpServers: { ... } }` config shape. Used by Claude
 * Desktop, Cursor, Cline, and Claude Code. Throws when no `mcpServers` object
 * is present.
 */
export function parseMcpServersConfig(raw: string): MCPConfig {
  const data = parseJsonObject(raw);
  const servers = data.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("No 'mcpServers' object found in config file");
  }
  return {
    mcpServers: normalizeServerMap(servers as Record<string, unknown>),
  };
}

/**
 * Parse VS Code's native MCP config, which uses a top-level `servers` map
 * instead of `mcpServers` (and an optional `inputs` array of prompt
 * placeholders we don't import — the `${input:…}` references are left intact in
 * the server entries for the user to resolve via the edit form). Throws when no
 * `servers` object is present.
 */
export function parseVsCodeConfig(raw: string): MCPConfig {
  const data = parseJsonObject(raw);
  const servers = data.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("No 'servers' object found in VS Code config file");
  }
  return {
    mcpServers: normalizeServerMap(servers as Record<string, unknown>),
  };
}
