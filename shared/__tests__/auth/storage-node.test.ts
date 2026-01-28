import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NodeOAuthStorage, getOAuthStore } from "../../auth/storage-node.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Get state file path (same logic as in storage-node.ts)
function getStateFilePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "oauth", "state.json");
}

describe("NodeOAuthStorage", () => {
  let storage: NodeOAuthStorage;
  const testServerUrl = "http://localhost:3000";
  const stateFilePath = getStateFilePath();

  beforeEach(async () => {
    // Clean up any existing state file
    try {
      await fs.unlink(stateFilePath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Reset store state by clearing all servers
    const store = getOAuthStore();
    const state = store.getState();
    // Clear all server states
    Object.keys(state.servers).forEach((url) => {
      state.clearServerState(url);
    });

    storage = new NodeOAuthStorage();
  });

  afterEach(async () => {
    // Clean up state file after each test
    try {
      await fs.unlink(stateFilePath);
    } catch {
      // Ignore if file doesn't exist
    }

    // Reset store state
    const store = getOAuthStore();
    const state = store.getState();
    Object.keys(state.servers).forEach((url) => {
      state.clearServerState(url);
    });
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

      await storage.saveClientInformation(testServerUrl, clientInfo);

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

      // Store as preregistered by directly setting it in the store
      const store = getOAuthStore();
      store.getState().setServerState(testServerUrl, {
        preregisteredClientInformation: preregisteredInfo,
      });

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

      await storage.saveClientInformation(testServerUrl, clientInfo);
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

      storage.saveClientInformation(testServerUrl, firstInfo);
      storage.saveClientInformation(testServerUrl, secondInfo);
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

  describe("clearServerState", () => {
    it("should clear all state for a server", async () => {
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };
      const tokens: OAuthTokens = {
        access_token: "test-token",
        token_type: "Bearer",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo);
      await storage.saveTokens(testServerUrl, tokens);

      storage.clear(testServerUrl);

      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
      expect(await storage.getTokens(testServerUrl)).toBeUndefined();
    });

    it("should not affect state for other servers", async () => {
      const otherServerUrl = "http://localhost:4000";
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      await storage.saveClientInformation(testServerUrl, clientInfo);
      await storage.saveClientInformation(otherServerUrl, clientInfo);

      storage.clear(testServerUrl);

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

      storage.saveClientInformation(server1Url, clientInfo1);
      storage.saveClientInformation(server2Url, clientInfo2);

      const result1 = await storage.getClientInformation(server1Url);
      const result2 = await storage.getClientInformation(server2Url);
      expect(result1).toEqual(clientInfo1);
      expect(result2).toEqual(clientInfo2);
    });
  });
});

describe("OAuth Store (Zustand)", () => {
  const stateFilePath = getStateFilePath();

  beforeEach(async () => {
    try {
      await fs.unlink(stateFilePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(stateFilePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("should create a new store", () => {
    const store = getOAuthStore();
    expect(store).toBeDefined();
    expect(store.getState).toBeDefined();
    expect(store.setState).toBeDefined();
  });

  it("should return the same store instance via getOAuthStore", () => {
    const store1 = getOAuthStore();
    const store2 = getOAuthStore();
    expect(store1).toBe(store2);
  });

  it("should persist state to file", async () => {
    const store = getOAuthStore();
    const serverUrl = "http://localhost:3000";
    const clientInfo: OAuthClientInformation = {
      client_id: "test-client-id",
    };

    store.getState().setServerState(serverUrl, {
      clientInformation: clientInfo,
    });

    // Zustand persist middleware writes asynchronously in the background
    // Wait for the file to be written by polling for its existence and content
    await vi.waitFor(
      async () => {
        const fileContent = await fs.readFile(stateFilePath, "utf-8");
        const parsed = JSON.parse(fileContent);
        expect(parsed.state.servers[serverUrl]).toBeDefined();
        expect(parsed.state.servers[serverUrl].clientInformation).toEqual(
          clientInfo,
        );
      },
      { timeout: 2000, interval: 50 },
    );
  });
});
