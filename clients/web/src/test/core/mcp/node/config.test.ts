import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseKeyValuePair,
  parseHeaderPair,
  resolveServerConfigs,
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

  it("rejects an empty target with no URL", () => {
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

  it("throws when the config file is missing", () => {
    expect(() =>
      resolveServerConfigs(
        { configPath: join(tempDir, "nonexistent.json") },
        "single",
      ),
    ).toThrow(/Config file not found/);
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
