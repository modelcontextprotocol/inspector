import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseKeyValuePair,
  parseHeaderPair,
  withDefaultCatalogPath,
  resolveServerConfigs,
  resolveServerSource,
  serverSourceConflict,
  readServerListFile,
  getNamedServerConfigs,
} from "@inspector/core/mcp/node/config.js";

describe("parseKeyValuePair", () => {
  it("returns a single-entry record on a clean key=value", () => {
    expect(parseKeyValuePair("a=1")).toEqual({ a: "1" });
  });

  it("accumulates into the previous record", () => {
    const r1 = parseKeyValuePair("a=1");
    const r2 = parseKeyValuePair("b=2", r1);
    expect(r2).toEqual({ a: "1", b: "2" });
  });

  it("preserves later '=' inside the value", () => {
    expect(parseKeyValuePair("token=abc=def")).toEqual({ token: "abc=def" });
  });

  it("throws when the format is invalid", () => {
    expect(() => parseKeyValuePair("nope")).toThrow(/Invalid parameter format/);
    expect(() => parseKeyValuePair("=value")).toThrow(
      /Invalid parameter format/,
    );
    expect(() => parseKeyValuePair("key=")).toThrow(/Invalid parameter format/);
  });
});

describe("parseHeaderPair", () => {
  it("splits on the first colon and trims both sides", () => {
    expect(parseHeaderPair("X-Test:   value")).toEqual({
      "X-Test": "value",
    });
  });

  it("supports colons inside the value", () => {
    expect(parseHeaderPair("X: a:b:c")).toEqual({ X: "a:b:c" });
  });

  it("accumulates into the previous record", () => {
    const r1 = parseHeaderPair("X: 1");
    const r2 = parseHeaderPair("Y: 2", r1);
    expect(r2).toEqual({ X: "1", Y: "2" });
  });

  it("throws on missing colon or empty key/value", () => {
    expect(() => parseHeaderPair("X-Test")).toThrow(/Invalid header format/);
    expect(() => parseHeaderPair(": value")).toThrow(/Invalid header format/);
    expect(() => parseHeaderPair("X:")).toThrow(/Invalid header format/);
  });
});

describe("resolveServerSource", () => {
  it("returns the writable catalog source when catalogPath is set", () => {
    expect(resolveServerSource({ catalogPath: "/tmp/cat.json" })).toEqual({
      path: "/tmp/cat.json",
      writable: true,
    });
  });

  it("returns the read-only config source when only configPath is set", () => {
    expect(resolveServerSource({ configPath: "/tmp/cfg.json" })).toEqual({
      path: "/tmp/cfg.json",
      writable: false,
    });
  });

  it("prefers the catalog over the config when both are set", () => {
    expect(
      resolveServerSource({
        catalogPath: "/tmp/cat.json",
        configPath: "/tmp/cfg.json",
      }),
    ).toEqual({ path: "/tmp/cat.json", writable: true });
  });

  it("returns null when neither catalog nor config is set", () => {
    expect(resolveServerSource({ target: ["cmd"] })).toBeNull();
    expect(resolveServerSource({})).toBeNull();
  });

  it("ignores blank/whitespace-only paths", () => {
    expect(
      resolveServerSource({ catalogPath: "  ", configPath: "  " }),
    ).toBeNull();
  });
});

describe("serverSourceConflict", () => {
  it("rejects --catalog and --config together", () => {
    expect(
      serverSourceConflict({
        hasCatalog: true,
        hasConfig: true,
        hasAdHoc: false,
      }),
    ).toMatch(/mutually exclusive/);
  });

  it("rejects --catalog with an ad-hoc target", () => {
    expect(
      serverSourceConflict({
        hasCatalog: true,
        hasConfig: false,
        hasAdHoc: true,
      }),
    ).toMatch(/--catalog cannot be combined/);
  });

  it("rejects --config with an ad-hoc target", () => {
    expect(
      serverSourceConflict({
        hasCatalog: false,
        hasConfig: true,
        hasAdHoc: true,
      }),
    ).toMatch(/--config cannot be combined/);
  });

  it("allows a lone catalog, a lone config, or a lone ad-hoc target", () => {
    expect(
      serverSourceConflict({
        hasCatalog: true,
        hasConfig: false,
        hasAdHoc: false,
      }),
    ).toBeNull();
    expect(
      serverSourceConflict({
        hasCatalog: false,
        hasConfig: true,
        hasAdHoc: false,
      }),
    ).toBeNull();
    expect(
      serverSourceConflict({
        hasCatalog: false,
        hasConfig: false,
        hasAdHoc: true,
      }),
    ).toBeNull();
  });
});

describe("withDefaultCatalogPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("leaves options unchanged when --catalog, --config, or ad-hoc target is present", () => {
    expect(withDefaultCatalogPath({ catalogPath: "/tmp/cat.json" })).toEqual({
      catalogPath: "/tmp/cat.json",
    });
    expect(withDefaultCatalogPath({ configPath: "/tmp/mcp.json" })).toEqual({
      configPath: "/tmp/mcp.json",
    });
    expect(withDefaultCatalogPath({ target: ["node", "server.js"] })).toEqual({
      target: ["node", "server.js"],
    });
  });

  it("injects the default catalog path into the writable catalog slot when nothing is given", () => {
    const prevHome = process.env.HOME;
    const homeDir = join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    process.env.HOME = homeDir;
    try {
      const options = withDefaultCatalogPath({});
      expect(options.catalogPath).toBe(
        join(homeDir, ".mcp-inspector", "mcp.json"),
      );
      expect(options.configPath).toBeUndefined();
    } finally {
      process.env.HOME = prevHome;
    }
  });
});

describe("readServerListFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds an empty catalog on disk when a writable source is missing", () => {
    const catalogPath = join(tempDir, "nested", "mcp.json");
    const config = readServerListFile(catalogPath, true);
    expect(config).toEqual({ mcpServers: {} });
    expect(existsSync(catalogPath)).toBe(true);
    expect(JSON.parse(readFileSync(catalogPath, "utf-8"))).toEqual({
      mcpServers: {},
    });
  });

  it("throws when a read-only source is missing (never seeds)", () => {
    const configPath = join(tempDir, "absent.json");
    expect(() => readServerListFile(configPath, false)).toThrow(
      /Config file not found/,
    );
    expect(existsSync(configPath)).toBe(false);
  });

  it("reads and normalizes server types from an existing file", () => {
    const configPath = join(tempDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: { a: { type: "http", url: "http://example.com/mcp" } },
      }),
    );
    const config = readServerListFile(configPath, false);
    expect(config.mcpServers.a).toMatchObject({ type: "streamable-http" });
  });
});

describe("default-catalog launch resolution (withDefaultCatalogPath + resolveServerConfigs)", () => {
  // The CLI/TUI launch path: apply the default writable catalog when no source
  // or ad-hoc target is given, then resolve. (Both clients now compose these
  // via loadServerEntries; this exercises the underlying config primitives.)
  let tempDir: string;

  const resolveLaunch = (
    options: Parameters<typeof resolveServerConfigs>[0],
    mode: Parameters<typeof resolveServerConfigs>[1],
  ) => resolveServerConfigs(withDefaultCatalogPath(options), mode);

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds the default catalog and reports no servers when it is missing (single mode)", () => {
    const prevHome = process.env.HOME;
    const homeDir = join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    process.env.HOME = homeDir;
    const defaultConfig = join(homeDir, ".mcp-inspector", "mcp.json");
    try {
      expect(() => resolveLaunch({ target: [] }, "single")).toThrow(
        /No servers found/,
      );
      // The writable default catalog is seeded on first run (matches web),
      // rather than erroring with "Config file not found".
      expect(existsSync(defaultConfig)).toBe(true);
      expect(JSON.parse(readFileSync(defaultConfig, "utf-8"))).toEqual({
        mcpServers: {},
      });
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it("returns an empty list from a seeded default catalog (multi mode)", () => {
    const prevHome = process.env.HOME;
    const homeDir = join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    process.env.HOME = homeDir;
    try {
      expect(resolveLaunch({}, "multi")).toEqual([]);
      expect(existsSync(join(homeDir, ".mcp-inspector", "mcp.json"))).toBe(
        true,
      );
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it("loads all servers from the default catalog in multi mode", () => {
    const prevHome = process.env.HOME;
    const homeDir = join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    const defaultConfig = join(homeDir, ".mcp-inspector", "mcp.json");
    mkdirSync(join(homeDir, ".mcp-inspector"), { recursive: true });
    writeFileSync(
      defaultConfig,
      JSON.stringify({ mcpServers: { a: { command: "a" } } }),
    );
    process.env.HOME = homeDir;
    try {
      const configs = resolveLaunch({}, "multi");
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({ type: "stdio", command: "a" });
    } finally {
      process.env.HOME = prevHome;
    }
  });
});

describe("resolveServerConfigs — single mode", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
    configPath = join(tempDir, "mcp.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds a stdio config from positional target args", () => {
    const [config] = resolveServerConfigs(
      { target: ["my-server", "--flag"] },
      "single",
    );
    expect(config).toMatchObject({
      type: "stdio",
      command: "my-server",
      args: ["--flag"],
    });
  });

  it("applies env and cwd overrides to a stdio config", () => {
    const [config] = resolveServerConfigs(
      {
        target: ["cmd"],
        env: { FOO: "bar" },
        cwd: "/tmp",
      },
      "single",
    );
    expect(config).toMatchObject({
      type: "stdio",
      command: "cmd",
      env: { FOO: "bar" },
      cwd: "/tmp",
    });
  });

  it("infers streamable-http from a /mcp URL", () => {
    const [config] = resolveServerConfigs(
      { target: ["http://example.com/mcp"] },
      "single",
    );
    expect(config).toEqual({
      type: "streamable-http",
      url: "http://example.com/mcp",
    });
  });

  it("infers sse from a /sse URL", () => {
    const [config] = resolveServerConfigs(
      { target: ["http://example.com/sse"] },
      "single",
    );
    expect(config).toEqual({
      type: "sse",
      url: "http://example.com/sse",
    });
  });

  it("respects an explicit --transport=streamable-http override", () => {
    const [config] = resolveServerConfigs(
      {
        target: ["http://example.com/other"],
        transport: "http",
      },
      "single",
    );
    expect(config).toMatchObject({
      type: "streamable-http",
      url: "http://example.com/other",
    });
  });

  it("uses --server-url when no positional URL is provided", () => {
    const [config] = resolveServerConfigs(
      { serverUrl: "http://example.com/sse" },
      "single",
    );
    expect(config).toEqual({
      type: "sse",
      url: "http://example.com/sse",
    });
  });

  it("rejects args passed alongside a URL target", () => {
    expect(() =>
      resolveServerConfigs(
        { target: ["http://example.com/mcp", "extra"] },
        "single",
      ),
    ).toThrow(/cannot be passed to a URL-based MCP server/);
  });

  it("rejects ambiguous URLs with no transport hint", () => {
    expect(() =>
      resolveServerConfigs(
        { target: ["http://example.com/unknown"] },
        "single",
      ),
    ).toThrow(/Transport type not specified/);
  });

  it("rejects --transport other than stdio for local commands", () => {
    expect(() =>
      resolveServerConfigs({ target: ["cmd"], transport: "sse" }, "single"),
    ).toThrow(/Only stdio transport can be used with local commands/);
  });

  it("requires a target when no config path is given", () => {
    expect(() => resolveServerConfigs({ target: [] }, "single")).toThrow(
      /Target is required/,
    );
  });

  it("loads a named server from config", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          foo: { command: "node", args: ["foo.js"] },
        },
      }),
    );
    const [config] = resolveServerConfigs(
      { configPath, serverName: "foo" },
      "single",
    );
    expect(config).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["foo.js"],
    });
  });

  it("auto-picks the single server from a config when --server is omitted", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          only: { command: "node", args: ["only.js"] },
        },
      }),
    );
    const [config] = resolveServerConfigs({ configPath }, "single");
    expect(config).toMatchObject({ type: "stdio", command: "node" });
  });

  it("throws when the config has multiple servers and no --server", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          a: { command: "a" },
          b: { command: "b" },
        },
      }),
    );
    expect(() => resolveServerConfigs({ configPath }, "single")).toThrow(
      /Multiple servers found/,
    );
  });

  it("throws when the read-only config file is missing", () => {
    expect(() =>
      resolveServerConfigs(
        { configPath: join(tempDir, "nonexistent.json") },
        "single",
      ),
    ).toThrow(/Config file not found/);
  });

  it("seeds a missing writable catalog and then reports no servers", () => {
    const catalogPath = join(tempDir, "seeded.json");
    expect(() => resolveServerConfigs({ catalogPath }, "single")).toThrow(
      /No servers found/,
    );
    expect(existsSync(catalogPath)).toBe(true);
  });

  it("loads a named server from a writable catalog", () => {
    const catalogPath = join(tempDir, "cat.json");
    writeFileSync(
      catalogPath,
      JSON.stringify({ mcpServers: { foo: { command: "node" } } }),
    );
    const [config] = resolveServerConfigs(
      { catalogPath, serverName: "foo" },
      "single",
    );
    expect(config).toMatchObject({ type: "stdio", command: "node" });
  });

  it("throws when the config file has no mcpServers element", () => {
    writeFileSync(configPath, JSON.stringify({}));
    expect(() => resolveServerConfigs({ configPath }, "single")).toThrow(
      /must contain an mcpServers element/,
    );
  });

  it("throws when the config file is malformed JSON", () => {
    writeFileSync(configPath, "not json");
    expect(() => resolveServerConfigs({ configPath }, "single")).toThrow(
      /Error loading configuration/,
    );
  });

  it("normalizes 'http' → 'streamable-http' in stored configs", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          server1: { type: "http", url: "http://example.com/mcp" },
        },
      }),
    );
    const [config] = resolveServerConfigs(
      { configPath, serverName: "server1" },
      "single",
    );
    expect(config.type).toBe("streamable-http");
  });

  it("defaults missing type to stdio", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          server1: { command: "echo" },
        },
      }),
    );
    const [config] = resolveServerConfigs(
      { configPath, serverName: "server1" },
      "single",
    );
    expect(config.type).toBe("stdio");
  });

  it("throws when the named server is missing", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          foo: { command: "node" },
        },
      }),
    );
    expect(() =>
      resolveServerConfigs({ configPath, serverName: "bar" }, "single"),
    ).toThrow(/Server 'bar' not found/);
  });

  it("applies env/cwd overrides when loading from config", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          foo: { command: "node", args: ["foo.js"] },
          bar: {
            type: "streamable-http",
            url: "http://example.com/mcp",
          },
        },
      }),
    );
    const [stdio] = resolveServerConfigs(
      {
        configPath,
        serverName: "foo",
        env: { X: "1" },
        cwd: "/tmp",
      },
      "single",
    );
    expect(stdio).toMatchObject({
      type: "stdio",
      env: { X: "1" },
      cwd: "/tmp",
    });
  });
});

describe("resolveServerConfigs — multi mode", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
    configPath = join(tempDir, "mcp.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns all servers from a config file", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          a: { command: "a" },
          b: { type: "http", url: "http://example.com/mcp" },
        },
      }),
    );
    const configs = resolveServerConfigs({ configPath }, "multi");
    expect(configs).toHaveLength(2);
    expect(configs[0]?.type).toBe("stdio");
    expect(configs[1]?.type).toBe("streamable-http");
  });

  it("returns a single ad-hoc config when no config file is given", () => {
    const configs = resolveServerConfigs({ target: ["cmd"] }, "multi");
    expect(configs).toHaveLength(1);
    expect(configs[0]?.type).toBe("stdio");
  });

  it("returns all servers from a writable catalog, seeding it if missing", () => {
    const catalogPath = join(tempDir, "cat.json");
    // Missing → seeded empty → no servers.
    expect(resolveServerConfigs({ catalogPath }, "multi")).toEqual([]);
    expect(existsSync(catalogPath)).toBe(true);
    // Now populated → returned.
    writeFileSync(
      catalogPath,
      JSON.stringify({ mcpServers: { a: { command: "a" } } }),
    );
    const configs = resolveServerConfigs({ catalogPath }, "multi");
    expect(configs).toHaveLength(1);
    expect(configs[0]?.type).toBe("stdio");
  });

  it("requires a target when no config path is given", () => {
    expect(() => resolveServerConfigs({}, "multi")).toThrow(
      /Target is required/,
    );
  });

  it("rejects ad-hoc flags alongside a config path", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { a: { command: "a" } } }),
    );
    expect(() =>
      resolveServerConfigs({ configPath, target: ["other"] }, "multi"),
    ).toThrow(/do not pass --transport, --server-url/);
  });

  it("returns an empty array for an unknown mode", () => {
    const configs = resolveServerConfigs(
      { target: ["cmd"] },
      "unknown" as unknown as "single",
    );
    expect(configs).toEqual([]);
  });
});

describe("getNamedServerConfigs", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspector-config-test-"));
    configPath = join(tempDir, "mcp.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a named record of servers from a config file", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          a: { command: "a" },
          b: { command: "b" },
        },
      }),
    );
    const named = getNamedServerConfigs({ configPath });
    expect(Object.keys(named)).toEqual(["a", "b"]);
  });

  it("applies overrides to each server", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          a: { command: "a" },
          b: { type: "http", url: "http://example.com/mcp" },
        },
      }),
    );
    const named = getNamedServerConfigs({
      configPath,
      env: { X: "1" },
    });
    expect((named.a as { env: Record<string, string> }).env).toEqual({
      X: "1",
    });
    // env override does not apply to non-stdio servers; the streamable-http
    // entry stays as-is.
    expect(named.b).toMatchObject({
      type: "streamable-http",
      url: "http://example.com/mcp",
    });
  });

  it("throws when configPath is missing", () => {
    expect(() => getNamedServerConfigs({})).toThrow(/Config path is required/);
  });

  it("throws when ad-hoc flags are also given", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { a: { command: "a" } } }),
    );
    expect(() =>
      getNamedServerConfigs({ configPath, target: ["other"] }),
    ).toThrow(/do not pass --transport, --server-url/);
  });
});
