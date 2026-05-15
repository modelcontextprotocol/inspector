/**
 * OAuthManager unit tests. Uses mocked getServerUrl, fetch, storage, and
 * dispatch callbacks to verify config merge, callback invocation, clearOAuthTokens,
 * error propagation, and getOAuthState/getOAuthStep after beginGuidedAuth.
 */
import { describe, it, expect, vi } from "vitest";
import {
  OAuthManager,
  type OAuthManagerConfig,
  type OAuthManagerParams,
} from "../../mcp/oauthManager.js";

const SERVER_URL = "https://example.com/mcp";

function createMockParams(
  overrides?: Partial<OAuthManagerParams>,
): OAuthManagerParams {
  const dispatchOAuthStepChange = vi.fn();
  const dispatchOAuthComplete = vi.fn();
  const dispatchOAuthAuthorizationRequired = vi.fn();
  const dispatchOAuthError = vi.fn();

  const storage = {
    getScope: vi.fn().mockResolvedValue(undefined),
    getClientInformation: vi.fn().mockResolvedValue(undefined),
    saveClientInformation: vi.fn().mockResolvedValue(undefined),
    savePreregisteredClientInformation: vi.fn().mockResolvedValue(undefined),
    saveScope: vi.fn().mockResolvedValue(undefined),
    getTokens: vi.fn().mockResolvedValue(undefined),
    saveTokens: vi.fn().mockResolvedValue(undefined),
    getCodeVerifier: vi.fn().mockReturnValue("verifier"),
    saveCodeVerifier: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    clearClientInformation: vi.fn(),
    clearTokens: vi.fn(),
    clearCodeVerifier: vi.fn(),
    clearScope: vi.fn(),
    clearServerMetadata: vi.fn(),
    getServerMetadata: vi.fn().mockReturnValue(null),
    saveServerMetadata: vi.fn().mockResolvedValue(undefined),
  };

  const redirectUrlProvider = {
    getRedirectUrl: vi.fn().mockReturnValue("http://localhost/callback"),
  };

  const navigation = {
    navigateToAuthorization: vi.fn(),
  };

  const initialConfig: OAuthManagerConfig = {
    storage,
    redirectUrlProvider,
    navigation,
    clientId: "test-client",
    clientSecret: "test-secret",
  };

  return {
    getServerUrl: vi.fn().mockReturnValue(SERVER_URL),
    effectiveAuthFetch: vi.fn().mockResolvedValue(new Response("{}")),
    getEventTarget: vi.fn().mockReturnValue(new EventTarget()),
    initialConfig,
    dispatchOAuthStepChange,
    dispatchOAuthComplete,
    dispatchOAuthAuthorizationRequired,
    dispatchOAuthError,
    ...overrides,
  };
}

describe("OAuthManager", () => {
  describe("setOAuthConfig", () => {
    it("merges config without throwing", () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      expect(() => {
        manager.setOAuthConfig({ scope: "read write" });
        manager.setOAuthConfig({ clientId: "new-id" });
      }).not.toThrow();
    });
  });

  describe("getServerUrl propagation", () => {
    it("createOAuthProviderForTransport throws when getServerUrl throws", async () => {
      const params = createMockParams({
        getServerUrl: vi.fn().mockImplementation(() => {
          throw new Error("OAuth is only supported for HTTP-based transports");
        }),
      });
      const manager = new OAuthManager(params);
      await expect(manager.createOAuthProviderForTransport()).rejects.toThrow(
        "OAuth is only supported for HTTP-based transports",
      );
    });
  });

  describe("clearOAuthTokens", () => {
    it("calls storage.clear(serverUrl) when storage is configured", () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      manager.clearOAuthTokens();
      expect(params.initialConfig.storage!.clear).toHaveBeenCalledWith(
        SERVER_URL,
      );
      expect(manager.getOAuthState()).toBeUndefined();
      expect(manager.getOAuthStep()).toBeUndefined();
    });

    it("no-ops when storage is not configured", () => {
      const params = createMockParams({
        initialConfig: {
          redirectUrlProvider: {
            getRedirectUrl: vi.fn().mockReturnValue("http://localhost"),
          },
          navigation: { navigateToAuthorization: vi.fn() },
        } as OAuthManagerConfig,
      });
      const manager = new OAuthManager(params);
      manager.clearOAuthTokens();
      expect(params.getServerUrl).not.toHaveBeenCalled();
    });
  });

  describe("getOAuthState / getOAuthStep", () => {
    it("returns undefined before any flow", () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      expect(manager.getOAuthState()).toBeUndefined();
      expect(manager.getOAuthStep()).toBeUndefined();
    });
  });

  describe("dispatch callbacks", () => {
    it("completeOAuthFlow calls dispatchOAuthError when normal path throws", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      // Normal path (no guided state): auth() will run and fail (no real server), so catch calls dispatchOAuthError
      await expect(manager.completeOAuthFlow("bad-code")).rejects.toThrow();
      expect(params.dispatchOAuthError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
      );
    });
  });

  describe("getOAuthTokens", () => {
    it("returns undefined when not authorized", async () => {
      const params = createMockParams();
      (
        params.initialConfig.storage as unknown as {
          getTokens: ReturnType<typeof vi.fn>;
        }
      ).getTokens.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);
      const tokens = await manager.getOAuthTokens();
      expect(tokens).toBeUndefined();
    });

    it("returns tokens from storage when no in-memory state", async () => {
      const params = createMockParams();
      const storedTokens = {
        access_token: "stored-token",
        token_type: "Bearer",
      };
      (
        params.initialConfig.storage as unknown as {
          getTokens: ReturnType<typeof vi.fn>;
        }
      ).getTokens.mockResolvedValue(storedTokens);
      const manager = new OAuthManager(params);
      const tokens = await manager.getOAuthTokens();
      expect(tokens).toEqual(storedTokens);
    });
  });

  describe("isOAuthAuthorized", () => {
    it("returns false when getOAuthTokens returns undefined", async () => {
      const params = createMockParams();
      (
        params.initialConfig.storage as unknown as {
          getTokens: ReturnType<typeof vi.fn>;
        }
      ).getTokens.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);
      expect(await manager.isOAuthAuthorized()).toBe(false);
    });

    it("returns true when getOAuthTokens returns tokens", async () => {
      const params = createMockParams();
      (
        params.initialConfig.storage as unknown as {
          getTokens: ReturnType<typeof vi.fn>;
        }
      ).getTokens.mockResolvedValue({
        access_token: "x",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);
      expect(await manager.isOAuthAuthorized()).toBe(true);
    });
  });

  describe("setGuidedAuthorizationCode", () => {
    it("throws when not in guided flow", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await expect(
        manager.setGuidedAuthorizationCode("code", true),
      ).rejects.toThrow("Not in guided OAuth flow");
    });
  });

  describe("proceedOAuthStep", () => {
    it("throws when not in guided flow", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await expect(manager.proceedOAuthStep()).rejects.toThrow(
        "Not in guided OAuth flow",
      );
    });
  });
});
