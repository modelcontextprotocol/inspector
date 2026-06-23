/**
 * Import strategy pattern (#1348). Each strategy knows how to identify itself,
 * provide platform-aware well-known locations for another MCP client's config
 * file, and parse that file's raw contents into the canonical Inspector
 * `MCPConfig` (`{ mcpServers: { ... } }`) shape.
 *
 * Everything here is pure and isomorphic — no Node `fs`/`os`/`path` imports — so
 * it can be reused by the browser (file-upload parse), the web backend
 * (well-known-path read), and any future CLI/TUI import. The Node-only pieces
 * (resolving the home dir, reading the file) live in the backend route that
 * consumes these strategies; `defaultPaths` takes `platform` + `homeDir` as
 * inputs rather than reaching for `os.homedir()` itself.
 */
import type { MCPConfig } from "../types.js";

/**
 * A single importable source (Claude Desktop, Cursor, Cline, VS Code, …). The
 * registry in `strategies.ts` maps `id → ImportStrategy`; the source picker
 * enumerates the registry and the import flow resolves against it. Adding a new
 * client is a small, isolated unit of work: add one strategy + register it.
 */
export interface ImportStrategy {
  /** Stable id used by the source picker and the backend `?type=` query. */
  id: string;
  /** Human-readable label shown in the source picker. */
  label: string;
  /**
   * Platform-aware well-known locations, in priority order. Pure: the caller
   * supplies the running platform and the user's home directory so this never
   * touches Node APIs. Paths are joined with `/`, which Node's `fs` accepts on
   * every platform (including Windows).
   */
  defaultPaths(platform: NodeJS.Platform, homeDir: string): string[];
  /**
   * Parse raw file contents into the canonical `MCPConfig`. Throws on malformed
   * input (bad JSON, missing server map) — callers surface the message.
   */
  parse(raw: string): MCPConfig;
}

/**
 * Response shape for `GET /api/import-source?type=<id>`. `found` is false when
 * none of the strategy's well-known paths exist on the backend host; `error` is
 * set when a path was found but its contents could not be parsed (so the UI can
 * offer the file-upload fallback instead of silently showing nothing).
 */
export interface ImportSourceResult {
  /** The strategy id that was resolved. */
  type: string;
  /** True when one of the well-known paths existed and was read. */
  found: boolean;
  /** The path that was read (only when `found`). */
  path?: string;
  /** Parsed canonical config (only when `found` and parse succeeded). */
  config?: MCPConfig;
  /** Parse error message (only when `found` but parse failed). */
  error?: string;
  /** The well-known paths that were searched, in priority order. */
  searched: string[];
}
