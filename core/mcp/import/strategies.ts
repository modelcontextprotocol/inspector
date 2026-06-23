/**
 * Registry of import strategies (#1348). Each entry knows its well-known
 * config locations per platform and how to parse that client's file into the
 * canonical `MCPConfig`. The source picker enumerates `IMPORT_STRATEGY_LIST`;
 * the backend `GET /api/import-source` route and the browser file-upload path
 * both resolve a strategy via `getImportStrategy(id)`.
 *
 * Adding a new client = add one entry here (+ a fixture test). Clients that use
 * the standard `{ mcpServers: {...} }` shape reuse `parseMcpServersConfig` and
 * only differ by `defaultPaths`; VS Code's `servers`/`inputs` variant gets its
 * own `parseVsCodeConfig`.
 *
 * Pure + isomorphic: `defaultPaths` receives `platform` + `homeDir` so this file
 * never imports Node `os`/`path`. Paths are joined with `/`, which Node `fs`
 * accepts on every platform.
 */
import type { ImportStrategy } from "./types.js";
import { parseMcpServersConfig, parseVsCodeConfig } from "./clientConfig.js";

/** Join path segments with `/`, trimming a trailing slash on the base. */
function join(...segments: string[]): string {
  return segments
    .map((s, i) =>
      i === 0 ? s.replace(/\/+$/, "") : s.replace(/^\/+|\/+$/g, ""),
    )
    .filter((s) => s.length > 0)
    .join("/");
}

/** Windows `%APPDATA%` (Roaming) under the user's home directory. */
function appData(homeDir: string): string {
  return join(homeDir, "AppData", "Roaming");
}

/**
 * Per-platform application-support directory for a given app folder name.
 * macOS: `~/Library/Application Support/<app>`; Windows: `%APPDATA%\<app>`;
 * Linux/other: `~/.config/<app>`.
 */
function appSupportDir(
  platform: NodeJS.Platform,
  homeDir: string,
  app: string,
): string {
  if (platform === "darwin") {
    return join(homeDir, "Library", "Application Support", app);
  }
  if (platform === "win32") {
    return join(appData(homeDir), app);
  }
  return join(homeDir, ".config", app);
}

const claudeDesktop: ImportStrategy = {
  id: "claude-desktop",
  label: "Claude Desktop",
  defaultPaths: (platform, homeDir) => [
    join(
      appSupportDir(platform, homeDir, "Claude"),
      "claude_desktop_config.json",
    ),
  ],
  parse: parseMcpServersConfig,
};

const cursor: ImportStrategy = {
  id: "cursor",
  label: "Cursor",
  defaultPaths: (_platform, homeDir) => [join(homeDir, ".cursor", "mcp.json")],
  parse: parseMcpServersConfig,
};

const cline: ImportStrategy = {
  id: "cline",
  label: "Cline",
  defaultPaths: (platform, homeDir) => [
    // Cline (VS Code extension) global settings live under the editor's
    // globalStorage; the documented cross-platform fallback is ~/Documents.
    join(
      appSupportDir(platform, homeDir, "Code"),
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    ),
    join(homeDir, "Documents", "Cline", "MCP", "cline_mcp_settings.json"),
  ],
  parse: parseMcpServersConfig,
};

const vscode: ImportStrategy = {
  id: "vscode",
  label: "VS Code",
  defaultPaths: (platform, homeDir) => [
    join(appSupportDir(platform, homeDir, "Code"), "User", "mcp.json"),
  ],
  parse: parseVsCodeConfig,
};

/** All strategies in source-picker display order. */
export const IMPORT_STRATEGY_LIST: readonly ImportStrategy[] = [
  claudeDesktop,
  cursor,
  cline,
  vscode,
];

/** Map of `id → ImportStrategy` for resolution. */
export const IMPORT_STRATEGIES: Readonly<Record<string, ImportStrategy>> =
  Object.fromEntries(IMPORT_STRATEGY_LIST.map((s) => [s.id, s]));

/** Resolve a strategy by id, or undefined for an unknown id. */
export function getImportStrategy(id: string): ImportStrategy | undefined {
  return IMPORT_STRATEGIES[id];
}
