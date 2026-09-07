import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanAuthorizationParams,
  cleanRoots,
  DEFAULT_SEED_CONFIG,
  EXAMPLE_SERVER_URL,
  envPairsToRecord,
  envRecordToPairs,
  expectedSecretFields,
  extractSecretsFromStored,
  inspectorSettingsToStoredFields,
  mcpConfigToServerEntries,
  mergeSecretsIntoStored,
  normalizeServerType,
  normalizeStoredMetadata,
  applyStdioSettingsToConfig,
  stdioConfigFieldsFromSettings,
  oauthAuthorizationParamsFromSettings,
  oauthEndpointOverridesFromSettings,
  serverEntriesToMcpConfig,
  serializeMcpConfig,
  storedFieldsToInspectorSettings,
} from "@inspector/core/mcp/serverList.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "@inspector/core/auth/secret-fields.js";
import type {
  MCPConfig,
  ServerEntry,
  StoredMCPServer,
} from "@inspector/core/mcp/types.js";
import type { Root } from "@modelcontextprotocol/client";

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

describe("cleanRoots", () => {
  it("drops blank-uri rows and trims/drops blank names", () => {
    expect(
      cleanRoots([
        { uri: "file:///a", name: "  Alpha  " },
        { uri: "file:///b", name: "   " },
        { uri: "   " },
        { uri: "" },
      ]),
    ).toEqual([{ uri: "file:///a", name: "Alpha" }, { uri: "file:///b" }]);
  });

  it("preserves non-form fields (e.g. _meta) on surviving rows", () => {
    expect(
      cleanRoots([
        { uri: "file:///a", name: "Alpha", _meta: { k: 1 } },
        { uri: "file:///b", _meta: { k: 2 } },
      ]),
    ).toEqual([
      { uri: "file:///a", name: "Alpha", _meta: { k: 1 } },
      { uri: "file:///b", _meta: { k: 2 } },
    ]);
  });

  // Every client now feeds this straight from hand-editable mcp.json (#1797),
  // where `Root[]` is only a compile-time promise. Malformed input must be
  // reported and skipped, not thrown at connect.
  describe("malformed input from disk", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
    });

    it("drops an entry with no uri instead of throwing", () => {
      // A hand-edited `"roots": [{ "name": "Work" }]`.
      const malformed = [{ name: "Work" }, { uri: "file:///ok" }];
      expect(cleanRoots(malformed as unknown as Root[])).toEqual([
        { uri: "file:///ok" },
      ]);
      expect(warn).toHaveBeenCalled();
    });

    it("drops an entry whose uri is not a string", () => {
      const malformed = [{ uri: 42 }, { uri: "file:///ok" }];
      expect(cleanRoots(malformed as unknown as Root[])).toEqual([
        { uri: "file:///ok" },
      ]);
      expect(warn).toHaveBeenCalled();
    });

    it("keeps a root whose name is not a string, dropping just the name", () => {
      // `name` is optional, so a bad one costs the name, not the root.
      expect(
        cleanRoots([
          { uri: "file:///a", name: 42 },
          { uri: "file:///b", name: { x: 1 } },
        ] as unknown as Root[]),
      ).toEqual([{ uri: "file:///a" }, { uri: "file:///b" }]);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("bails to an empty list when roots is not an array", () => {
      // A hand-edited `"roots": "file:///work"`.
      expect(cleanRoots("file:///work" as unknown as Root[])).toEqual([]);
      expect(warn).toHaveBeenCalled();
    });
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

  it("round-trips a populated set of Inspector-extension fields (post-#1358 flat shape)", () => {
    // Disk shape: top-level `headers` (Record), `metadata` (JSON object),
    // numeric timeouts, nested `oauth`. Round-trip must preserve the on-
    // disk shape byte-equivalent so a hand-edited file is stable.
    const original: MCPConfig = {
      mcpServers: {
        gamma: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          headers: { Authorization: "Bearer xyz" },
          metadata: { tenant: "acme", limits: { rps: 10 } },
          connectionTimeout: 30000,
          requestTimeout: 60000,
          oauth: {
            clientId: "client-abc",
            clientSecret: "secret-def",
            scopes: "read:tools",
          },
        },
      },
    };
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("round-trips autoRefreshOnListChanged: lifts true to settings and back to disk", () => {
    const original: MCPConfig = {
      mcpServers: {
        delta: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          autoRefreshOnListChanged: true,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.autoRefreshOnListChanged).toBe(true);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("omits autoRefreshOnListChanged from disk when false (the default)", () => {
    // Absent on disk lifts to false in memory; writing it back must NOT inject
    // the field, keeping the diff minimal for the default-off case. A benign
    // inspector field (connectionTimeout) is present so `settings` is built.
    const original: MCPConfig = {
      mcpServers: {
        epsilon: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.autoRefreshOnListChanged).toBe(false);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("autoRefreshOnListChanged" in (round.mcpServers.epsilon ?? {})).toBe(
      false,
    );
    expect(round).toEqual(original);
  });

  it("round-trips paginatedLists: lifts true to settings and back to disk", () => {
    const original: MCPConfig = {
      mcpServers: {
        delta: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          paginatedLists: true,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.paginatedLists).toBe(true);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("omits paginatedLists from disk when false (the default)", () => {
    const original: MCPConfig = {
      mcpServers: {
        epsilon: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.paginatedLists).toBe(false);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("paginatedLists" in (round.mcpServers.epsilon ?? {})).toBe(false);
    expect(round).toEqual(original);
  });

  it("round-trips advertisedExtensions: lifts a non-empty map to settings and back to disk", () => {
    const original: MCPConfig = {
      mcpServers: {
        exttest: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          advertisedExtensions: { "io.modelcontextprotocol/tasks": false },
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.advertisedExtensions).toEqual({
      "io.modelcontextprotocol/tasks": false,
    });
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("omits advertisedExtensions from disk when unset, and leaves settings unset", () => {
    const original: MCPConfig = {
      mcpServers: {
        extnone: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.advertisedExtensions).toBeUndefined();
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("advertisedExtensions" in (round.mcpServers.extnone ?? {})).toBe(
      false,
    );
    expect(round).toEqual(original);
  });

  it("treats an empty advertisedExtensions map on disk as unset (omitted on write)", () => {
    const original: MCPConfig = {
      mcpServers: {
        extempty: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          advertisedExtensions: {},
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    // An empty map reads back as unset for the form...
    expect(entry?.settings?.advertisedExtensions).toBeUndefined();
    // ...and the write side omits it, so the empty map does not round-trip.
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("advertisedExtensions" in (round.mcpServers.extempty ?? {})).toBe(
      false,
    );
  });

  it("round-trips maxFetchRequests: lifts a non-default value to settings and back to disk", () => {
    const original: MCPConfig = {
      mcpServers: {
        zeta: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          maxFetchRequests: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.maxFetchRequests).toBe(5000);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("round-trips maxFetchRequests: 0 (unlimited) — a meaningful non-default value", () => {
    const original: MCPConfig = {
      mcpServers: {
        eta: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          maxFetchRequests: 0,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.maxFetchRequests).toBe(0);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("omits maxFetchRequests from disk when it equals the default", () => {
    // Absent on disk lifts to the product default (1000) in memory; writing it
    // back must NOT inject the field, keeping the diff minimal. A benign
    // inspector field (connectionTimeout) is present so `settings` is built.
    const original: MCPConfig = {
      mcpServers: {
        theta: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.maxFetchRequests).toBe(1000);
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("maxFetchRequests" in (round.mcpServers.theta ?? {})).toBe(false);
    expect(round).toEqual(original);
  });

  it("round-trips protocolEra: lifts a non-default value to settings and back to disk", () => {
    const original: MCPConfig = {
      mcpServers: {
        "era-modern": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          protocolEra: "modern",
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.protocolEra).toBe("modern");
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("round-trips protocolEra: auto is a non-default value", () => {
    const original: MCPConfig = {
      mcpServers: {
        "era-auto": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          protocolEra: "auto",
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.protocolEra).toBe("auto");
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("drops an unknown protocolEra literal on read (hand-edited file)", () => {
    // The CLI/TUI read mcp.json directly (no /api/servers validators), so a
    // garbage era must be dropped here rather than reaching versionNegotiation.
    // Spread the invalid field through an `object`-typed literal so the garbage
    // value models a hand-edited file without needing an `as unknown as` cast.
    const badEra: object = { protocolEra: "future" };
    const original: MCPConfig = {
      mcpServers: {
        "era-bad": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          ...badEra,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.protocolEra).toBeUndefined();
  });

  it("omits protocolEra from disk when it equals the default (legacy)", () => {
    // A legacy era is the default — writing it back must NOT inject the field.
    // A benign inspector field keeps `settings` materialized.
    const original: MCPConfig = {
      mcpServers: {
        "era-legacy": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          protocolEra: "legacy",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.protocolEra).toBe("legacy");
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("protocolEra" in (round.mcpServers["era-legacy"] ?? {})).toBe(false);
  });

  it("round-trips modernLogLevel: lifts a non-default value to settings and back to disk (#1629)", () => {
    const original: MCPConfig = {
      mcpServers: {
        "log-off": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          modernLogLevel: "off",
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.modernLogLevel).toBe("off");
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect(round).toEqual(original);
  });

  it("drops an unknown modernLogLevel literal on read (hand-edited file) (#1629)", () => {
    const badLevel: object = { modernLogLevel: "verbose" };
    const original: MCPConfig = {
      mcpServers: {
        "log-bad": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          ...badLevel,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.modernLogLevel).toBeUndefined();
  });

  it("omits modernLogLevel from disk when it equals the default (debug) (#1629)", () => {
    const original: MCPConfig = {
      mcpServers: {
        "log-default": {
          type: "streamable-http",
          url: "https://x.test/mcp",
          modernLogLevel: "debug",
          connectionTimeout: 5000,
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(original);
    expect(entry?.settings?.modernLogLevel).toBe("debug");
    const round = serverEntriesToMcpConfig(mcpConfigToServerEntries(original));
    expect("modernLogLevel" in (round.mcpServers["log-default"] ?? {})).toBe(
      false,
    );
  });

  it("lifts top-level Inspector-extension fields onto ServerEntry.settings (form shape)", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          headers: { "X-Tenant": "acme" },
          oauth: { clientId: "the-client" },
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings).toEqual({
      // Object headers on disk → pair-array headers in memory
      headers: [{ key: "X-Tenant", value: "acme" }],
      // Non-stdio server → empty env mirror in memory (for the form)
      env: [],
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
      // Absent taskTtl on disk → product default in memory (for the form)
      taskTtl: 60000,
      // Absent autoRefreshOnListChanged on disk → false in memory (for the form)
      autoRefreshOnListChanged: false,
      // Absent paginatedLists on disk → false in memory (for the form)
      paginatedLists: false,
      // Absent maxFetchRequests on disk → product default in memory (for the form)
      maxFetchRequests: 1000,
      // Absent roots on disk → empty list in memory (for the form)
      roots: [],
      // Nested oauth on disk → flat oauthClientId in memory
      oauthClientId: "the-client",
    });
    // None of the Inspector-extension keys leak back into config —
    // the SDK transport must see a clean MCPServerConfig.
    const configKeys = Object.keys(
      entry?.config as unknown as Record<string, unknown>,
    );
    expect(configKeys).not.toContain("headers");
    expect(configKeys).not.toContain("metadata");
    expect(configKeys).not.toContain("oauth");
    expect(configKeys).not.toContain("connectionTimeout");
    expect(configKeys).not.toContain("requestTimeout");
  });

  it("lifts the headers field for a streamable-http entry written by Claude Code", () => {
    // A pasted-in `.mcp.json` example from the Claude Code docs — top-level
    // headers, no nested settings node.
    const cfg: MCPConfig = {
      mcpServers: {
        "api-server": {
          type: "streamable-http",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer the-token" },
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings?.headers).toEqual([
      { key: "Authorization", value: "Bearer the-token" },
    ]);
  });

  it("omits all Inspector-extension keys on disk when ServerEntry.settings is undefined", () => {
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        connection: { status: "disconnected" },
      },
    ];
    const cfg = serverEntriesToMcpConfig(entries);
    const stored = cfg.mcpServers.alpha;
    expect(stored).not.toHaveProperty("settings");
    expect(stored).not.toHaveProperty("headers");
    expect(stored).not.toHaveProperty("metadata");
    expect(stored).not.toHaveProperty("oauth");
    expect(stored).not.toHaveProperty("connectionTimeout");
    expect(stored).not.toHaveProperty("requestTimeout");
  });

  it("drops empty-key header rows when serializing to disk", () => {
    // The form leaves a blank row when the user clicks 'Add header' but
    // hasn't typed yet. Those should not reach disk — the round-trip
    // would otherwise produce `{ "": "..." }` which neither we nor the
    // ecosystem can sensibly send as an HTTP header.
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "streamable-http", url: "https://x.test" },
        settings: {
          headers: [
            { key: "X-Tenant", value: "acme" },
            { key: "", value: "stub" },
            { key: "   ", value: "whitespace" },
          ],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored?.headers).toEqual({ "X-Tenant": "acme" });
  });

  it("omits zero-valued timeouts and empty oauth fields on serialize", () => {
    // The form keeps numeric defaults at 0 and empty-string OAuth values.
    // Round-tripping them onto disk would leave noisy `connectionTimeout: 0`
    // / `oauth: {}` keys; suppress them so the diff stays minimal for
    // entries the user never customized.
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "streamable-http", url: "https://x.test" },
        settings: {
          headers: [],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored).not.toHaveProperty("connectionTimeout");
    expect(stored).not.toHaveProperty("requestTimeout");
    expect(stored).not.toHaveProperty("taskTtl");
    expect(stored).not.toHaveProperty("oauth");
    expect(stored).not.toHaveProperty("headers");
    expect(stored).not.toHaveProperty("metadata");
    expect(stored).not.toHaveProperty("roots");
  });

  it("round-trips roots (uri + optional name) onto the top-level disk field", () => {
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        settings: {
          headers: [],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [
            { uri: "file:///project", name: "Project" },
            { uri: "file:///tmp" },
          ],
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored?.roots).toEqual([
      { uri: "file:///project", name: "Project" },
      { uri: "file:///tmp" },
    ]);
    // Disk → memory lifts the same roots back onto settings.
    const [entry] = mcpConfigToServerEntries({
      mcpServers: { alpha: stored! },
    });
    expect(entry?.settings?.roots).toEqual([
      { uri: "file:///project", name: "Project" },
      { uri: "file:///tmp" },
    ]);
  });

  it("drops empty-uri root rows and blank names on serialize", () => {
    // The form leaves a blank row when the user clicks 'Add Root' but hasn't
    // typed a URI yet; a cleared optional name should not write `name: ""`.
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        settings: {
          headers: [],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [
            { uri: "file:///keep", name: "  " },
            { uri: "   " },
            { uri: "" },
          ],
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored?.roots).toEqual([{ uri: "file:///keep" }]);
  });

  it("omits the roots field entirely when no rows survive filtering", () => {
    const entries: ServerEntry[] = [
      {
        id: "alpha",
        name: "alpha",
        config: { type: "stdio", command: "node" },
        settings: {
          headers: [],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [{ uri: "" }],
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored).not.toHaveProperty("roots");
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
  it("contains the three canonical seed servers", () => {
    expect(Object.keys(DEFAULT_SEED_CONFIG.mcpServers)).toEqual([
      "filesystem-server-default",
      "everything-server-default",
      "example-server-default",
    ]);
  });

  it("uses stdio + npx for both local seeds", () => {
    for (const key of [
      "filesystem-server-default",
      "everything-server-default",
    ]) {
      const cfg = DEFAULT_SEED_CONFIG.mcpServers[key];
      expect(cfg?.type).toBe("stdio");
      if (cfg?.type === "stdio") {
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

  it("seeds the MCP org example server over streamable-http", () => {
    const example = DEFAULT_SEED_CONFIG.mcpServers["example-server-default"];
    expect(example?.type).toBe("streamable-http");
    if (example?.type === "streamable-http") {
      expect(example.url).toBe(EXAMPLE_SERVER_URL);
      expect(example.url).toBe(
        "https://example-server.modelcontextprotocol.io/mcp",
      );
    }
  });

  it("leaves the remote seed on the default protocol era", () => {
    // Omitted rather than written as "legacy": `serverEntriesToMcpConfig`
    // strips the field when it equals DEFAULT_PROTOCOL_ERA, so a seed that
    // spelled it out would round-trip into a different file than it seeded.
    const example = DEFAULT_SEED_CONFIG.mcpServers["example-server-default"];
    expect(example).not.toHaveProperty("protocolEra");
  });
});

describe("extractSecretsFromStored", () => {
  it("lifts oauth.clientSecret into the secrets record and drops it from the stripped shape", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientId: "cid", clientSecret: "shh", scopes: "read" },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh" });
    expect(stripped).toEqual({
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientId: "cid", scopes: "read" },
    });
  });

  it("preserves oauth.enterpriseManaged when lifting clientSecret to keychain", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: {
        clientId: "resource-as",
        clientSecret: "shh",
        enterpriseManaged: true,
      },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh" });
    expect(stripped.oauth).toEqual({
      clientId: "resource-as",
      enterpriseManaged: true,
    });
  });

  it("keeps oauth.enterpriseManaged on disk when it was the only non-secret field", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientSecret: "shh", enterpriseManaged: true },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh" });
    expect(stripped.oauth).toEqual({ enterpriseManaged: true });
  });

  // The stripped entry now subtracts the secret instead of enumerating the
  // fields to keep, so a field added to `oauth` later survives by construction.
  // `onInsufficientScope` is the case the old allow-list had already lost.
  it("preserves oauth.onInsufficientScope when lifting clientSecret to keychain", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: {
        clientId: "cid",
        clientSecret: "shh",
        onInsufficientScope: "throw",
      },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh" });
    expect(stripped.oauth).toEqual({
      clientId: "cid",
      onInsufficientScope: "throw",
    });
  });

  it("preserves oauth.authorizationParams when lifting clientSecret to keychain", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: {
        clientSecret: "shh",
        authorizationParams: { kc_idp_hint: "corp" },
      },
    };
    const { stripped } = extractSecretsFromStored(stored);
    expect(stripped.oauth).toEqual({
      authorizationParams: { kc_idp_hint: "corp" },
    });
  });

  it("removes the oauth block entirely when clientSecret was its only property", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientSecret: "shh" },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh" });
    expect(stripped).not.toHaveProperty("oauth");
  });

  it("clears stdio env values into the keychain map but preserves the keys on disk", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
      env: { API_KEY: "secret-1", DB_PASS: "secret-2", DEBUG: "" },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({
      [envSecretField("API_KEY")]: "secret-1",
      [envSecretField("DB_PASS")]: "secret-2",
    });
    // Empty values aren't written to the secrets record but the key stays.
    if (stripped.type === "stdio") {
      expect(stripped.env).toEqual({ API_KEY: "", DB_PASS: "", DEBUG: "" });
    } else {
      throw new Error("expected stdio");
    }
  });

  it("treats type-undefined entries as stdio for env handling", () => {
    const stored = {
      command: "node",
      env: { API_KEY: "v" },
    } as unknown as StoredMCPServer;
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({ [envSecretField("API_KEY")]: "v" });
    expect((stripped as { env?: Record<string, string> }).env).toEqual({
      API_KEY: "",
    });
  });

  it("is a no-op for entries with no secrets", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(secrets).toEqual({});
    expect(stripped).toEqual(stored);
  });

  it("does not mutate the input", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
      env: { K: "v" },
      oauth: { clientSecret: "shh" },
    };
    const snapshot = JSON.parse(JSON.stringify(stored));
    extractSecretsFromStored(stored);
    expect(stored).toEqual(snapshot);
  });
});

describe("mergeSecretsIntoStored", () => {
  it("inverses extractSecretsFromStored for OAuth", () => {
    const stored: StoredMCPServer = {
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientId: "cid" },
    };
    const merged = mergeSecretsIntoStored(stored, {
      [SECRET_FIELD_OAUTH_CLIENT_SECRET]: "shh",
    });
    expect(merged.oauth).toEqual({ clientId: "cid", clientSecret: "shh" });
  });

  it("inverses extractSecretsFromStored for stdio env values", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
      env: { K: "" },
    };
    const merged = mergeSecretsIntoStored(stored, {
      [envSecretField("K")]: "real",
    });
    if (merged.type === "stdio") {
      expect(merged.env).toEqual({ K: "real" });
    } else {
      throw new Error("expected stdio");
    }
  });

  it("round-trips extract then merge identically", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
      env: { API_KEY: "secret-1", DEBUG: "" },
      oauth: { clientId: "cid", clientSecret: "shh" },
    };
    const { stripped, secrets } = extractSecretsFromStored(stored);
    expect(mergeSecretsIntoStored(stripped, secrets)).toEqual(stored);
  });

  it("leaves env keys not present in the secrets map alone", () => {
    const stored: StoredMCPServer = {
      type: "stdio",
      command: "node",
      env: { ANSWERED: "", UNANSWERED: "" },
    };
    const merged = mergeSecretsIntoStored(stored, {
      [envSecretField("ANSWERED")]: "v",
    });
    if (merged.type === "stdio") {
      expect(merged.env).toEqual({ ANSWERED: "v", UNANSWERED: "" });
    } else {
      throw new Error("expected stdio");
    }
  });
});

describe("expectedSecretFields", () => {
  it("always lists the OAuth slot first", () => {
    const fields = expectedSecretFields({
      type: "streamable-http",
      url: "https://x.test",
    });
    expect(fields[0]).toBe(SECRET_FIELD_OAUTH_CLIENT_SECRET);
  });

  it("includes one entry per stdio env key", () => {
    const fields = expectedSecretFields({
      type: "stdio",
      command: "node",
      env: { A: "", B: "" },
    });
    expect(fields).toEqual([
      SECRET_FIELD_OAUTH_CLIENT_SECRET,
      envSecretField("A"),
      envSecretField("B"),
    ]);
  });

  it("returns only the OAuth slot when env is absent", () => {
    expect(
      expectedSecretFields({
        type: "stdio",
        command: "node",
      }),
    ).toEqual([SECRET_FIELD_OAUTH_CLIENT_SECRET]);
  });

  it("keeps a secret-only OAuth config reachable across the disk round trip", () => {
    // The OAuth slot is unconditional, and that is load-bearing rather
    // than merely defensive — skipping the keychain read for servers with
    // "no OAuth config" is a tempting optimization that would silently
    // stop rehydrating exactly this shape.
    //
    // `extractSecretsFromStored` deletes the `oauth` block outright when
    // `clientSecret` was its only property, so the on-disk entry carries
    // NO marker that a secret exists — the keychain is the only record.
    // The unconditional slot is what finds it again.
    const { stripped, secrets } = extractSecretsFromStored({
      type: "streamable-http",
      url: "https://x.test",
      oauth: { clientSecret: "shh" },
    });
    expect(stripped).not.toHaveProperty("oauth");

    // What a GET does: enumerate fields from the *stripped* on-disk shape,
    // read those from the keychain, merge back.
    const fields = expectedSecretFields(stripped);
    expect(fields).toContain(SECRET_FIELD_OAUTH_CLIENT_SECRET);

    const fromKeychain = Object.fromEntries(
      fields.filter((f) => f in secrets).map((f) => [f, secrets[f]!]),
    );
    expect(mergeSecretsIntoStored(stripped, fromKeychain).oauth).toEqual({
      clientSecret: "shh",
    });
  });
});

describe("enterpriseManaged oauth settings", () => {
  it("lifts oauth.enterpriseManaged to settings.enterpriseManaged", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: {
        clientId: "resource-as",
        enterpriseManaged: true,
      },
    });
    expect(settings?.enterpriseManaged).toBe(true);
    expect(settings?.oauthClientId).toBe("resource-as");
  });

  it("persists enterpriseManaged under oauth on disk", () => {
    const stored = inspectorSettingsToStoredFields({
      headers: [],
      env: [],
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 1000,
      roots: [],
      oauthClientId: "resource-as",
      enterpriseManaged: true,
    });
    expect(stored.oauth?.enterpriseManaged).toBe(true);
    expect(stored.oauth?.clientId).toBe("resource-as");
  });

  it("omits enterpriseManaged when false", () => {
    const stored = inspectorSettingsToStoredFields({
      headers: [],
      env: [],
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 1000,
      roots: [],
      enterpriseManaged: false,
    });
    expect(stored.oauth).toBeUndefined();
  });
});

describe("oauth.requestRefreshToken (#2068)", () => {
  const baseSettings = {
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };

  it("lifts an explicit false to settings.oauthRequestRefreshToken", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid", requestRefreshToken: false },
    });
    expect(settings?.oauthRequestRefreshToken).toBe(false);
  });

  it("leaves the setting unset when the field is absent (default: on)", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid" },
    });
    expect(settings?.oauthRequestRefreshToken).toBeUndefined();
  });

  it("leaves the setting unset for an explicit true, which means the default", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid", requestRefreshToken: true },
    });
    expect(settings?.oauthRequestRefreshToken).toBeUndefined();
  });

  it("persists the opt-out under oauth on disk", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthRequestRefreshToken: false,
    });
    expect(stored.oauth?.requestRefreshToken).toBe(false);
  });

  it("writes nothing when the setting is on", () => {
    expect(
      inspectorSettingsToStoredFields({
        ...baseSettings,
        oauthRequestRefreshToken: true,
      }).oauth,
    ).toBeUndefined();
    expect(inspectorSettingsToStoredFields(baseSettings).oauth).toBeUndefined();
  });

  it("round-trips the opt-out", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthRequestRefreshToken: false,
    });
    expect(
      storedFieldsToInspectorSettings(stored)?.oauthRequestRefreshToken,
    ).toBe(false);
  });
});

// #2144 — same inverted-default shape as `requestRefreshToken` above: on by
// default, and only the opt-out is written, so an entry that never touched the
// switch keeps a byte-stable round-trip.
describe("oauthRevokeOnClear (RFC 7009)", () => {
  const baseSettings = {
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };

  it("lifts an explicit false to settings.oauthRevokeOnClear", () => {
    expect(
      storedFieldsToInspectorSettings({
        oauth: { clientId: "cid", revokeOnClear: false },
      })?.oauthRevokeOnClear,
    ).toBe(false);
  });

  it("leaves the setting unset when the field is absent (default: on)", () => {
    expect(
      storedFieldsToInspectorSettings({ oauth: { clientId: "cid" } })
        ?.oauthRevokeOnClear,
    ).toBeUndefined();
  });

  it("leaves the setting unset for an explicit true, which means the default", () => {
    expect(
      storedFieldsToInspectorSettings({
        oauth: { clientId: "cid", revokeOnClear: true },
      })?.oauthRevokeOnClear,
    ).toBeUndefined();
  });

  it("persists the opt-out under oauth on disk", () => {
    expect(
      inspectorSettingsToStoredFields({
        ...baseSettings,
        oauthRevokeOnClear: false,
      }).oauth?.revokeOnClear,
    ).toBe(false);
  });

  it("writes nothing when the setting is on", () => {
    expect(
      inspectorSettingsToStoredFields({
        ...baseSettings,
        oauthRevokeOnClear: true,
      }).oauth,
    ).toBeUndefined();
  });

  it("round-trips the opt-out", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthRevokeOnClear: false,
    });
    expect(storedFieldsToInspectorSettings(stored)?.oauthRevokeOnClear).toBe(
      false,
    );
  });
});

describe("oauthOnInsufficientScope (SEP-2350)", () => {
  const baseSettings = {
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };

  it("lifts oauth.onInsufficientScope to settings", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid", onInsufficientScope: "throw" },
    });
    expect(settings?.oauthOnInsufficientScope).toBe("throw");
  });

  it("persists onInsufficientScope under oauth on disk", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthClientId: "cid",
      oauthOnInsufficientScope: "throw",
    });
    expect(stored.oauth?.onInsufficientScope).toBe("throw");
  });

  it("omits onInsufficientScope when unset", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthClientId: "cid",
    });
    expect(stored.oauth?.onInsufficientScope).toBeUndefined();
  });

  // #2018 — custom authorization-request parameters.
  it("lifts oauth.authorizationParams into settings rows", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { authorizationParams: { kc_idp_hint: "corp", prompt: "login" } },
    });
    expect(settings?.oauthAuthorizationParams).toEqual([
      { key: "kc_idp_hint", value: "corp" },
      { key: "prompt", value: "login" },
    ]);
  });

  it("reads an empty authorizationParams object back as unset", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid", authorizationParams: {} },
    });
    expect(settings?.oauthAuthorizationParams).toBeUndefined();
  });

  it("persists authorizationParams under oauth, dropping blank-key rows", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthAuthorizationParams: [
        { key: "kc_idp_hint", value: "corp" },
        { key: "   ", value: "orphan" },
      ],
    });
    expect(stored.oauth?.authorizationParams).toEqual({ kc_idp_hint: "corp" });
  });

  it("omits the oauth block when every authorization-param row is blank", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthAuthorizationParams: [{ key: "", value: "" }],
    });
    expect(stored).not.toHaveProperty("oauth");
  });

  it("omits authorizationParams when the rows are absent", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthClientId: "cid",
    });
    expect(stored.oauth?.authorizationParams).toBeUndefined();
  });

  it("derives the client option record, or undefined when nothing survives", () => {
    expect(
      oauthAuthorizationParamsFromSettings({
        oauthAuthorizationParams: [
          { key: "kc_idp_hint", value: "corp" },
          { key: "", value: "x" },
        ],
      }),
    ).toEqual({ kc_idp_hint: "corp" });
    expect(
      oauthAuthorizationParamsFromSettings({
        oauthAuthorizationParams: [{ key: " ", value: "x" }],
      }),
    ).toBeUndefined();
    expect(oauthAuthorizationParamsFromSettings({})).toBeUndefined();
  });

  // #1906 — authorization/token endpoint overrides.
  it("lifts oauth endpoint overrides into settings fields", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: {
        authorizationUrl: "https://staging.example.com/authorize",
        tokenUrl: "https://staging.example.com/token",
      },
    });
    expect(settings?.oauthAuthorizationUrl).toBe(
      "https://staging.example.com/authorize",
    );
    expect(settings?.oauthTokenUrl).toBe("https://staging.example.com/token");
  });

  // Hand-edited `mcp.json` reaches the CLI/TUI unvalidated, and
  // `oauthEndpointOverridesFromSettings` calls `.trim()` on these — so a
  // non-string would crash the server load rather than being ignored.
  it("drops a non-string endpoint override from disk", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = storedFieldsToInspectorSettings({
      oauth: {
        clientId: "cid",
        // Types the field as a string; disk does not honor that.
        authorizationUrl: 42 as unknown as string,
        tokenUrl: "https://staging.example.com/token",
      },
    });
    expect(settings?.oauthAuthorizationUrl).toBeUndefined();
    expect(settings?.oauthTokenUrl).toBe("https://staging.example.com/token");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("oauth.authorizationUrl"),
    );
    // Restored here rather than left to a global teardown: a later describe
    // spies on `console.warn` again and would inherit this spy's recorded call.
    warn.mockRestore();
  });

  it("reads a blank endpoint override back as unset", () => {
    const settings = storedFieldsToInspectorSettings({
      oauth: { clientId: "cid", authorizationUrl: "", tokenUrl: "" },
    });
    expect(settings?.oauthAuthorizationUrl).toBeUndefined();
    expect(settings?.oauthTokenUrl).toBeUndefined();
  });

  it("persists endpoint overrides under oauth, trimming whitespace", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthAuthorizationUrl: "  https://staging.example.com/authorize  ",
      oauthTokenUrl: "https://staging.example.com/token",
    });
    expect(stored.oauth).toEqual({
      authorizationUrl: "https://staging.example.com/authorize",
      tokenUrl: "https://staging.example.com/token",
    });
  });

  it("omits the oauth block when the endpoint overrides are blank", () => {
    const stored = inspectorSettingsToStoredFields({
      ...baseSettings,
      oauthAuthorizationUrl: "   ",
      oauthTokenUrl: "",
    });
    expect(stored).not.toHaveProperty("oauth");
  });

  it("derives the endpoint-override client option, or undefined when blank", () => {
    expect(
      oauthEndpointOverridesFromSettings({
        oauthAuthorizationUrl: " https://staging.example.com/authorize ",
      }),
    ).toEqual({ authorizationUrl: "https://staging.example.com/authorize" });
    expect(
      oauthEndpointOverridesFromSettings({
        oauthTokenUrl: "https://staging.example.com/token",
      }),
    ).toEqual({ tokenUrl: "https://staging.example.com/token" });
    expect(
      oauthEndpointOverridesFromSettings({ oauthAuthorizationUrl: "  " }),
    ).toBeUndefined();
    expect(oauthEndpointOverridesFromSettings({})).toBeUndefined();
  });
});

describe("normalizeStoredMetadata (#1910)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("passes an object through, values of any JSON type intact", () => {
    const meta = {
      s: "a",
      n: 1,
      b: false,
      z: null,
      arr: [1, { k: 2 }],
      o: { deep: true },
    };
    expect(normalizeStoredMetadata(meta)).toEqual(meta);
  });

  it("copies rather than aliasing the stored object", () => {
    // The settings object is edited in place by the form; sharing the
    // reference with the parsed catalog would mutate it behind the caller.
    const meta = { a: 1 };
    const out = normalizeStoredMetadata(meta);
    out.b = 2;
    expect(meta).toEqual({ a: 1 });
  });

  it("reads the pre-#1910 pair array so an existing mcp.json keeps working", () => {
    expect(
      normalizeStoredMetadata([
        { key: "tenant", value: "acme" },
        { key: "n", value: 3 },
      ]),
    ).toEqual({ tenant: "acme", n: 3 });
  });

  it("skips a blank-key legacy pair", () => {
    expect(
      normalizeStoredMetadata([
        { key: "", value: "orphan" },
        { key: "  ", value: "orphan" },
        { key: "kept", value: "yes" },
      ]),
    ).toEqual({ kept: "yes" });
  });

  it("preserves an explicit null in a legacy pair rather than blanking it", () => {
    // `null` is a legal `_meta` value, so the migration must not fold it into
    // `""` — only a genuinely absent `value` defaults.
    expect(normalizeStoredMetadata([{ key: "z", value: null }])).toEqual({
      z: null,
    });
  });

  it.each([
    ["the object form", { __proto__: { polluted: true } } as unknown],
    [
      "a hand-edited file's object form",
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ],
    ["the legacy pair form", [{ key: "__proto__", value: { polluted: true } }]],
  ])("stores a `__proto__` key from %s as an own property", (_label, input) => {
    // Plain assignment hits the prototype setter: the entry vanishes and, for
    // an object value, the result gets a caller-controlled prototype. Both
    // branches must define rather than set — the object branch regressed once
    // when it changed from a spread to a per-key loop.
    const out = normalizeStoredMetadata(input);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("stores a legacy `__proto__` key as an own property", () => {
    // Plain assignment would hit the prototype setter: the entry would vanish
    // (and an object value would mutate the prototype) instead of being stored.
    const out = normalizeStoredMetadata([
      { key: "__proto__", value: { polluted: true } },
    ]);
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(out["__proto__"]).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reads a legacy pair with no value as an empty string", () => {
    expect(normalizeStoredMetadata([{ key: "k" }])).toEqual({ k: "" });
  });

  it("drops a malformed legacy entry with a warning, keeping its siblings", () => {
    expect(
      normalizeStoredMetadata([
        "nope",
        null,
        { value: "no key" },
        { key: "kept", value: 1 },
      ]),
    ).toEqual({ kept: 1 });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("reads %s as the empty object without warning", (_label, input) => {
    expect(normalizeStoredMetadata(input)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "oops"],
    ["a number", 7],
    ["a boolean", true],
  ])("drops %s with a warning", (_label, input) => {
    expect(normalizeStoredMetadata(input)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("drops a value that parses but cannot be sent, keeping its siblings", () => {
    // A hand-edited catalog reaches this untouched by any editor, so it is a
    // real source of `1e400` — which parses to Infinity and serializes to null.
    const out = normalizeStoredMetadata(
      JSON.parse('{"good":1,"bad":1e400,"alsoGood":{"n":2}}'),
    );
    expect(out).toEqual({ good: 1, alsoGood: { n: 2 } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("drops a non-serializable value nested inside an object", () => {
    const out = normalizeStoredMetadata(JSON.parse('{"a":{"deep":[1e400]}}'));
    expect(out).toEqual({});
  });

  it("applies the same check to a legacy pair value", () => {
    const out = normalizeStoredMetadata([
      { key: "ok", value: 1 },
      { key: "bad", value: JSON.parse("1e400") },
    ]);
    expect(out).toEqual({ ok: 1 });
  });

  it("never prints the offending value in a warning", () => {
    // `_meta` can hold credentials, and these warnings go to ordinary console
    // output — so a diagnostic may name the key and the type, never the value.
    normalizeStoredMetadata([
      { value: { accessToken: "sk-live-nope" } },
      { key: "leaky", value: JSON.parse('{"token":1e400}') },
    ]);
    normalizeStoredMetadata("sk-live-also-nope");
    const printed = JSON.stringify(warn.mock.calls);
    expect(printed).not.toContain("sk-live");
    expect(printed).not.toContain("accessToken");
    // The key is still named, so the warning stays actionable.
    expect(printed).toContain("leaky");
  });

  it("migrates a legacy file to the object shape on the next write", () => {
    // Read side accepts the pair array; write side emits only the object, so
    // one round-trip is the migration.
    // The legacy on-disk shape no longer matches `MCPConfig` — that is what
    // the test is about — so the fixture is untyped and cast once where it
    // crosses into the typed parser, the same boundary a real file crosses.
    const legacyFile: unknown = {
      mcpServers: {
        legacy: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          metadata: [{ key: "tenant", value: "acme" }],
        },
      },
    };
    const entries = mcpConfigToServerEntries(legacyFile as MCPConfig);
    expect(entries[0]?.settings?.metadata).toEqual({ tenant: "acme" });
    const round = serverEntriesToMcpConfig(entries);
    expect(round.mcpServers.legacy?.metadata).toEqual({ tenant: "acme" });
  });
});

describe("envRecordToPairs / envPairsToRecord", () => {
  it("envRecordToPairs preserves key insertion order", () => {
    expect(envRecordToPairs({ B: "2", A: "1" })).toEqual([
      { key: "B", value: "2" },
      { key: "A", value: "1" },
    ]);
  });

  it("envRecordToPairs returns an empty array for undefined", () => {
    expect(envRecordToPairs(undefined)).toEqual([]);
  });

  it("envPairsToRecord drops empty / whitespace-only keys", () => {
    expect(
      envPairsToRecord([
        { key: "API_KEY", value: "secret" },
        { key: "", value: "ignored" },
        { key: "   ", value: "ignored" },
        { key: "DEBUG", value: "1" },
      ]),
    ).toEqual({ API_KEY: "secret", DEBUG: "1" });
  });

  it("round-trips a populated env through both converters", () => {
    const record = { API_KEY: "secret", DEBUG: "1" };
    expect(envPairsToRecord(envRecordToPairs(record))).toEqual(record);
  });
});

describe("stdio env / cwd mirroring", () => {
  it("lifts stdio env (object → pair-array) and cwd onto settings while keeping them on config", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "secret", DEBUG: "1" },
          cwd: "/srv/app",
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings?.env).toEqual([
      { key: "API_KEY", value: "secret" },
      { key: "DEBUG", value: "1" },
    ]);
    expect(entry?.settings?.cwd).toBe("/srv/app");
    // env / cwd remain on the SDK config so the transport still sees them.
    expect(entry?.config).toMatchObject({
      env: { API_KEY: "secret", DEBUG: "1" },
      cwd: "/srv/app",
    });
  });

  it("materializes a settings node for a bare stdio entry carrying only env", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: { type: "stdio", command: "node", env: { A: "1" } },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings?.env).toEqual([{ key: "A", value: "1" }]);
  });

  it("leaves env an empty list and cwd unset for a stdio entry without them", () => {
    const settings = storedFieldsToInspectorSettings({
      headers: { "X-A": "b" },
    });
    expect(settings?.env).toEqual([]);
    expect(settings?.cwd).toBeUndefined();
  });

  it("mirrors empty env for non-stdio servers", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          headers: { "X-Tenant": "acme" },
        },
      },
    };
    const [entry] = mcpConfigToServerEntries(cfg);
    expect(entry?.settings?.env).toEqual([]);
  });

  it("does NOT re-emit env / cwd from inspectorSettingsToStoredFields (config owns them on disk)", () => {
    // env / cwd are config fields; the write side is the PUT route's
    // write-through, not this converter. So even a populated settings.env must
    // not leak back as a settings delta that would clobber config on merge.
    const out = inspectorSettingsToStoredFields({
      headers: [],
      env: [{ key: "API_KEY", value: "secret" }],
      cwd: "/srv/app",
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 1000,
      roots: [],
    });
    expect(out).not.toHaveProperty("env");
    expect(out).not.toHaveProperty("cwd");
  });

  it("preserves stdio env / cwd through a config serialize round-trip", () => {
    const cfg: MCPConfig = {
      mcpServers: {
        alpha: {
          type: "stdio",
          command: "node",
          env: { API_KEY: "secret" },
          cwd: "/srv/app",
        },
      },
    };
    const entries = mcpConfigToServerEntries(cfg);
    const back = serverEntriesToMcpConfig(entries);
    expect(back.mcpServers.alpha).toMatchObject({
      command: "node",
      env: { API_KEY: "secret" },
      cwd: "/srv/app",
    });
  });
});

// #2018 — `StoredMCPServer.oauth.authorizationParams` is typed
// `Record<string, string>`, but only the web client's `/api/servers` route
// validates it; the CLI and TUI read `mcp.json` off disk. These cases drive the
// shapes a hand-edited file can hold, which the type says are impossible.
describe("cleanAuthorizationParams", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("passes a well-formed record through", () => {
    expect(
      cleanAuthorizationParams({ kc_idp_hint: "corp", prompt: "login" }),
    ).toEqual({ kc_idp_hint: "corp", prompt: "login" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns undefined for an absent or empty record", () => {
    expect(cleanAuthorizationParams(undefined)).toBeUndefined();
    expect(cleanAuthorizationParams({})).toBeUndefined();
  });

  // A bare string enumerates as character-indexed pairs (0=o, 1=o, …), so
  // without this guard the Inspector would send four invented parameters.
  it("rejects a string with a warning instead of enumerating its characters", () => {
    expect(
      cleanAuthorizationParams("oops" as unknown as Record<string, string>),
    ).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an array with a warning", () => {
    expect(
      cleanAuthorizationParams(["a"] as unknown as Record<string, string>),
    ).toBeUndefined();
    expect(warnSpy.mock.calls[0]?.[1]).toBe("array");
  });

  it("rejects null with a warning", () => {
    expect(
      cleanAuthorizationParams(null as unknown as Record<string, string>),
    ).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  // `URLSearchParams.set` stringifies whatever it is given, so a number would
  // otherwise reach the authorize URL as "5".
  it("drops a non-string value with a warning and keeps the rest", () => {
    expect(
      cleanAuthorizationParams({
        audience: 5,
        kc_idp_hint: "corp",
      } as unknown as Record<string, string>),
    ).toEqual({ kc_idp_hint: "corp" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when every value was dropped", () => {
    expect(
      cleanAuthorizationParams({ audience: 5 } as unknown as Record<
        string,
        string
      >),
    ).toBeUndefined();
  });

  it("skips a blank key", () => {
    expect(cleanAuthorizationParams({ "  ": "x", ok: "y" })).toEqual({
      ok: "y",
    });
  });

  it("is applied when lifting stored fields into settings", () => {
    const settings = storedFieldsToInspectorSettings({
      type: "streamable-http",
      url: "https://x.test",
      oauth: {
        authorizationParams: { audience: 5, kc_idp_hint: "corp" },
      },
    } as unknown as StoredMCPServer);
    expect(settings?.oauthAuthorizationParams).toEqual([
      { key: "kc_idp_hint", value: "corp" },
    ]);
  });
});

describe("stdio env/cwd settings → config mapping (#2096)", () => {
  // `env` and `cwd` are edited as settings but read by the transport off the
  // config, so both sides of the wire have to derive one from the other. This
  // is the single mapping they share — the PUT write-through persists it, the
  // web client applies it when constructing an InspectorClient.
  const settings = (
    over: Partial<InspectorServerSettings> = {},
  ): InspectorServerSettings => ({
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
    ...over,
  });

  describe("stdioConfigFieldsFromSettings", () => {
    it("collapses the pair rows into a record and trims the cwd", () => {
      expect(
        stdioConfigFieldsFromSettings(
          settings({
            env: [
              { key: "FOO", value: "after" },
              { key: "BAR", value: "" },
            ],
            cwd: "  /tmp/after  ",
          }),
        ),
      ).toEqual({ env: { FOO: "after", BAR: "" }, cwd: "/tmp/after" });
    });

    it("reports an empty list and a blank cwd as unset, i.e. cleared", () => {
      // The modal deletes a value by emptying it, so "no rows" cannot mean
      // "leave it alone" — it has to remove the field.
      expect(
        stdioConfigFieldsFromSettings(settings({ env: [], cwd: "   " })),
      ).toEqual({ env: undefined, cwd: undefined });
      // A row the user started and left blank is dropped, so it does not
      // materialize an env consisting of one nameless variable.
      expect(
        stdioConfigFieldsFromSettings(
          settings({ env: [{ key: "  ", value: "x" }] }),
        ).env,
      ).toBeUndefined();
    });
  });

  describe("applyStdioSettingsToConfig", () => {
    const stdio: MCPServerConfig = {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { FOO: "before" },
      cwd: "/tmp/before",
    };

    it("overwrites env/cwd and leaves the rest of the config alone", () => {
      expect(
        applyStdioSettingsToConfig(
          stdio,
          settings({
            env: [{ key: "FOO", value: "after" }],
            cwd: "/tmp/after",
          }),
        ),
      ).toEqual({
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { FOO: "after" },
        cwd: "/tmp/after",
      });
    });

    it("removes the fields the settings cleared", () => {
      expect(applyStdioSettingsToConfig(stdio, settings())).toEqual({
        type: "stdio",
        command: "node",
        args: ["server.js"],
      });
    });

    it("does not mutate the config it was given", () => {
      const before = { ...stdio };
      applyStdioSettingsToConfig(stdio, settings());
      expect(stdio).toEqual(before);
    });

    it("treats a typeless entry as stdio, matching the on-disk default", () => {
      // An `mcp.json` entry written without a `type` key is stdio (the Claude
      // Desktop convention), and the modal edits its env like any other.
      const applied = applyStdioSettingsToConfig(
        { command: "node" } as MCPServerConfig,
        settings({ env: [{ key: "FOO", value: "after" }] }),
      );
      expect(applied).toEqual({ command: "node", env: { FOO: "after" } });
    });

    it("returns a non-stdio config untouched", () => {
      // An HTTP server carries neither field, matching the modal's stdio-only
      // UI — applying an empty mirror to it must not invent one.
      const http: MCPServerConfig = {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
      };
      expect(applyStdioSettingsToConfig(http, settings())).toBe(http);
    });

    it("returns the config untouched when there are no settings", () => {
      // A server with no settings node has nothing to apply; treating that as
      // an empty mirror would clear an env the file does hold.
      expect(applyStdioSettingsToConfig(stdio, undefined)).toBe(stdio);
    });
  });
});
