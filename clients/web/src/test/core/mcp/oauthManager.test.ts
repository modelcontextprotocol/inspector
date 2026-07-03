/**
 * OAuthManager unit tests. Uses mocked getServerUrl, fetch, storage, and
 * dispatch callbacks to verify config merge, callback invocation, clearOAuthTokens,
 * error propagation, and getOAuthFlowState/getOAuthFlowStep.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { mcpAuth } from "@inspector/core/auth/mcpAuth.js";

// Mock mcpAuth so OAuthManager tests do not hit the network.
vi.mock("@inspector/core/auth/mcpAuth.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/auth/mcpAuth.js")>();
  return { ...actual, mcpAuth: vi.fn() };
});

const mockedMcpAuth = vi.mocked(mcpAuth);

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

/**
 * Storage typed accessor for casting the mock storage's methods in tests.
 */
type MockStorage = Record<string, ReturnType<typeof vi.fn>>;
function storageOf(params: OAuthManagerParams): MockStorage {
  return params.initialConfig.storage as unknown as MockStorage;
}

describe("OAuthManager", () => {
  beforeEach(() => {
    mockedMcpAuth.mockReset();
  });

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

    it("returns undefined when provider.tokens() throws", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockRejectedValue(new Error("boom"));
      const manager = new OAuthManager(params);
      expect(await manager.getOAuthTokens()).toBeUndefined();
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

  describe("createOAuthProvider validation", () => {
    it("authenticate throws when storage component is missing", async () => {
      const params = createMockParams({
        initialConfig: {
          redirectUrlProvider: {
            getRedirectUrl: vi
              .fn()
              .mockReturnValue("http://localhost/callback"),
          },
          navigation: { navigateToAuthorization: vi.fn() },
        } as OAuthManagerConfig,
      });
      const manager = new OAuthManager(params);
      await expect(manager.authenticate()).rejects.toThrow(
        "OAuth environment components (storage, navigation, redirectUrlProvider) are required.",
      );
    });
  });

  describe("getEmaFlowConfig validation", () => {
    it("throws when storage/redirectUrlProvider are missing for an EMA flow", async () => {
      const params = createMockParams({
        initialConfig: {
          navigation: { navigateToAuthorization: vi.fn() },
        } as OAuthManagerConfig,
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });
      await expect(manager.trySilentEnterpriseManagedAuth()).rejects.toThrow(
        "OAuth environment components (storage, redirectUrlProvider) are required.",
      );
    });
  });

  describe("authenticate (quick, standard)", () => {
    it("captures the authorization URL, runs onBeforeOAuthRedirect, and stores flow state", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=abc",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue({
          execution: "quick",
          authId: "auth-id-1",
        } as ReturnType<
          typeof import("@inspector/core/auth/utils.js").parseOAuthState
        >);

      const onBeforeOAuthRedirect = vi.fn().mockResolvedValue(undefined);
      const params = createMockParams({ onBeforeOAuthRedirect });
      // A configured scope exercises the saveScope branch in createOAuthProvider.
      params.initialConfig.scope = "read write";
      storageOf(params).getScope.mockReturnValue(undefined);
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });

      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      const result = await manager.authenticate();

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "read write",
      );
      expect(result).toEqual(capturedUrl);
      expect(onBeforeOAuthRedirect).toHaveBeenCalledWith("auth-id-1");
      expect(manager.getOAuthFlowStep()).toBe("authorization_code");
      expect(manager.getOAuthFlowState()?.oauthClientInfo).toEqual({
        client_id: "cid",
      });

      parseSpy.mockRestore();
      captureSpy.mockRestore();
    });

    it("preserves stored scope instead of resetting to config scope", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=abc",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      params.initialConfig.scope = "mcp tools:read";
      storageOf(params).getScope.mockReturnValue("mcp tools:read weather:read");
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      await manager.authenticate();

      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scope: "mcp tools:read weather:read",
        }),
      );
      captureSpy.mockRestore();
    });

    it("throws when auth() unexpectedly returns AUTHORIZED", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());
      await expect(manager.authenticate()).rejects.toThrow(
        "Unexpected: auth() returned AUTHORIZED without authorization code",
      );
    });

    it("throws when no authorization URL is captured", async () => {
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const manager = new OAuthManager(createMockParams());
      // Default provider captures nothing (auth() is mocked and never redirects).
      await expect(manager.authenticate()).rejects.toThrow(
        "Failed to capture authorization URL",
      );
    });

    it("skips onBeforeOAuthRedirect when state param has no authId", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=zzz",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue(null);
      const onBeforeOAuthRedirect = vi.fn();
      const params = createMockParams({ onBeforeOAuthRedirect });
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      await manager.authenticate();
      expect(onBeforeOAuthRedirect).not.toHaveBeenCalled();

      parseSpy.mockRestore();
      captureSpy.mockRestore();
    });
  });

  describe("completeOAuthFlow (quick, standard)", () => {
    it("completes via the quick path and dispatches complete", async () => {
      const tokens = { access_token: "QT", token_type: "Bearer" };
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue(tokens);
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);

      await manager.completeOAuthFlow("code-xyz");

      expect(params.dispatchOAuthComplete).toHaveBeenCalledWith({ tokens });
      expect(manager.getOAuthFlowStep()).toBe("complete");
    });

    it("throws and dispatches error when auth() is not AUTHORIZED", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);

      await expect(manager.completeOAuthFlow("code")).rejects.toThrow(
        /Expected AUTHORIZED after providing authorization code/,
      );
      expect(params.dispatchOAuthError).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("throws when tokens cannot be retrieved after authorization", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);

      await expect(manager.completeOAuthFlow("code")).rejects.toThrow(
        "Failed to retrieve tokens after authorization",
      );
      expect(params.dispatchOAuthError).toHaveBeenCalled();
    });

    it("clears pending step-up scope when completeOAuthFlow fails", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=step-up",
      );
      mockedMcpAuth
        .mockResolvedValueOnce("REDIRECT")
        .mockResolvedValueOnce("REDIRECT")
        .mockResolvedValueOnce("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getScope.mockReturnValue("mcp");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        scope: "mcp",
      });
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      await expect(manager.completeOAuthFlow("bad-code")).rejects.toThrow();

      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        scope: "mcp",
      });
      await manager.completeOAuthFlow("good-code");

      expect(storageOf(params).saveScope).toHaveBeenLastCalledWith(
        SERVER_URL,
        "mcp",
      );
      captureSpy.mockRestore();
    });
  });

  describe("completeOAuthFlow (EMA)", () => {
    it("mints resource tokens via the EMA path and dispatches complete", async () => {
      const tokens = { access_token: "EMA", token_type: "Bearer" };
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const mintSpy = vi
        .spyOn(emaFlow, "completeEmaIdpAuthorizationAndMint")
        .mockResolvedValue(tokens);

      await manager.completeOAuthFlow("ema-code");

      expect(mintSpy).toHaveBeenCalled();
      expect(params.dispatchOAuthComplete).toHaveBeenCalledWith({ tokens });
      expect(manager.getOAuthFlowStep()).toBe("complete");
      mintSpy.mockRestore();
    });
  });

  describe("trySilentEnterpriseManagedAuth", () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errSpy.mockRestore();
    });

    function emaManager(): OAuthManager {
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });
      return manager;
    }

    it("returns false when not enterprise managed", async () => {
      const manager = new OAuthManager(createMockParams());
      expect(await manager.trySilentEnterpriseManagedAuth()).toBe(false);
    });

    it("returns true on silent success", async () => {
      const spy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "success" });
      expect(await emaManager().trySilentEnterpriseManagedAuth()).toBe(true);
      spy.mockRestore();
    });

    it("returns false when there is no cached IdP session", async () => {
      const spy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      expect(await emaManager().trySilentEnterpriseManagedAuth()).toBe(false);
      spy.mockRestore();
    });

    it("throws when the mint fails", async () => {
      const error = new Error("mint failed");
      const spy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "mint_failed", error });
      await expect(
        emaManager().trySilentEnterpriseManagedAuth(),
      ).rejects.toThrow("mint failed");
      spy.mockRestore();
    });
  });

  describe("authenticateEnterpriseManaged (interactive)", () => {
    function emaParams(): OAuthManagerParams {
      return createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
        onBeforeOAuthRedirect: vi.fn().mockResolvedValue(undefined),
      });
    }

    it("returns undefined when silent auth already succeeded", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "success" });
      const params = emaParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const result = await manager.authenticate();
      expect(result).toBeUndefined();
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();
      silentSpy.mockRestore();
    });

    it("redirects to the IdP and records flow state when not silent", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      const authUrl = new URL("https://idp.example.com/authorize?state=ema");
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockResolvedValue(authUrl);
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue({
          execution: "quick",
          authId: "ema-id",
        } as ReturnType<
          typeof import("@inspector/core/auth/utils.js").parseOAuthState
        >);
      const params = emaParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const result = await manager.authenticate();

      expect(result).toEqual(authUrl);
      expect(params.onBeforeOAuthRedirect).toHaveBeenCalledWith("ema-id");
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).toHaveBeenCalledWith(authUrl);
      expect(manager.getOAuthFlowStep()).toBe("authorization_code");

      silentSpy.mockRestore();
      startSpy.mockRestore();
      parseSpy.mockRestore();
    });
  });

  describe("refreshEnterpriseManagedTokens", () => {
    function emaManager(): OAuthManager {
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });
      return manager;
    }

    it("returns false when not enterprise managed", async () => {
      const manager = new OAuthManager(createMockParams());
      expect(await manager.refreshEnterpriseManagedTokens()).toBe(false);
    });

    it("returns true when refreshed tokens are returned", async () => {
      const spy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue({ access_token: "R", token_type: "Bearer" });
      expect(await emaManager().refreshEnterpriseManagedTokens()).toBe(true);
      spy.mockRestore();
    });

    it("returns false when no tokens are returned", async () => {
      const spy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue(undefined);
      expect(await emaManager().refreshEnterpriseManagedTokens()).toBe(false);
      spy.mockRestore();
    });
  });

  describe("checkAuthChallengeSatisfied", () => {
    it("returns false when no tokens in storage", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
          requiredScopes: ["tools:write"],
        }),
      ).toBe(false);
    });

    it("returns true for token_expired when a usable access token exists", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "token_expired" }),
      ).toBe(true);
    });

    it("returns true when stored scope covers step-up union", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read tools:write",
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read tools:write");
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
          requiredScopes: ["tools:write"],
        }),
      ).toBe(true);
    });

    it("returns false when step-up union exceeds granted scope", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
          requiredScopes: ["tools:write"],
        }),
      ).toBe(false);
    });

    it("returns false for insufficient_scope with no scopes in the challenge", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      storageOf(params).getScope.mockReturnValue(undefined);
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
        }),
      ).toBe(false);
    });

    it("short-circuits handleAuthChallenge when scope already satisfied", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read tools:write",
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read tools:write");
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["tools:write"],
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).not.toHaveBeenCalled();
    });

    it("does not short-circuit token_expired at handleAuthChallenge entry", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).toHaveBeenCalled();
    });
  });

  describe("handleAuthChallenge", () => {
    it("returns satisfied when silent refresh succeeds", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
    });

    it("returns interactive when refresh requires redirect without navigating", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=abc",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: capturedUrl,
        }),
      );
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();
      expect(manager.getOAuthFlowStep()).toBe("authorization_code");
      captureSpy.mockRestore();
    });

    it("uses catalog scope for reauth interactive flows", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=reauth",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ scope: "catalog:scope" });
      storageOf(params).getScope.mockReturnValue("stored union scope");
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      await manager.handleAuthChallenge({ reason: "token_expired" });

      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: "catalog:scope" }),
      );
      captureSpy.mockRestore();
    });

    it("returns failed with step-up message when silent refresh grants insufficient scope", async () => {
      mockedMcpAuth
        .mockResolvedValueOnce("AUTHORIZED")
        .mockResolvedValueOnce("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
        context: { toolName: "get_weather" },
      });

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error.message).toMatch(/get_weather/);
      }
    });

    it("returns failed when no authorization URL is captured", async () => {
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const manager = new OAuthManager(createMockParams());

      const outcome = await manager.handleAuthChallenge({
        reason: "unauthorized",
      });

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error.message).toMatch(
          /Failed to capture authorization URL/,
        );
      }
    });

    it("returns interactive for insufficient_scope without navigating", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=step-up",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: capturedUrl,
        }),
      );
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();
      captureSpy.mockRestore();
    });

    it("unions scopes and starts interactive step-up for insufficient_scope", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=step-up",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: capturedUrl,
        }),
      );
      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scope: "mcp tools:read weather:read",
          forceReauthorization: true,
        }),
      );
      captureSpy.mockRestore();
    });

    it("returns satisfied for EMA silent refresh", async () => {
      const refreshSpy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue(undefined);
      const authUrl = new URL("https://idp.example.com/authorize?state=ema");
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockResolvedValue(authUrl);
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: authUrl,
        }),
      );
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();
      refreshSpy.mockRestore();
      startSpy.mockRestore();
    });

    it("returns step_up_confirm for EMA insufficient_scope until user confirms", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "success" });
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      storageOf(params).getScope.mockReturnValue("mcp");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp",
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome.kind).toBe("step_up_confirm");
      if (outcome.kind === "step_up_confirm") {
        expect(outcome.challenge.authorizationScopes).toEqual([
          "mcp",
          "weather:read",
        ]);
      }
      expect(silentSpy).not.toHaveBeenCalled();
      silentSpy.mockRestore();
    });

    it("step_up_confirm lists only scopes not already granted when AS sends full tool requirements", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "success" });
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["tools:read", "env:read"],
      });

      expect(outcome.kind).toBe("step_up_confirm");
      if (outcome.kind === "step_up_confirm") {
        expect(outcome.challenge.requiredScopes).toEqual(["env:read"]);
        expect(outcome.challenge.authorizationScopes).toEqual([
          "mcp",
          "tools:read",
          "env:read",
        ]);
      }
      silentSpy.mockRestore();
    });

    it("returns satisfied for EMA insufficient_scope after user confirms", async () => {
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      let storedScope = "mcp";
      storageOf(params).getScope.mockImplementation(() => storedScope);
      storageOf(params).saveScope.mockImplementation(async (_url, scope) => {
        storedScope = scope;
      });
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp",
      });
      const silentSpy = vi.spyOn(emaFlow, "trySilentEmaAuth").mockImplementation(async () => {
        storageOf(params).getTokens.mockResolvedValue({
          access_token: "tok",
          token_type: "Bearer",
          scope: "mcp weather:read",
        });
        return { status: "success" };
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge(
        {
          reason: "insufficient_scope",
          requiredScopes: ["weather:read"],
        },
        { confirmedStepUp: true },
      );

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp weather:read",
      );
      expect(silentSpy).toHaveBeenCalled();
      silentSpy.mockRestore();
    });

    it("does not persist union scope or return satisfied when silent EMA mint is down-scoped", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "success" });
      const authUrl = new URL("https://idp.example.com/authorize?state=ema");
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockResolvedValue(authUrl);
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      storageOf(params).getScope.mockReturnValue("mcp");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp",
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge(
        {
          reason: "insufficient_scope",
          requiredScopes: ["weather:read"],
        },
        { confirmedStepUp: true },
      );

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: authUrl,
        }),
      );
      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
      silentSpy.mockRestore();
      startSpy.mockRestore();
    });

    it("completeOAuthFlow mints EMA tokens with pending step-up union scope", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      const authUrl = new URL("https://idp.example.com/authorize?state=ema");
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockResolvedValue(authUrl);
      const mintSpy = vi
        .spyOn(emaFlow, "completeEmaIdpAuthorizationAndMint")
        .mockResolvedValue({ access_token: "tok", token_type: "Bearer" });
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      storageOf(params).getScope.mockReturnValue("mcp tools:read");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "old",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true, scope: "mcp" });

      const outcome = await manager.handleAuthChallenge(
        {
          reason: "insufficient_scope",
          requiredScopes: ["weather:read"],
        },
        { confirmedStepUp: true },
      );
      expect(outcome.kind).toBe("interactive");

      await manager.completeOAuthFlow("auth-code");

      expect(mintSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "mcp tools:read weather:read" }),
        "auth-code",
      );
      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp tools:read weather:read",
      );

      silentSpy.mockRestore();
      startSpy.mockRestore();
      mintSpy.mockRestore();
    });
  });

  describe("createOAuthProviderForTransport", () => {
    it("returns a plain provider for standard OAuth", async () => {
      const manager = new OAuthManager(createMockParams());
      const provider = await manager.createOAuthProviderForTransport();
      expect(provider).toBeDefined();
      expect(provider.constructor.name === "EmaTransportOAuthProvider").toBe(
        false,
      );
    });

    it("wraps the provider in an EmaTransportOAuthProvider for EMA", async () => {
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });
      const provider = await manager.createOAuthProviderForTransport();
      expect(provider.constructor.name).toBe("EmaTransportOAuthProvider");
    });
  });

  describe("getOAuthState (enterprise managed / scope)", () => {
    it("returns ema connection state when enterprise managed is configured", async () => {
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      params.initialConfig.scope = "read";
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const state = await manager.getOAuthState();
      expect(state?.protocol).toBe("ema");
      expect(state?.serverUrl).toBe(SERVER_URL);
    });
  });
});
