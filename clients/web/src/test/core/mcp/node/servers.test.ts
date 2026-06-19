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
import {
  headersToServerSettings,
  loadServerEntries,
  selectServerEntry,
  type ResolvedServer,
} from "@inspector/core/mcp/node/servers.js";

describe("headersToServerSettings", () => {
  it("returns undefined when no headers are given", () => {
    expect(headersToServerSettings()).toBeUndefined();
    expect(headersToServerSettings({})).toBeUndefined();
  });

  it("builds a settings object carrying the headers as key/value pairs", () => {
    const settings = headersToServerSettings({ Authorization: "Bearer t" });
    expect(settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer t" },
    ]);
    expect(settings?.metadata).toEqual([]);
    expect(settings?.roots).toEqual([]);
  });
});

describe("loadServerEntries", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "server-entries-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lifts disk headers, timeouts, and OAuth into per-server settings", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          web: {
            type: "streamable-http",
            url: "http://x/mcp",
            headers: { Authorization: "Bearer disk" },
            connectionTimeout: 5000,
            requestTimeout: 9000,
            oauth: {
              clientId: "client-abc",
              clientSecret: "shh",
              scopes: ["a", "b"],
            },
          },
        },
      }),
    );

    const servers = loadServerEntries({ configPath });
    const settings = servers.web?.settings;
    expect(settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer disk" },
    ]);
    expect(settings?.connectionTimeout).toBe(5000);
    expect(settings?.requestTimeout).toBe(9000);
    expect(settings?.oauthClientId).toBe("client-abc");
    expect(settings?.oauthClientSecret).toBe("shh");
    expect(settings?.oauthScopes).toEqual(["a", "b"]);
  });

  it("merges --header over disk headers while preserving disk timeouts", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          web: {
            type: "streamable-http",
            url: "http://x/mcp",
            headers: { Authorization: "Bearer disk" },
            requestTimeout: 9000,
          },
        },
      }),
    );

    const servers = loadServerEntries({
      configPath,
      headers: { Authorization: "Bearer cli" },
    });
    expect(servers.web?.settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer cli" },
    ]);
    // Disk timeout survives the header override.
    expect(servers.web?.settings?.requestTimeout).toBe(9000);
  });

  it("merges --header into a server that has no disk settings", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          web: { type: "streamable-http", url: "http://x/mcp" },
        },
      }),
    );

    const servers = loadServerEntries({
      configPath,
      headers: { Authorization: "Bearer cli" },
    });
    expect(servers.web?.settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer cli" },
    ]);
  });

  it("applies env and cwd overrides to stdio configs only", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          local: { command: "node", args: ["server.js"], env: { A: "1" } },
          web: { type: "streamable-http", url: "http://x/mcp" },
        },
      }),
    );

    const servers = loadServerEntries({
      configPath,
      env: { B: "2" },
      cwd: "/tmp/work",
    });
    expect(servers.local?.config).toMatchObject({
      type: "stdio",
      command: "node",
      env: { A: "1", B: "2" },
      cwd: "/tmp/work",
    });
    // Non-stdio config is left untouched by env/cwd overrides.
    expect(servers.web?.config).toMatchObject({
      type: "streamable-http",
      url: "http://x/mcp",
    });
  });

  it("seeds an empty writable catalog when --catalog is missing", () => {
    const catalogPath = join(tempDir, "catalog.json");
    const servers = loadServerEntries({ catalogPath });
    expect(servers).toEqual({});
    expect(existsSync(catalogPath)).toBe(true);
    expect(JSON.parse(readFileSync(catalogPath, "utf-8"))).toEqual({
      mcpServers: {},
    });
  });

  it("throws when a read-only --config file is missing (never seeds)", () => {
    const configPath = join(tempDir, "absent.json");
    expect(() => loadServerEntries({ configPath })).toThrow(
      /Config file not found/,
    );
    expect(existsSync(configPath)).toBe(false);
  });

  it("rejects --catalog and --config together", () => {
    const catalogPath = join(tempDir, "catalog.json");
    const configPath = join(tempDir, "config.json");
    writeFileSync(catalogPath, JSON.stringify({ mcpServers: {} }));
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
    expect(() => loadServerEntries({ catalogPath, configPath })).toThrow(
      /mutually exclusive/,
    );
  });

  it("rejects --catalog combined with an ad-hoc target", () => {
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify({ mcpServers: {} }));
    expect(() =>
      loadServerEntries({ catalogPath, target: ["my-server"] }),
    ).toThrow(/--catalog cannot be combined/);
  });

  it("builds a single ad-hoc server from a positional target", () => {
    const servers = loadServerEntries({
      target: ["my-server", "--flag"],
      headers: { Authorization: "Bearer t" },
    });
    expect(Object.keys(servers)).toEqual(["default"]);
    expect(servers.default?.config).toMatchObject({
      type: "stdio",
      command: "my-server",
      args: ["--flag"],
    });
    expect(servers.default?.settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer t" },
    ]);
  });
});

describe("selectServerEntry", () => {
  const a: ResolvedServer = {
    config: { type: "stdio", command: "a" },
  };
  const b: ResolvedServer = {
    config: { type: "stdio", command: "b" },
  };

  it("returns the named entry when it exists", () => {
    expect(selectServerEntry({ a, b }, "b")).toBe(b);
  });

  it("throws listing available servers when the name is unknown", () => {
    expect(() => selectServerEntry({ a, b }, "missing")).toThrow(
      /Server 'missing' not found.*Available servers: a, b/,
    );
  });

  it("returns the only entry when no name is given", () => {
    expect(selectServerEntry({ a })).toBe(a);
  });

  it("throws when the source is empty and no name is given", () => {
    expect(() => selectServerEntry({})).toThrow(/No servers found/);
  });

  it("throws asking for --server when several exist and no name is given", () => {
    expect(() => selectServerEntry({ a, b })).toThrow(
      /Multiple servers found.*--server.*Available servers: a, b/,
    );
  });
});
