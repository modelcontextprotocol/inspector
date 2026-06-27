/**
 * OAuthManager unit tests. Uses mocked getServerUrl, fetch, storage, and
 * dispatch callbacks to verify config merge, callback invocation, clearOAuthTokens,
 * error propagation, and getOAuthFlowState/getOAuthFlowStep.
 */
import { describe, it, expect, vi } from "vitest";
import {
  OAuthManager,
  type OAuthManagerConfig,
  type OAuthManagerParams,
} from "@inspector/core/mcp/oauthManager.js";
import {
  EmaClientNotConfiguredError,
  emaClientNotConfiguredMessage,
} from "@inspector/core/auth/ema/clientConfigError.js";
import * as emaFlow from "@inspector/core/auth/ema/emaFlow.js";

const SERVER_URL = "https://example.com/mcp";

function createMockParams(
  overrides?: Partial<OAuthManagerParams>,
): OAuthManagerParams {
  const dispatchOAuthComplete = vi.fn();
  const dispatchOAuthAuthorizationRequired = vi.fn();
  const dispatchOAuthError = vi.fn();

  const storage = {
    getScope: vi.fn().mockReturnValue(undefined),
    getClientInformation: vi.fn().mockResolvedValue(undefined),
    getClientRegistrationKind: vi.fn().mockReturnValue(undefined),
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
    getIdpSession: vi.fn().mockResolvedValue(undefined),
    saveIdpSession: vi.fn().mockResolvedValue(undefined),
    clearIdpSession: vi.fn(),
    clearEnterpriseManagedResourceServers: vi.fn(),
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
      expect(manager.getOAuthFlowState()).toBeUndefined();
      expect(manager.getOAuthFlowStep()).toBeUndefined();
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

  describe("getOAuthState", () => {
    it("returns undefined when oauth is not configured for the server", async () => {
      const params = createMockParams({
        initialConfig: {
          storage: createMockParams().initialConfig.storage,
          redirectUrlProvider: {
            getRedirectUrl: vi
              .fn()
              .mockReturnValue("http://localhost/callback"),
          },
          navigation: { navigateToAuthorization: vi.fn() },
        } as OAuthManagerConfig,
      });
      const manager = new OAuthManager(params);
      await expect(manager.getOAuthState()).resolves.toBeUndefined();
    });

    it("returns connection state from storage", async () => {
      const params = createMockParams();
      (
        params.initialConfig.storage as unknown as {
          getTokens: ReturnType<typeof vi.fn>;
        }
      ).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);
      const state = await manager.getOAuthState();
      expect(state?.authorized).toBe(true);
      expect(state?.serverUrl).toBe(SERVER_URL);
      expect(state?.protocol).toBe("standard");
    });
  });

  describe("getOAuthFlowState / getOAuthFlowStep", () => {
    it("returns undefined before any flow", () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      expect(manager.getOAuthFlowState()).toBeUndefined();
      expect(manager.getOAuthFlowStep()).toBeUndefined();
    });
  });

  describe("dispatch callbacks", () => {
    it("completeOAuthFlow calls dispatchOAuthError when auth() throws", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
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

  describe("enterprise-managed auth", () => {
    function createEmaManager(
      overrides?: Partial<OAuthManagerParams>,
    ): OAuthManager {
      const params = createMockParams(overrides);
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });
      return manager;
    }

    it("throws not_configured when connecting without install IdP", async () => {
      const manager = createEmaManager();
      await expect(manager.authenticate()).rejects.toThrow(
        EmaClientNotConfiguredError,
      );
      await expect(manager.authenticate()).rejects.toThrow(
        emaClientNotConfiguredMessage("not_configured"),
      );
    });

    it("throws disabled when Enterprise IdP is turned off in Client Settings", async () => {
      const manager = createEmaManager({
        installEnterpriseManagedAuth: {
          enabled: false,
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      await expect(manager.authenticate()).rejects.toThrow(
        emaClientNotConfiguredMessage("disabled"),
      );
    });

    it("surfaces mint failures without redirecting to the IdP", async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payload = btoa(JSON.stringify({ exp }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const idToken = `header.${payload}.sig`;
      const issuer = "https://idp.example.com";

      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer,
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      params.initialConfig.storage!.getIdpSession = vi
        .fn()
        .mockResolvedValue({ idToken });
      params.initialConfig.clientSecret = "";

      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const startIdpSpy = vi.spyOn(emaFlow, "startEmaIdpAuthorization");

      await expect(manager.authenticate()).rejects.toThrow(
        /EMA legs 2–3 \(resource token mint\)/,
      );
      expect(startIdpSpy).not.toHaveBeenCalled();
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();

      startIdpSpy.mockRestore();
    });
  });
});
