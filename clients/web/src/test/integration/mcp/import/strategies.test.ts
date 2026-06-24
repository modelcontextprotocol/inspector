import { describe, it, expect } from "vitest";
import {
  IMPORT_STRATEGIES,
  IMPORT_STRATEGY_LIST,
  getImportStrategy,
} from "@inspector/core/mcp/import/strategies.js";

const HOME = "/home/alice";

describe("import strategy registry", () => {
  it("exposes claude-desktop, cursor, cline, and vscode", () => {
    expect(IMPORT_STRATEGY_LIST.map((s) => s.id)).toEqual([
      "claude-desktop",
      "cursor",
      "cline",
      "vscode",
    ]);
  });

  it("resolves strategies by id and returns undefined for unknown", () => {
    expect(getImportStrategy("cursor")?.label).toBe("Cursor");
    expect(getImportStrategy("nope")).toBeUndefined();
    expect(IMPORT_STRATEGIES["vscode"].label).toBe("VS Code");
  });

  it("delegates parse to the shared mcpServers parser for standard clients", () => {
    const raw = JSON.stringify({ mcpServers: { s: { command: "node" } } });
    const config = getImportStrategy("claude-desktop")!.parse(raw);
    expect(config.mcpServers.s.type).toBe("stdio");
  });

  it("delegates parse to the VS Code parser for vscode", () => {
    const raw = JSON.stringify({ servers: { s: { command: "node" } } });
    const config = getImportStrategy("vscode")!.parse(raw);
    expect(config.mcpServers.s.type).toBe("stdio");
  });
});

describe("platform-aware default paths", () => {
  it("Claude Desktop per platform", () => {
    expect(
      getImportStrategy("claude-desktop")!.defaultPaths("darwin", HOME),
    ).toEqual([
      "/home/alice/Library/Application Support/Claude/claude_desktop_config.json",
    ]);
    expect(
      getImportStrategy("claude-desktop")!.defaultPaths("linux", HOME),
    ).toEqual(["/home/alice/.config/Claude/claude_desktop_config.json"]);
    expect(
      getImportStrategy("claude-desktop")!.defaultPaths(
        "win32",
        "C:/Users/alice",
      ),
    ).toEqual([
      "C:/Users/alice/AppData/Roaming/Claude/claude_desktop_config.json",
    ]);
  });

  it("Cursor is home-relative on every platform", () => {
    expect(getImportStrategy("cursor")!.defaultPaths("darwin", HOME)).toEqual([
      "/home/alice/.cursor/mcp.json",
    ]);
  });

  it("Cline lists the editor globalStorage path then the Documents fallback", () => {
    const paths = getImportStrategy("cline")!.defaultPaths("darwin", HOME);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain(
      "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    );
    expect(paths[1]).toBe(
      "/home/alice/Documents/Cline/MCP/cline_mcp_settings.json",
    );
  });

  it("VS Code native mcp.json per platform", () => {
    expect(getImportStrategy("vscode")!.defaultPaths("linux", HOME)).toEqual([
      "/home/alice/.config/Code/User/mcp.json",
    ]);
    expect(getImportStrategy("vscode")!.defaultPaths("darwin", HOME)).toEqual([
      "/home/alice/Library/Application Support/Code/User/mcp.json",
    ]);
  });
});
