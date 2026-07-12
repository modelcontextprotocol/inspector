import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  NodeOAuthStorage,
  getStateFilePath,
  resetNodeOAuthStorageCache,
  clearAllOAuthClientState,
} from "@inspector/core/auth/node/storage-node.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { flushStoreFileWrites } from "@inspector/core/storage/store-io.js";

// Unique path per process so parallel test files don't share the same state file
const testStatePath = path.join(
  os.tmpdir(),
  `mcp-inspector-oauth-${process.pid}-storage-node.json`,
);

async function resetTestStorage(stateFilePath: string): Promise<void> {
  try {
    await fs.unlink(stateFilePath);
  } catch {
    // Ignore if file doesn't exist
  }
  resetNodeOAuthStorageCache(stateFilePath);
}

describe("NodeOAuthStorage", () => {
  let storage: NodeOAuthStorage;
  const testServerUrl = "http://localhost:3000";
  const stateFilePath = testStatePath;

  beforeEach(async () => {
    await resetTestStorage(stateFilePath);
    storage = new NodeOAuthStorage(testStatePath);
  });

  afterEach(async () => {
    await resetTestStorage(stateFilePath);
  });

  describe("getClientInformation", () => {
    it("should return undefined when no client information is stored", async () => {
      const result = await storage.getClientInformation(testServerUrl);
      expect(result).toBeUndefined();
    });

    it("should return stored client information", async () => {
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
        client_secret: "test-secret",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo, {
        registrationKind: "dcr",
      });

      const result = await storage.getClientInformation(testServerUrl);
      expect(result).toBeDefined();
      expect(result?.client_id).toBe(clientInfo.client_id);
      expect(result?.client_secret).toBe(clientInfo.client_secret);
    });

    it("should return preregistered client information when requested", async () => {
      const preregisteredInfo: OAuthClientInformation = {
        client_id: "preregistered-id",
        client_secret: "preregistered-secret",
      };

      await storage.savePreregisteredClientInformation(
        testServerUrl,
        preregisteredInfo,
      );

      const result = await storage.getClientInformation(testServerUrl, true);

      expect(result).toBeDefined();
      expect(result?.client_id).toBe(preregisteredInfo.client_id);
      expect(result?.client_secret).toBe(preregisteredInfo.client_secret);
    });
  });

  describe("saveClientInformation", () => {
    it("should save client information", async () => {
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo, {
        registrationKind: "dcr",
      });
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toBeDefined();
      expect(result?.client_id).toBe(clientInfo.client_id);
    });

    it("should overwrite existing client information", async () => {
      const firstInfo: OAuthClientInformation = {
        client_id: "first-id",
      };

      const secondInfo: OAuthClientInformation = {
        client_id: "second-id",
      };

      await storage.saveClientInformation(testServerUrl, firstInfo, {
        registrationKind: "dcr",
      });
      await storage.saveClientInformation(testServerUrl, secondInfo, {
        registrationKind: "dcr",
      });
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toBeDefined();
      expect(result?.client_id).toBe(secondInfo.client_id);
    });
  });

  describe("getTokens", () => {
    it("should return undefined when no tokens are stored", async () => {
      const result = await storage.getTokens(testServerUrl);
      expect(result).toBeUndefined();
    });

    it("should return stored tokens", async () => {
      const tokens: OAuthTokens = {
        access_token: "test-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      };

      await storage.saveTokens(testServerUrl, tokens);
      const result = await storage.getTokens(testServerUrl);

      expect(result).toEqual(tokens);
    });

    it("should persist and return refresh_token", async () => {
      const tokens: OAuthTokens = {
        access_token: "test-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "test-refresh-token",
      };

      await storage.saveTokens(testServerUrl, tokens);
      const result = await storage.getTokens(testServerUrl);

      expect(result).toBeDefined();
      expect(result?.access_token).toBe(tokens.access_token);
      expect(result?.refresh_token).toBe(tokens.refresh_token);
    });
  });

  describe("saveTokens", () => {
    it("should save tokens", async () => {
      const tokens: OAuthTokens = {
        access_token: "test-access-token",
        token_type: "Bearer",
      };

      await storage.saveTokens(testServerUrl, tokens);
      const result = await storage.getTokens(testServerUrl);

      expect(result).toEqual(tokens);
    });

    it("should overwrite existing tokens", async () => {
      const firstTokens: OAuthTokens = {
        access_token: "first-token",
        token_type: "Bearer",
      };

      const secondTokens: OAuthTokens = {
        access_token: "second-token",
        token_type: "Bearer",
      };

      await storage.saveTokens(testServerUrl, firstTokens);
      await storage.saveTokens(testServerUrl, secondTokens);
      const result = await storage.getTokens(testServerUrl);

      expect(result).toEqual(secondTokens);
    });
  });

  describe("getCodeVerifier", () => {
    it("should return undefined when no code verifier is stored", async () => {
      const result = await storage.getCodeVerifier(testServerUrl);
      expect(result).toBeUndefined();
    });

    it("should return stored code verifier", async () => {
      const codeVerifier = "test-code-verifier";

      await storage.saveCodeVerifier(testServerUrl, codeVerifier);
      const result = await storage.getCodeVerifier(testServerUrl);

      expect(result).toBe(codeVerifier);
    });
  });

  describe("saveCodeVerifier", () => {
    it("should save code verifier", async () => {
      const codeVerifier = "test-code-verifier";

      await storage.saveCodeVerifier(testServerUrl, codeVerifier);
      const result = await storage.getCodeVerifier(testServerUrl);

      expect(result).toBe(codeVerifier);
    });
  });

  describe("getScope", () => {
    it("should return undefined when no scope is stored", async () => {
      const result = await storage.getScope(testServerUrl);
      expect(result).toBeUndefined();
    });

    it("should return stored scope", async () => {
      const scope = "read write";

      await storage.saveScope(testServerUrl, scope);
      const result = await storage.getScope(testServerUrl);

      expect(result).toBe(scope);
    });
  });

  describe("saveScope", () => {
    it("should save scope", async () => {
      const scope = "read write";

      await storage.saveScope(testServerUrl, scope);
      const result = await storage.getScope(testServerUrl);

      expect(result).toBe(scope);
    });
  });

  describe("getServerMetadata", () => {
    it("should return null when no metadata is stored", async () => {
      const result = await storage.getServerMetadata(testServerUrl);
      expect(result).toBeNull();
    });

    it("should return stored metadata", async () => {
      const metadata: OAuthMetadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };

      await storage.saveServerMetadata(testServerUrl, metadata);
      const result = await storage.getServerMetadata(testServerUrl);

      expect(result).toEqual(metadata);
    });
  });

  describe("saveServerMetadata", () => {
    it("should save server metadata", async () => {
      const metadata: OAuthMetadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };

      await storage.saveServerMetadata(testServerUrl, metadata);
      const result = await storage.getServerMetadata(testServerUrl);

      expect(result).toEqual(metadata);
    });
  });

  describe("clearClientInformation", () => {
    it("removes the dynamically-registered client information by default", async () => {
      await storage.saveClientInformation(
        testServerUrl,
        {
          client_id: "dyn",
        },
        { registrationKind: "dcr" },
      );
      expect(await storage.getClientInformation(testServerUrl)).toEqual({
        client_id: "dyn",
      });
      await storage.clearClientInformation(testServerUrl);
      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
    });

    it("removes the preregistered client information when isPreregistered=true", async () => {
      await storage.savePreregisteredClientInformation(testServerUrl, {
        client_id: "pre",
      });
      expect(await storage.getClientInformation(testServerUrl, true)).toEqual({
        client_id: "pre",
      });
      await storage.clearClientInformation(testServerUrl, true);
      expect(
        await storage.getClientInformation(testServerUrl, true),
      ).toBeUndefined();
    });
  });

  describe("individual clear methods", () => {
    it("clearTokens removes only tokens", async () => {
      await storage.saveTokens(testServerUrl, {
        access_token: "t",
        token_type: "Bearer",
      });
      expect(await storage.getTokens(testServerUrl)).toBeDefined();
      await storage.clearTokens(testServerUrl);
      expect(await storage.getTokens(testServerUrl)).toBeUndefined();
    });

    it("clearCodeVerifier removes only the PKCE verifier", async () => {
      await storage.saveCodeVerifier(testServerUrl, "verifier");
      expect(await storage.getCodeVerifier(testServerUrl)).toBe("verifier");
      await storage.clearCodeVerifier(testServerUrl);
      expect(await storage.getCodeVerifier(testServerUrl)).toBeUndefined();
    });

    it("clearScope removes only the scope", async () => {
      await storage.saveScope(testServerUrl, "read write");
      expect(await storage.getScope(testServerUrl)).toBe("read write");
      await storage.clearScope(testServerUrl);
      expect(await storage.getScope(testServerUrl)).toBeUndefined();
    });

    it("clearServerMetadata removes only the cached metadata", async () => {
      const metadata: OAuthMetadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };
      await storage.saveServerMetadata(testServerUrl, metadata);
      expect(await storage.getServerMetadata(testServerUrl)).toEqual(metadata);
      await storage.clearServerMetadata(testServerUrl);
      expect(await storage.getServerMetadata(testServerUrl)).toBeNull();
    });
  });

  describe("clearServerState", () => {
    it("should clear all state for a server", async () => {
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };
      const tokens: OAuthTokens = {
        access_token: "test-token",
        token_type: "Bearer",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo, {
        registrationKind: "dcr",
      });
      await storage.saveTokens(testServerUrl, tokens);

      await storage.clear(testServerUrl);

      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
      expect(await storage.getTokens(testServerUrl)).toBeUndefined();
    });

    it("should not affect state for other servers", async () => {
      const otherServerUrl = "http://localhost:4000";
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo, {
        registrationKind: "dcr",
      });
      await storage.saveClientInformation(otherServerUrl, clientInfo, {
        registrationKind: "dcr",
      });

      await storage.clear(testServerUrl);

      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
      const otherResult = await storage.getClientInformation(otherServerUrl);
      expect(otherResult).toBeDefined();
      expect(otherResult?.client_id).toBe(clientInfo.client_id);
      expect(otherResult).toEqual(clientInfo);
    });
  });

  describe("multiple servers", () => {
    it("should store separate state for different servers", async () => {
      const server1Url = "http://localhost:3000";
      const server2Url = "http://localhost:4000";

      const clientInfo1: OAuthClientInformation = {
        client_id: "client-1",
      };

      const clientInfo2: OAuthClientInformation = {
        client_id: "client-2",
      };

      await storage.saveClientInformation(server1Url, clientInfo1, {
        registrationKind: "dcr",
      });
      await storage.saveClientInformation(server2Url, clientInfo2, {
        registrationKind: "dcr",
      });

      const result1 = await storage.getClientInformation(server1Url);
      const result2 = await storage.getClientInformation(server2Url);
      expect(result1).toEqual(clientInfo1);
      expect(result2).toEqual(clientInfo2);
    });
  });

  it("reuses in-memory state for the same file path", async () => {
    const serverUrl = "http://localhost:3000";
    const tokens: OAuthTokens = {
      access_token: "shared-memory-token",
      token_type: "Bearer",
    };

    await storage.saveTokens(serverUrl, tokens);

    const otherView = new NodeOAuthStorage(testStatePath);
    expect(await otherView.getTokens(serverUrl)).toEqual(tokens);
  });

  it("persists state to file on save", async () => {
    const persistTestPath = path.join(
      os.tmpdir(),
      `mcp-inspector-oauth-persist-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    try {
      resetNodeOAuthStorageCache(persistTestPath);
      const fileStorage = new NodeOAuthStorage(persistTestPath);
      const serverUrl = "http://localhost:3000";
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      await fileStorage.saveClientInformation(serverUrl, clientInfo, {
        registrationKind: "dcr",
      });

      type StateShape = {
        servers: Record<string, { clientInformation?: OAuthClientInformation }>;
      };
      await flushStoreFileWrites(persistTestPath);
      const parsed = JSON.parse(
        await fs.readFile(persistTestPath, "utf-8"),
      ) as StateShape;
      expect(parsed.servers[serverUrl]?.clientInformation).toEqual(clientInfo);
    } finally {
      try {
        await fs.unlink(persistTestPath);
      } catch {
        /* ignore */
      }
      resetNodeOAuthStorageCache(persistTestPath);
    }
  });
});

describe("NodeOAuthStorage idpSessions (EMA)", () => {
  let storage: NodeOAuthStorage;
  const testStatePath = path.join(
    os.tmpdir(),
    `mcp-inspector-oauth-idp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const issuer = "https://idp.example.com";

  afterEach(async () => {
    try {
      await fs.unlink(testStatePath);
    } catch {
      /* ignore */
    }
  });

  it("persists IdP session keyed by issuer", async () => {
    storage = new NodeOAuthStorage(testStatePath);
    await storage.saveIdpSession(issuer, {
      idToken: "eyJ.id.token",
      refreshToken: "rt-1",
      idTokenExpiresAt: 1_700_000_000_000,
    });
    await flushStoreFileWrites(testStatePath);

    const session = await storage.getIdpSession(issuer);
    expect(session?.idToken).toBe("eyJ.id.token");
    expect(session?.refreshToken).toBe("rt-1");

    await storage.clearIdpSession(issuer);
    await flushStoreFileWrites(testStatePath);
    expect(await storage.getIdpSession(issuer)).toBeUndefined();
  });
});

describe("NodeOAuthStorage with custom storagePath", () => {
  const testServerUrl = "http://localhost:3999";

  it("should use custom path for state file", async () => {
    const customPath = path.join(
      os.tmpdir(),
      `mcp-inspector-oauth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );

    try {
      const storage = new NodeOAuthStorage(customPath);
      const tokens: OAuthTokens = {
        access_token: "custom-path-token",
        token_type: "Bearer",
        refresh_token: "custom-refresh",
      };
      await storage.saveTokens(testServerUrl, tokens);

      type StateShape = {
        servers: Record<string, { tokens?: { access_token?: string } }>;
      };
      // Persistence is fire-and-forget; await the write rather than polling.
      await flushStoreFileWrites(customPath);
      const parsed = JSON.parse(
        await fs.readFile(customPath, "utf-8"),
      ) as StateShape;

      expect(parsed.servers[testServerUrl]?.tokens?.access_token).toBe(
        tokens.access_token,
      );

      const stored = await storage.getTokens(testServerUrl);
      expect(stored?.access_token).toBe(tokens.access_token);
      expect(stored?.refresh_token).toBe(tokens.refresh_token);
    } finally {
      try {
        await fs.unlink(customPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("clearAllOAuthClientState clears every server in the default store", async () => {
    resetNodeOAuthStorageCache();
    const storage = new NodeOAuthStorage();
    await storage.saveTokens("http://server-a.test", {
      access_token: "a",
      token_type: "Bearer",
    });
    await storage.saveTokens("http://server-b.test", {
      access_token: "b",
      token_type: "Bearer",
    });
    await flushStoreFileWrites(getStateFilePath());

    await clearAllOAuthClientState();

    expect(await storage.getTokens("http://server-a.test")).toBeUndefined();
    expect(await storage.getTokens("http://server-b.test")).toBeUndefined();

    resetNodeOAuthStorageCache();
  });

  it("clearAllOAuthClientState tolerates persisted state without a servers map", async () => {
    const filePath = getStateFilePath();
    resetNodeOAuthStorageCache();
    await fs.writeFile(filePath, JSON.stringify({ idpSessions: {} }), "utf-8");

    await expect(clearAllOAuthClientState()).resolves.toBeUndefined();

    resetNodeOAuthStorageCache();
  });

  it("clearAllOAuthClientState is a no-op when no store file exists", async () => {
    // Exercises the null-snapshot branch: read() returns null, so
    // `snapshot?.servers ?? {}` yields no urls and nothing is cleared.
    const filePath = getStateFilePath();
    resetNodeOAuthStorageCache();
    await fs.unlink(filePath).catch(() => {});

    await expect(clearAllOAuthClientState()).resolves.toBeUndefined();

    resetNodeOAuthStorageCache();
  });

  it("should isolate state from default store", async () => {
    const customPath = path.join(
      os.tmpdir(),
      `mcp-inspector-oauth-isolate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );

    try {
      resetNodeOAuthStorageCache();
      const defaultStorage = new NodeOAuthStorage();
      await defaultStorage.saveTokens(testServerUrl, {
        access_token: "default-token",
        token_type: "Bearer",
      });

      resetNodeOAuthStorageCache(customPath);
      const customStorage = new NodeOAuthStorage(customPath);
      await customStorage.saveTokens(testServerUrl, {
        access_token: "custom-token",
        token_type: "Bearer",
      });

      const fromCustom = await customStorage.getTokens(testServerUrl);
      expect(fromCustom?.access_token).toBe("custom-token");

      const fromDefault = await defaultStorage.getTokens(testServerUrl);
      expect(fromDefault?.access_token).toBe("default-token");

      await defaultStorage.clear(testServerUrl);
    } finally {
      try {
        await fs.unlink(customPath);
      } catch {
        /* ignore */
      }
      resetNodeOAuthStorageCache(customPath);
      resetNodeOAuthStorageCache();
    }
  });
});

describe("getStateFilePath resolution", () => {
  let savedStatePath: string | undefined;
  let savedStorageDir: string | undefined;

  beforeEach(() => {
    savedStatePath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    savedStorageDir = process.env.MCP_STORAGE_DIR;
    delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    delete process.env.MCP_STORAGE_DIR;
  });

  afterEach(() => {
    if (savedStatePath === undefined)
      delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    else process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = savedStatePath;
    if (savedStorageDir === undefined) delete process.env.MCP_STORAGE_DIR;
    else process.env.MCP_STORAGE_DIR = savedStorageDir;
  });

  it("prefers an explicit customPath over every env var", () => {
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = "/env/oauth.json";
    process.env.MCP_STORAGE_DIR = "/env/dir";
    expect(getStateFilePath("/explicit/path.json")).toBe("/explicit/path.json");
  });

  it("uses MCP_INSPECTOR_OAUTH_STATE_PATH over MCP_STORAGE_DIR", () => {
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = "/env/oauth.json";
    process.env.MCP_STORAGE_DIR = "/env/dir";
    expect(getStateFilePath()).toBe("/env/oauth.json");
  });

  it("uses <MCP_STORAGE_DIR>/oauth.json when only the storage dir is set", () => {
    process.env.MCP_STORAGE_DIR = path.join("/env", "storage");
    expect(getStateFilePath()).toBe(path.join("/env", "storage", "oauth.json"));
  });

  it("falls back to the default path when no override is set", () => {
    expect(getStateFilePath()).toContain(
      path.join(".mcp-inspector", "storage", "oauth.json"),
    );
  });
});
