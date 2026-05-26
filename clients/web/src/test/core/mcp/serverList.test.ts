import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEED_CONFIG,
  expectedSecretFields,
  extractSecretsFromStored,
  mcpConfigToServerEntries,
  mergeSecretsIntoStored,
  normalizeServerType,
  serverEntriesToMcpConfig,
  serializeMcpConfig,
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
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
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
          metadata: [],
          connectionTimeout: 0,
          requestTimeout: 0,
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
          metadata: [],
          connectionTimeout: 0,
          requestTimeout: 0,
        },
        connection: { status: "disconnected" },
      },
    ];
    const stored = serverEntriesToMcpConfig(entries).mcpServers.alpha;
    expect(stored).not.toHaveProperty("connectionTimeout");
    expect(stored).not.toHaveProperty("requestTimeout");
    expect(stored).not.toHaveProperty("oauth");
    expect(stored).not.toHaveProperty("headers");
    expect(stored).not.toHaveProperty("metadata");
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
