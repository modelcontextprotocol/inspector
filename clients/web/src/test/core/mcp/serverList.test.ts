import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEED_CONFIG,
  mcpConfigToServerEntries,
  normalizeServerType,
  serverEntriesToMcpConfig,
  serializeMcpConfig,
} from "@inspector/core/mcp/serverList.js";
import type { MCPConfig, ServerEntry } from "@inspector/core/mcp/types.js";

describe("normalizeServerType", () => {
  it("defaults missing type to stdio", () => {
    expect(normalizeServerType({ command: "node" })).toEqual({
      type: "stdio",
      command: "node",
    });
  });

  it("rewrites 'http' to 'streamable-http'", () => {
    expect(
      normalizeServerType({ type: "http", url: "https://x.test" }),
    ).toEqual({
      type: "streamable-http",
      url: "https://x.test",
    });
  });

  it("leaves sse / stdio / streamable-http alone", () => {
    expect(
      normalizeServerType({ type: "sse", url: "https://x.test" }),
    ).toMatchObject({ type: "sse" });
    expect(
      normalizeServerType({ type: "stdio", command: "node" }),
    ).toMatchObject({ type: "stdio" });
    expect(
      normalizeServerType({ type: "streamable-http", url: "https://x.test" }),
    ).toMatchObject({ type: "streamable-http" });
  });

  it("defaults an unknown string type to stdio (lenient on read)", () => {
    expect(
      normalizeServerType({ type: "websocket", command: "node" } as never),
    ).toMatchObject({ type: "stdio" });
    expect(
      normalizeServerType({ type: "", command: "node" } as never),
    ).toMatchObject({ type: "stdio" });
  });

  it("defaults a non-string type to stdio", () => {
    expect(
      normalizeServerType({ type: 42, command: "node" } as never),
    ).toMatchObject({ type: "stdio" });
    expect(
      normalizeServerType({ type: null, command: "node" } as never),
    ).toMatchObject({ type: "stdio" });
  });

  it("returns a fresh object (does not mutate input)", () => {
    const input = { command: "node" };
    const out = normalizeServerType(input);
    expect(out).not.toBe(input);
    expect(input).not.toHaveProperty("type");
  });
});

describe("mcpConfigToServerEntries", () => {
  it("uses the map key as both id and name", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: { type: "stdio", command: "node" },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry.id).toBe("alpha");
    expect(entry.name).toBe("alpha");
  });

  it("initializes connection to disconnected", () => {
    const [entry] = mcpConfigToServerEntries({
      mcpServers: { alpha: { type: "stdio", command: "node" } },
    });
    expect(entry.connection).toEqual({ status: "disconnected" });
  });

  it("normalizes legacy 'http' and missing type", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        legacy: { command: "node" } as never,
        httpish: { type: "http", url: "https://x.test" } as never,
      },
    };
    const entries = mcpConfigToServerEntries(cfg);
    expect(entries[0]?.config.type).toBe("stdio");
    expect(entries[1]?.config.type).toBe("streamable-http");
  });

  it("preserves insertion order across entries", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        a: { type: "stdio", command: "1" },
        b: { type: "stdio", command: "2" },
        c: { type: "stdio", command: "3" },
      },
    };
    expect(mcpConfigToServerEntries(cfg).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("yields an empty list for an empty map", () => {
    expect(mcpConfigToServerEntries({ mcpServers: {} })).toEqual([]);
  });
});

describe("serverEntriesToMcpConfig", () => {
  it("strips runtime-only fields (connection, info, name)", () => {
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "Alpha (pretty)",
        config: { type: "stdio", command: "node" },
        connection: { status: "connected" },
        info: { name: "alpha-impl", version: "1.0.0" },
      },
    ];
    const cfg = serverEntriesToMcpConfig(entries);
    expect(cfg).toEqual({
      mcpServers: {
        alpha: { type: "stdio", command: "node" },
      },
    });
  });

  it("round-trips through mcpConfigToServerEntries without data loss on config", () => {
    const original: MCPConfig = {
      mcpServers: {
        alpha: { type: "stdio", command: "node", args: ["-y", "x"] },
        beta: {
          type: "sse",
          url: "https://x.test",
        },
      },
    };
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("round-trips a populated settings node through both converters", () => {
    const original: MCPConfig = {
      mcpServers: {
        gamma: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          settings: {
            headers: [{ key: "Authorization", value: "Bearer xyz" }],
            metadata: [{ key: "tenant", value: "acme" }],
            connectionTimeout: 30000,
            requestTimeout: 60000,
            oauthClientId: "client-abc",
            oauthClientSecret: "secret-def",
            oauthScopes: "read:tools",
          },
        },
      },
    };
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("lifts the settings node from the stored entry onto ServerEntry.settings", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          settings: {
            headers: [{ key: "X-Tenant", value: "acme" }],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
          },
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings).toEqual({
      headers: [{ key: "X-Tenant", value: "acme" }],
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
    });
    // `settings` should not leak back into config — the SDK transport must
    // see a clean MCPServerConfig.
    expect(
      (entry?.config as unknown as Record<string, unknown>).settings,
    ).toBeUndefined();
  });

  it("omits the settings key on disk when ServerEntry.settings is undefined", () => {
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        connection: { status: "disconnected" },
      },
    ];
    const cfg = serverEntriesToMcpConfig(entries);
    expect(cfg.mcpServers.alpha).not.toHaveProperty("settings");
  });

  it("preserves insertion order on serialize", () => {
    const entries: ServerEntry[] = [
      {
        id: "a",
        name: "a",
        config: { type: "stdio", command: "1" },
        connection: { status: "disconnected" },
      },
      {
        id: "b",
        name: "b",
        config: { type: "stdio", command: "2" },
        connection: { status: "disconnected" },
      },
    ];
    expect(Object.keys(serverEntriesToMcpConfig(entries).mcpServers)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("serializeMcpConfig", () => {
  it("produces 2-space-indented canonical JSON", () => {
    const json = serializeMcpConfig([
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        connection: { status: "disconnected" },
      },
    ]);
    expect(json).toBe(
      `{\n  "mcpServers": {\n    "alpha": {\n      "type": "stdio",\n      "command": "node"\n    }\n  }\n}`,
    );
  });

  it("strips runtime-only fields (connection, info, name) from the output", () => {
    const json = serializeMcpConfig([
      {
        id: "alpha",
        name: "Alpha (pretty)",
        config: { type: "stdio", command: "node" },
        connection: { status: "connected" },
        info: { name: "alpha-impl", version: "1.0.0" },
      },
    ]);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toEqual({
      mcpServers: { alpha: { type: "stdio", command: "node" } },
    });
  });

  it('returns `{ "mcpServers": {} }` for an empty list', () => {
    expect(serializeMcpConfig([])).toBe(`{\n  "mcpServers": {}\n}`);
  });
});

describe("DEFAULT_SEED_CONFIG", () => {
  it("contains the two canonical seed servers", () => {
    expect(Object.keys(DEFAULT_SEED_CONFIG.mcpServers)).toEqual([
      "filesystem-server-default",
      "everything-server-default",
    ]);
  });

  it("uses stdio + npx for both seeds", () => {
    for (const cfg of Object.values(DEFAULT_SEED_CONFIG.mcpServers)) {
      expect(cfg.type).toBe("stdio");
      if (cfg.type === "stdio") {
        expect(cfg.command).toBe("npx");
      }
    }
  });

  it("scopes the filesystem server to /tmp by default", () => {
    const fs = DEFAULT_SEED_CONFIG.mcpServers["filesystem-server-default"];
    if (fs?.type === "stdio") {
      expect(fs.args).toContain("/tmp");
    }
  });
});
