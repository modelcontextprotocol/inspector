import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BrowserOAuthStorage } from "../../auth/storage-browser.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// Mock sessionStorage for Node.js environment
class MockSessionStorage {
  private storage: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }
}

// Set up global sessionStorage mock
const mockSessionStorage = new MockSessionStorage();
(global as any).sessionStorage = mockSessionStorage;

describe("BrowserOAuthStorage", () => {
  let storage: BrowserOAuthStorage;
  const testServerUrl = "http://localhost:3000";

  beforeEach(() => {
    storage = new BrowserOAuthStorage();
    mockSessionStorage.clear();
  });

  afterEach(() => {
    mockSessionStorage.clear();
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

      storage.saveClientInformation(testServerUrl, clientInfo);
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toEqual(clientInfo);
    });

    it("should return preregistered client information when requested", async () => {
      const preregisteredInfo: OAuthClientInformation = {
        client_id: "preregistered-id",
        client_secret: "preregistered-secret",
      };

      // Browser storage uses a different key for preregistered info
      const { getServerSpecificKey, OAUTH_STORAGE_KEYS } =
        await import("../../auth/storage.js");
      const key = getServerSpecificKey(
        OAUTH_STORAGE_KEYS.PREREGISTERED_CLIENT_INFORMATION,
        testServerUrl,
      );
      mockSessionStorage.setItem(key, JSON.stringify(preregisteredInfo));

      const result = await storage.getClientInformation(testServerUrl, true);

      expect(result).toEqual(preregisteredInfo);
    });
  });

  describe("saveClientInformation", () => {
    it("should save client information", async () => {
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      storage.saveClientInformation(testServerUrl, clientInfo);
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toEqual(clientInfo);
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

      expect(result).toEqual(secondInfo);
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

      storage.saveTokens(testServerUrl, tokens);
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

      storage.saveTokens(testServerUrl, tokens);
      const result = await storage.getTokens(testServerUrl);

      expect(result).toEqual(tokens);
    });
  });

  describe("getCodeVerifier", () => {
    it("should return undefined when no code verifier is stored", async () => {
      const result = await storage.getCodeVerifier(testServerUrl);
      expect(result).toBeUndefined();
    });

    it("should return stored code verifier", async () => {
      const codeVerifier = "test-code-verifier";

      storage.saveCodeVerifier(testServerUrl, codeVerifier);
      const result = await storage.getCodeVerifier(testServerUrl);

      expect(result).toBe(codeVerifier);
    });
  });

  describe("saveCodeVerifier", () => {
    it("should save code verifier", async () => {
      const codeVerifier = "test-code-verifier";

      storage.saveCodeVerifier(testServerUrl, codeVerifier);
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

      storage.saveScope(testServerUrl, scope);
      const result = await storage.getScope(testServerUrl);

      expect(result).toBe(scope);
    });
  });

  describe("saveScope", () => {
    it("should save scope", async () => {
      const scope = "read write";

      storage.saveScope(testServerUrl, scope);
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

      storage.saveServerMetadata(testServerUrl, metadata);
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

      storage.saveServerMetadata(testServerUrl, metadata);
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

      storage.saveClientInformation(testServerUrl, clientInfo);
      storage.saveTokens(testServerUrl, tokens);

      storage.clear(testServerUrl);

      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
      expect(await storage.getTokens(testServerUrl)).toBeUndefined();
    });

    it("should not affect state for other servers", async () => {
      const otherServerUrl = "http://localhost:4000";
      const clientInfo: OAuthClientInformation = {
        client_id: "test-client-id",
      };

      storage.saveClientInformation(testServerUrl, clientInfo);
      storage.saveClientInformation(otherServerUrl, clientInfo);

      storage.clear(testServerUrl);

      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
      expect(await storage.getClientInformation(otherServerUrl)).toEqual(
        clientInfo,
      );
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

      expect(await storage.getClientInformation(server1Url)).toEqual(
        clientInfo1,
      );
      expect(await storage.getClientInformation(server2Url)).toEqual(
        clientInfo2,
      );
    });
  });
});
