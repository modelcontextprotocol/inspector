/**
 * Strategy-agnostic merge helpers (#1348). Operate purely on the canonical
 * `MCPConfig` a strategy produces, so they don't care which client the servers
 * came from. The UI uses `planImport` to split incoming servers into
 * conflict-free additions vs. id collisions, then drives the per-conflict
 * resolution (overwrite / skip / rename) and calls the add/update endpoints.
 */
import type { MCPConfig, StoredMCPServer } from "../types.js";

/** How the user chose to resolve a single id collision. */
export type ConflictResolution = "overwrite" | "skip" | "rename";

/** One incoming server whose id already exists in the current catalog. */
export interface ImportConflict {
  id: string;
  config: StoredMCPServer;
}

/** One incoming server whose id is free to add as-is. */
export interface ImportAddition {
  id: string;
  config: StoredMCPServer;
}

export interface ImportPlan {
  /** Servers whose ids are not yet taken — safe to add directly. */
  additions: ImportAddition[];
  /** Servers whose ids collide with an existing one — need a resolution. */
  conflicts: ImportConflict[];
}

/**
 * Split an incoming config into conflict-free additions and id collisions
 * against the set of ids already present. Order of the source map is preserved.
 */
export function planImport(
  incoming: MCPConfig,
  existingIds: readonly string[],
): ImportPlan {
  const taken = new Set(existingIds);
  const additions: ImportAddition[] = [];
  const conflicts: ImportConflict[] = [];
  for (const [id, config] of Object.entries(incoming.mcpServers)) {
    if (taken.has(id)) conflicts.push({ id, config });
    else additions.push({ id, config });
  }
  return { additions, conflicts };
}

/**
 * Produce an id derived from `base` that isn't in `taken`. Tries `base`,
 * `base-2`, `base-3`, … and sanitizes `base` to the allowed id charset
 * (`[A-Za-z0-9_-]`) first so a renamed id always validates server-side.
 */
export function uniqueId(base: string, taken: readonly string[]): string {
  const takenSet = new Set(taken);
  const cleaned =
    base.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "server";
  if (!takenSet.has(cleaned)) return cleaned;
  for (let n = 2; ; n++) {
    const candidate = `${cleaned}-${n}`;
    if (!takenSet.has(candidate)) return candidate;
  }
}
