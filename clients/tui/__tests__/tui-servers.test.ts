import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTuiServers } from "../src/tui-servers.js";

describe("loadTuiServers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tui-servers-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads named servers from a read-only --config file", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: { foo: { command: "node", args: ["foo.js"] } },
      }),
    );
    const servers = loadTuiServers({ configPath });
    expect(Object.keys(servers)).toEqual(["foo"]);
    expect(servers.foo?.config).toMatchObject({
      type: "stdio",
      command: "node",
    });
  });

  it("seeds an empty writable catalog when --catalog is missing", () => {
    const catalogPath = join(tempDir, "catalog.json");
    const servers = loadTuiServers({ catalogPath });
    expect(servers).toEqual({});
    expect(existsSync(catalogPath)).toBe(true);
    expect(JSON.parse(readFileSync(catalogPath, "utf-8"))).toEqual({
      mcpServers: {},
    });
  });

  it("throws when a read-only --config file is missing (never seeds)", () => {
    const configPath = join(tempDir, "absent.json");
    expect(() => loadTuiServers({ configPath })).toThrow(
      /Config file not found/,
    );
    expect(existsSync(configPath)).toBe(false);
  });

  it("rejects --catalog and --config together", () => {
    const catalogPath = join(tempDir, "catalog.json");
    const configPath = join(tempDir, "config.json");
    writeFileSync(catalogPath, JSON.stringify({ mcpServers: {} }));
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
    expect(() => loadTuiServers({ catalogPath, configPath })).toThrow(
      /mutually exclusive/,
    );
  });

  it("rejects --catalog combined with an ad-hoc target", () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify({ mcpServers: {} }));
    expect(() =>
      loadTuiServers({ catalogPath, target: ["my-server"] }),
    ).toThrow(/--catalog cannot be combined/);
  });

  it("builds a single ad-hoc server from a positional target", () => {
    const servers = loadTuiServers({ target: ["my-server", "--flag"] });
    expect(Object.keys(servers)).toEqual(["default"]);
    expect(servers.default?.config).toMatchObject({
      type: "stdio",
      command: "my-server",
      args: ["--flag"],
    });
  });

  it("merges --header into per-server settings for catalog servers", () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(
      catalogPath,
      JSON.stringify({
        mcpServers: { web: { type: "streamable-http", url: "http://x/mcp" } },
      }),
    );
    const servers = loadTuiServers({
      catalogPath,
      headers: { Authorization: "Bearer t" },
    });
    expect(servers.web?.settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer t" },
    ]);
  });
});
