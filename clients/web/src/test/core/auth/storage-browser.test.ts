import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BrowserOAuthStorage,
  getBrowserOAuthStorage,
} from "@inspector/core/auth/browser/storage.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/client";

// Mock sessionStorage for Node.js environment
class MockSessionStorage implements Storage {
  private storage: Map<string, string> = new Map();

  get length(): number {
    return this.storage.size;
  }

  key(index: number): string | null {
    const keys = [...this.storage.keys()];
    return keys[index] ?? null;
  }

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
(global as typeof globalThis & { sessionStorage?: Storage }).sessionStorage =
  mockSessionStorage;

describe("getBrowserOAuthStorage", () => {
  it("returns the same singleton on repeated calls", () => {
    const first = getBrowserOAuthStorage();
    const second = getBrowserOAuthStorage();
    expect(second).toBe(first);
  });
});

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

      await storage.saveClientInformation(testServerUrl, clientInfo, {
        registrationKind: "dcr",
      });
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toEqual(clientInfo);
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

      expect(result).toEqual(preregisteredInfo);
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

      expect(result).toEqual(clientInfo);
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
        registrationKind: "cimd",
      });
      const result = await storage.getClientInformation(testServerUrl);

      expect(result).toEqual(secondInfo);
      expect(await storage.getClientRegistrationKind(testServerUrl)).toBe(
        "cimd",
      );
    });

    it("savePreregisteredClientInformation sets static registration kind", async () => {
      await storage.savePreregisteredClientInformation(testServerUrl, {
        client_id: "static-id",
      });
      expect(await storage.getClientRegistrationKind(testServerUrl)).toBe(
        "static",
      );
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

    it("should tag EMA resource tokens", async () => {
      const emaUrl = "https://mcp.test/mcp";
      const standardUrl = "https://other.test/sse";
      const tokens: OAuthTokens = {
        access_token: "ema-token",
        token_type: "Bearer",
      };

      await storage.saveTokens(emaUrl, tokens, { enterpriseManaged: true });
      await storage.saveTokens(standardUrl, tokens);

      await storage.clearEnterpriseManagedResourceServers();

      expect(await storage.getTokens(emaUrl)).toBeUndefined();
      expect(await storage.getTokens(standardUrl)).toEqual(tokens);
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
    it("removes the dynamically-registered client info by default", async () => {
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "dyn" },
        { registrationKind: "dcr" },
      );
      expect(await storage.getClientInformation(testServerUrl)).toEqual({
        client_id: "dyn",
      });
      await storage.clearClientInformation(testServerUrl);
      expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
    });

    it("removes the preregistered client info when isPreregistered=true", async () => {
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
      await storage.saveScope(testServerUrl, "read");
      expect(await storage.getScope(testServerUrl)).toBe("read");
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

      await storage.saveClientInformation(server1Url, clientInfo1, {
        registrationKind: "dcr",
      });
      await storage.saveClientInformation(server2Url, clientInfo2, {
        registrationKind: "dcr",
      });

      expect(await storage.getClientInformation(server1Url)).toEqual(
        clientInfo1,
      );
      expect(await storage.getClientInformation(server2Url)).toEqual(
        clientInfo2,
      );
    });
  });

  describe("SEP-2352 per-issuer keying", () => {
    const issuerA = "https://as-a.example.com";
    const issuerB = "https://as-b.example.com";

    it("keeps separate client registrations per issuer and re-attaches the issuer stamp on read", async () => {
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "client-a" },
        { registrationKind: "dcr", issuer: issuerA },
      );
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "client-b" },
        { registrationKind: "cimd", issuer: issuerB },
      );

      // Each issuer resolves its own credentials, stamped with its issuer
      // (SEP-2352) — the stamp is what lets the SDK reject cross-AS reuse.
      expect(
        await storage.getClientInformation(testServerUrl, false, issuerA),
      ).toEqual({ client_id: "client-a", issuer: issuerA });
      expect(
        await storage.getClientInformation(testServerUrl, false, issuerB),
      ).toEqual({ client_id: "client-b", issuer: issuerB });
      expect(
        await storage.getClientRegistrationKind(testServerUrl, issuerA),
      ).toBe("dcr");
      expect(
        await storage.getClientRegistrationKind(testServerUrl, issuerB),
      ).toBe("cimd");
    });

    it("answers a ctx-less token read from the most-recently-saved (active) issuer", async () => {
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-a", token_type: "Bearer" },
        { issuer: issuerA },
      );
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-b", token_type: "Bearer" },
        { issuer: issuerB },
      );

      // No issuer → active issuer (last saved = B); the per-request bearer read.
      expect(await storage.getTokens(testServerUrl)).toEqual({
        access_token: "tok-b",
        token_type: "Bearer",
        issuer: issuerB,
      });
      // Explicit issuer selects that AS's tokens.
      expect(await storage.getTokens(testServerUrl, issuerA)).toEqual({
        access_token: "tok-a",
        token_type: "Bearer",
        issuer: issuerA,
      });
    });

    it("promotes the legacy unkeyed slot: an unstamped token read falls back, then a stamped save supersedes it", async () => {
      // Legacy pre-1625 blob: unstamped tokens at the top level.
      await storage.saveTokens(testServerUrl, {
        access_token: "legacy",
        token_type: "Bearer",
      });
      // Read for a specific issuer falls back to the unkeyed slot (unstamped).
      expect(await storage.getTokens(testServerUrl, issuerA)).toEqual({
        access_token: "legacy",
        token_type: "Bearer",
      });

      // First stamped save promotes into byIssuer and clears the fallback.
      await storage.saveTokens(
        testServerUrl,
        { access_token: "fresh", token_type: "Bearer" },
        { issuer: issuerA },
      );
      expect(await storage.getTokens(testServerUrl, issuerA)).toEqual({
        access_token: "fresh",
        token_type: "Bearer",
        issuer: issuerA,
      });
    });

    it("clears a single issuer's tokens, leaving other issuers intact", async () => {
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-a", token_type: "Bearer" },
        { issuer: issuerA },
      );
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-b", token_type: "Bearer" },
        { issuer: issuerB },
      );

      await storage.clearTokens(testServerUrl, issuerA);

      expect(await storage.getTokens(testServerUrl, issuerA)).toBeUndefined();
      expect(await storage.getTokens(testServerUrl, issuerB)).toMatchObject({
        access_token: "tok-b",
      });
    });

    it("does not stamp a legacy fallback credential when the issuer slot lacks it", async () => {
      // Legacy unkeyed client info survives, but a byIssuer slot exists for
      // issuerA holding only tokens (no clientInformation). Reading client info
      // for issuerA must fall back to the legacy value WITHOUT stamping it with
      // issuerA — the legacy credential may have been minted by a different AS.
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "legacy-client" },
        { registrationKind: "dcr" },
      );
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-a", token_type: "Bearer" },
        { issuer: issuerA },
      );

      const clientInfo = await storage.getClientInformation(
        testServerUrl,
        false,
        issuerA,
      );
      // No issuer stamp — so the SDK's discardIfIssuerMismatch stays engaged.
      expect(clientInfo).toEqual({ client_id: "legacy-client" });

      // Symmetric case: legacy tokens survive, slot has only clientInformation.
      await storage.clear(testServerUrl);
      await storage.saveTokens(testServerUrl, {
        access_token: "legacy-tok",
        token_type: "Bearer",
      });
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "client-a" },
        { registrationKind: "dcr", issuer: issuerA },
      );
      const tokens = await storage.getTokens(testServerUrl, issuerA);
      expect(tokens).toEqual({
        access_token: "legacy-tok",
        token_type: "Bearer",
      });
    });

    it("does not promote a cleared issuer to the active (ctx-less) slot", async () => {
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-a", token_type: "Bearer" },
        { issuer: issuerA },
      );
      // Clearing a *different* issuer must not make it the active issuer.
      await storage.clearTokens(testServerUrl, issuerB);

      // The ctx-less (per-request bearer) read still resolves issuerA's token.
      expect(await storage.getTokens(testServerUrl)).toMatchObject({
        access_token: "tok-a",
      });
    });

    it("clears every issuer's tokens/registration when no issuer is given", async () => {
      await storage.saveTokens(
        testServerUrl,
        { access_token: "tok-a", token_type: "Bearer" },
        { issuer: issuerA },
      );
      await storage.saveClientInformation(
        testServerUrl,
        { client_id: "client-b" },
        { registrationKind: "dcr", issuer: issuerB },
      );

      await storage.clearTokens(testServerUrl);
      await storage.clearClientInformation(testServerUrl);

      expect(await storage.getTokens(testServerUrl, issuerA)).toBeUndefined();
      expect(
        await storage.getClientInformation(testServerUrl, false, issuerB),
      ).toBeUndefined();
    });

    it("tags EMA resource tokens even on the issuer-keyed save path", async () => {
      await storage.saveTokens(
        testServerUrl,
        { access_token: "ema", token_type: "Bearer" },
        { issuer: issuerA, enterpriseManaged: true },
      );

      await storage.clearEnterpriseManagedResourceServers();

      expect(await storage.getTokens(testServerUrl, issuerA)).toBeUndefined();
    });
  });

  describe("discovery state (SEP-2352)", () => {
    it("saves, reads, and clears the discovery state", async () => {
      expect(await storage.getDiscoveryState(testServerUrl)).toBeUndefined();

      const discoveryState = {
        authorizationServerUrl: "https://as.example.com",
        resourceMetadataUrl: "https://mcp.example.com/.well-known/x",
      };
      await storage.saveDiscoveryState(testServerUrl, discoveryState);
      expect(await storage.getDiscoveryState(testServerUrl)).toEqual(
        discoveryState,
      );

      await storage.clearDiscoveryState(testServerUrl);
      expect(await storage.getDiscoveryState(testServerUrl)).toBeUndefined();
    });
  });
});
