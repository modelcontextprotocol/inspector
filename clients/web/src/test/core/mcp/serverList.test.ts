import { describe, it, expect } from "vitest";
import {
  cleanRoots,
  DEFAULT_SEED_CONFIG,
  envPairsToRecord,
  envRecordToPairs,
  expectedSecretFields,
  extractSecretsFromStored,
  inspectorSettingsToStoredFields,
  mcpConfigToServerEntries,
  mergeSecretsIntoStored,
  normalizeServerType,
  serverEntriesToMcpConfig,
  serializeMcpConfig,
  storedFieldsToInspectorSettings,
} from "@inspector/core/mcp/serverList.js";
import {
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "@inspector/core/auth/secret-fields.js";
import type {
  MCPConfig,
  ServerEntry,
  StoredMCPServer,
} from "@inspector/core/mcp/types.js";

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
    // Disk shape: top-level `headers` (Record), `metadata` (pair-array),
    // numeric timeouts, nested `oauth`. Round-trip must preserve the on-
    // disk shape byte-equivalent so a hand-edited file is stable.
    const original: MCPConfig = {
      mcpServers: {
        gamma: {
          type: "streamable-http",
          url: "https://x.test/mcp",
          headers: { Authorization: "Bearer xyz" },
          metadata: [{ key: "tenant", value: "acme" }],
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
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
      // Absent taskTtl on disk → product default in memory (for the form)
      taskTtl: 60000,
      // Absent autoRefreshOnListChanged on disk → false in memory (for the form)
      autoRefreshOnListChanged: false,
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
          metadata: [],
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
          metadata: [],
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
          metadata: [],
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
          metadata: [],
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
          metadata: [],
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
      metadata: [],
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
      metadata: [],
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

describe("oauthOnInsufficientScope (SEP-2350)", () => {
  const baseSettings = {
    headers: [],
    env: [],
    metadata: [],
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
      metadata: [],
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
