import { describe, it, expect } from "vitest";
import { resolveImportSource } from "@inspector/core/mcp/import/resolveSource.js";

const HOME = "/home/alice";
const cursorPath = "/home/alice/.cursor/mcp.json";

describe("resolveImportSource", () => {
  it("returns null for an unknown strategy id", () => {
    expect(resolveImportSource("bogus", "linux", HOME, () => null)).toBeNull();
  });

  it("returns found:false with the searched paths when no file exists", () => {
    const result = resolveImportSource("cursor", "linux", HOME, () => null);
    expect(result).toEqual({
      type: "cursor",
      found: false,
      searched: [cursorPath],
    });
  });

  it("parses the first existing well-known path", () => {
    const raw = JSON.stringify({ mcpServers: { s: { command: "node" } } });
    const result = resolveImportSource("cursor", "linux", HOME, (p) =>
      p === cursorPath ? raw : null,
    );
    expect(result).toMatchObject({
      type: "cursor",
      found: true,
      path: cursorPath,
    });
    expect(result?.config?.mcpServers.s.type).toBe("stdio");
  });

  it("walks to the second path when the first does not exist (Cline)", () => {
    const fallback = "/home/alice/Documents/Cline/MCP/cline_mcp_settings.json";
    const raw = JSON.stringify({ mcpServers: { c: { command: "node" } } });
    const result = resolveImportSource("cline", "linux", HOME, (p) =>
      p === fallback ? raw : null,
    );
    expect(result?.found).toBe(true);
    expect(result?.path).toBe(fallback);
  });

  it("returns found:true with an error when the file will not parse", () => {
    const result = resolveImportSource(
      "cursor",
      "linux",
      HOME,
      () => "{not json",
    );
    expect(result?.found).toBe(true);
    expect(result?.path).toBe(cursorPath);
    expect(result?.error).toMatch(/Invalid JSON/);
    expect(result?.config).toBeUndefined();
  });

  it("returns found:true with a read error when the reader throws", () => {
    const result = resolveImportSource("cursor", "linux", HOME, () => {
      throw new Error("EACCES");
    });
    expect(result?.found).toBe(true);
    expect(result?.error).toMatch(/Failed to read .*EACCES/);
  });
});
