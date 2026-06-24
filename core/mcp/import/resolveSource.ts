/**
 * Resolve an import source (#1348): walk a strategy's well-known paths, read the
 * first that exists, and parse it into the canonical `MCPConfig`. Kept pure by
 * dependency injection — `platform`, `homeDir`, and a `readFile` reader are
 * passed in — so it's fully unit-testable without touching the real filesystem
 * or home directory. The Node backend route supplies `process.platform`,
 * `os.homedir()`, and an `fs`-backed reader.
 */
import type { ImportSourceResult } from "./types.js";
import { getImportStrategy } from "./strategies.js";

/**
 * Read a file's contents, or return `null` when the path does not exist. Throw
 * to signal a genuine read failure (permission denied, etc.) — that surfaces as
 * `{ found: true, error }` so the UI can offer the file-upload fallback.
 */
export type ImportFileReader = (path: string) => string | null;

/**
 * Resolve a strategy's well-known config into an `ImportSourceResult`. Returns
 * `null` for an unknown strategy id so the caller can map it to a 400. The first
 * existing path wins; a read or parse failure short-circuits with an `error`.
 */
export function resolveImportSource(
  type: string,
  platform: NodeJS.Platform,
  homeDir: string,
  readFile: ImportFileReader,
): ImportSourceResult | null {
  const strategy = getImportStrategy(type);
  if (!strategy) return null;
  const searched = strategy.defaultPaths(platform, homeDir);
  for (const path of searched) {
    let raw: string | null;
    try {
      raw = readFile(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type,
        found: true,
        path,
        error: `Failed to read ${path}: ${msg}`,
        searched,
      };
    }
    if (raw === null) continue;
    try {
      const config = strategy.parse(raw);
      return { type, found: true, path, config, searched };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { type, found: true, path, error: msg, searched };
    }
  }
  return { type, found: false, searched };
}
