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

/** Minimal unsigned JWT carrying only `exp` (epoch seconds). */
function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

function createMockParams(
  overrides?: Partial<OAuthManagerParams>,
): OAuthManagerParams {
  const dispatchOAuthComplete = vi.fn();
  const dispatchOAuthAuthorizationRequired = vi.fn();
  const dispatchOAuthError = vi.fn();

  const storage = {
    load: vi.fn().mockResolvedValue(undefined),
    getScope: vi.fn().mockResolvedValue(undefined),
    getClientInformation: vi.fn().mockResolvedValue(undefined),
    getClientRegistrationKind: vi.fn().mockResolvedValue(undefined),
    saveClientInformation: vi.fn().mockResolvedValue(undefined),
    savePreregisteredClientInformation: vi.fn().mockResolvedValue(undefined),
    saveScope: vi.fn().mockResolvedValue(undefined),
    getTokens: vi.fn().mockResolvedValue(undefined),
    saveTokens: vi.fn().mockResolvedValue(undefined),
    getCodeVerifier: vi.fn().mockResolvedValue("verifier"),
    saveCodeVerifier: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    clearClientInformation: vi.fn(),
    clearTokens: vi.fn(),
    clearCodeVerifier: vi.fn(),
    clearScope: vi.fn(),
    clearServerMetadata: vi.fn(),
    getServerMetadata: vi.fn().mockResolvedValue(null),
    saveServerMetadata: vi.fn().mockResolvedValue(undefined),
    getIdpSession: vi.fn().mockResolvedValue(undefined),
    saveIdpSession: vi.fn().mockResolvedValue(undefined),
    clearIdpSession: vi.fn(),
    clearEnterpriseManagedResourceServers: vi.fn(),
    takeRevocationSnapshot: vi.fn().mockResolvedValue({ byIssuer: {} }),
    getDiscoveryState: vi.fn().mockResolvedValue(undefined),
    saveDiscoveryState: vi.fn().mockResolvedValue(undefined),
    clearDiscoveryState: vi.fn().mockResolvedValue(undefined),
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

  // #1906 — the endpoint overrides are read live from the config so a settings
  // edit reaches the already-built fetch wrapper.
  describe("getEndpointOverrides", () => {
    it("returns undefined when neither endpoint is configured", () => {
      const manager = new OAuthManager(createMockParams());
      expect(manager.getEndpointOverrides()).toBeUndefined();
    });

    it("reflects each endpoint set through setOAuthConfig", () => {
      const manager = new OAuthManager(createMockParams());
      manager.setOAuthConfig({
        authorizationUrl: "https://staging.test/authorize",
      });
      expect(manager.getEndpointOverrides()).toEqual({
        authorizationUrl: "https://staging.test/authorize",
      });
      manager.setOAuthConfig({ tokenUrl: "https://staging.test/token" });
      expect(manager.getEndpointOverrides()).toEqual({
        authorizationUrl: "https://staging.test/authorize",
        tokenUrl: "https://staging.test/token",
      });
    });

    // The EMA leg authorizes against the enterprise IdP — a different
    // authorization server, whose OIDC discovery runs through the same fetch the
    // override wrapper is installed on. Applying a resource-AS override there
    // would redirect the IdP login (or the IdP code exchange) to the resource
    // AS. Regression test for the review finding on PR #2037.
    it("suppresses the overrides under enterprise-managed authorization", () => {
      const manager = new OAuthManager(createMockParams());
      manager.setOAuthConfig({
        authorizationUrl: "https://staging.test/authorize",
        tokenUrl: "https://staging.test/token",
      });
      expect(manager.getEndpointOverrides()).toBeDefined();

      manager.setOAuthConfig({ enterpriseManaged: true });
      expect(manager.getEndpointOverrides()).toBeUndefined();

      manager.setOAuthConfig({ enterpriseManaged: false });
      expect(manager.getEndpointOverrides()).toEqual({
        authorizationUrl: "https://staging.test/authorize",
        tokenUrl: "https://staging.test/token",
      });
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
    /**
     * The take-and-clear is ONE atomic storage step now, so `clear` is no
     * longer called separately — these assert on `takeRevocationSnapshot`.
     */
    function stubSnapshot(
      storage: OAuthManagerConfig["storage"],
      revocable = true,
    ): void {
      vi.mocked(storage!.takeRevocationSnapshot).mockResolvedValue({
        byIssuer: revocable
          ? {
              "https://as.example.com": {
                tokens: {
                  access_token: "a",
                  token_type: "Bearer",
                  refresh_token: "r",
                },
              },
            }
          : {},
        serverMetadata: {
          issuer: "https://as.example.com",
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
          revocation_endpoint: "https://as.example.com/revoke",
          response_types_supported: ["code"],
        },
      });
    }

    it("takes and clears the server's state when storage is configured", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await manager.clearOAuthTokens();
      expect(
        params.initialConfig.storage!.takeRevocationSnapshot,
      ).toHaveBeenCalledWith(SERVER_URL);
      expect(manager.getOAuthFlowState()).toBeUndefined();
      expect(manager.getOAuthFlowStep()).toBeUndefined();
    });

    // #2144 — the ordering is the contract. The request is built from state the
    // clear destroys, so the take must come first; but the two are ONE step, so
    // nothing can save a fresh grant between them, and the network wait happens
    // after the state is already gone.
    it("clears local state before waiting on the revocation request", async () => {
      const params = createMockParams();
      const storage = params.initialConfig.storage!;
      const order: string[] = [];
      vi.mocked(storage.takeRevocationSnapshot).mockImplementation(async () => {
        order.push("clear");
        return {
          byIssuer: {
            "https://as.example.com": {
              tokens: {
                access_token: "a",
                token_type: "Bearer",
                refresh_token: "r",
              },
            },
          },
          serverMetadata: {
            issuer: "https://as.example.com",
            authorization_endpoint: "https://as.example.com/authorize",
            token_endpoint: "https://as.example.com/token",
            revocation_endpoint: "https://as.example.com/revoke",
            response_types_supported: ["code"],
          },
        };
      });
      const fetchFn = vi.fn<typeof fetch>(async () => {
        order.push("revoke");
        return new Response(null, { status: 200 });
      });
      const manager = new OAuthManager({
        ...params,
        effectiveAuthFetch: fetchFn,
      });

      await expect(manager.clearOAuthTokens()).resolves.toMatchObject({
        status: "revoked",
        tokenTypeHint: "refresh_token",
      });
      expect(order).toEqual(["clear", "revoke"]);
    });

    it("clears local state even when the revocation request fails", async () => {
      const params = createMockParams();
      const storage = params.initialConfig.storage!;
      stubSnapshot(storage);
      const manager = new OAuthManager({
        ...params,
        effectiveAuthFetch: vi.fn<typeof fetch>(async () => {
          throw new Error("unreachable");
        }),
      });

      await expect(manager.clearOAuthTokens()).resolves.toMatchObject({
        status: "failed",
      });
      expect(storage.takeRevocationSnapshot).toHaveBeenCalledWith(SERVER_URL);
    });

    it("skips the request when revocation is turned off", async () => {
      const params = createMockParams();
      const storage = params.initialConfig.storage!;
      stubSnapshot(storage);
      const fetchFn = vi.fn<typeof fetch>();
      const manager = new OAuthManager({
        ...params,
        effectiveAuthFetch: fetchFn,
      });

      await expect(
        manager.clearOAuthTokens({ revoke: false }),
      ).resolves.toEqual({ status: "skipped", reason: "disabled" });
      expect(fetchFn).not.toHaveBeenCalled();
      // Still cleared — that is what the caller asked for; the request is the
      // optional part.
      expect(storage.takeRevocationSnapshot).toHaveBeenCalledWith(SERVER_URL);
    });

    it("no-ops when storage is not configured", async () => {
      const params = createMockParams({
        initialConfig: {
          redirectUrlProvider: {
            getRedirectUrl: vi.fn().mockReturnValue("http://localhost"),
          },
          navigation: { navigateToAuthorization: vi.fn() },
        } as OAuthManagerConfig,
      });
      const manager = new OAuthManager(params);
      await expect(manager.clearOAuthTokens()).resolves.toEqual({
        status: "skipped",
        reason: "no_tokens",
      });
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

    it("returns tokens from in-memory flow state without querying storage", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const tokens = { access_token: "cached", token_type: "Bearer" };
      storageOf(params).getTokens.mockResolvedValue(tokens);
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      await manager.completeOAuthFlow("code");
      storageOf(params).getTokens.mockClear();

      const result = await manager.getOAuthTokens();

      expect(result).toEqual(tokens);
      expect(storageOf(params).getTokens).not.toHaveBeenCalled();
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
      storageOf(params).getScope.mockResolvedValue(undefined);
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
      storageOf(params).getScope.mockResolvedValue(
        "mcp tools:read weather:read",
      );
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
      storageOf(params).getScope.mockResolvedValue("mcp");
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

    it("persists granted scope when AS down-scopes the token response", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getScope.mockResolvedValue("mcp");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        scope: "mcp",
      });
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      (
        manager as unknown as { pendingAuthorizationScope: string | undefined }
      ).pendingAuthorizationScope = "mcp weather:read";

      await manager.completeOAuthFlow("code");

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp",
      );
    });

    it("persists requested scope when the token response omits scope", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
      });
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      (
        manager as unknown as { pendingAuthorizationScope: string | undefined }
      ).pendingAuthorizationScope = "mcp weather:read";

      await manager.completeOAuthFlow("code");

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp weather:read",
      );
    });
  });

  describe("persisting the requested scope after an ordinary grant (#2117)", () => {
    function capturedUrlWithScope(scope?: string): URL {
      const url = new URL("https://auth.example.com/authorize?state=abc");
      if (scope !== undefined) {
        url.searchParams.set("scope", scope);
      }
      return url;
    }

    async function authorizeThenComplete(
      storedScope: string | undefined,
      tokenScope: string | undefined,
      authorizeUrlScope?: string,
    ) {
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockResolvedValue(storedScope);
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
        .mockReturnValue(capturedUrlWithScope(authorizeUrlScope));

      await manager.authenticate();

      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        ...(tokenScope === undefined ? {} : { scope: tokenScope }),
      });
      storageOf(params).saveScope.mockClear();

      await manager.completeOAuthFlow("code");
      captureSpy.mockRestore();
      return params;
    }

    it("persists the requested scope when the token response omits scope", async () => {
      const params = await authorizeThenComplete("mcp weather:read", undefined);

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp weather:read",
      );
    });

    it("still prefers the granted scope when the AS echoes one", async () => {
      const params = await authorizeThenComplete("mcp weather:read", "mcp");

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp",
      );
    });

    it("records the request for a plain challenge redirect too, not just step-up", async () => {
      // A `token_expired` / `unauthorized` challenge can return an interactive
      // redirect whose callback lands in this same completeOAuthFlow. It used
      // to record nothing, so a silent token response left the old stored
      // scope standing — the same defect on a sibling entry point.
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockResolvedValue("stale:scope");
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ scope: "catalog:scope" });
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrlWithScope("catalog:scope offline_access"));

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });
      expect(outcome.kind).toBe("interactive");

      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
      });
      storageOf(params).saveScope.mockClear();

      await manager.completeOAuthFlow("code");

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "catalog:scope offline_access",
      );
      captureSpy.mockRestore();
    });

    it("persists nothing when neither the request nor the response names a scope", async () => {
      const params = await authorizeThenComplete(undefined, undefined);

      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
    });

    it("persists the scope the authorize URL actually carried, not the provider's", async () => {
      // The SDK augments the request with `offline_access` when the AS
      // advertises it and the client wants a refresh token, so the authorize
      // URL is a superset of `provider.scope`. Persisting the provider's copy
      // would understate the grant the AS implied by staying silent.
      const params = await authorizeThenComplete(
        "mcp",
        undefined,
        "mcp offline_access",
      );

      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp offline_access",
      );
    });
  });

  describe("completeOAuthFlow (EMA)", () => {
    it("mints resource tokens via the EMA path and dispatches complete", async () => {
      const tokens = { access_token: "EMA", token_type: "Bearer" as const };
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
        .mockResolvedValue({ tokens });

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

    it("skips onBeforeOAuthRedirect when none is configured", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      const authUrl = new URL(
        "https://idp.example.com/authorize?state=no-callback",
      );
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

      const result = await manager.authenticate();

      expect(result).toEqual(authUrl);
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).toHaveBeenCalledWith(authUrl);

      silentSpy.mockRestore();
      startSpy.mockRestore();
    });

    it("skips onBeforeOAuthRedirect when the authorization state has no authId", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      const authUrl = new URL(
        "https://idp.example.com/authorize?state=no-authid",
      );
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockResolvedValue(authUrl);
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue(null);
      const params = emaParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      await manager.authenticate();

      expect(params.onBeforeOAuthRedirect).not.toHaveBeenCalled();

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

    it("returns true for token_expired when a provably unexpired JWT exists", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: jwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "token_expired" }),
      ).toBe(true);
    });

    it("returns false for token_expired when the stored JWT has expired", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: jwtWithExp(Math.floor(Date.now() / 1000) - 60),
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "token_expired" }),
      ).toBe(false);
    });

    it("returns false for token_expired when the stored token is opaque", async () => {
      // Regression guard for #2051: an opaque token has no local expiry
      // evidence, so it must not outvote the resource server's verdict and
      // short-circuit re-authorization into replaying a dead credential.
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "opaque-tok",
        token_type: "Bearer",
        expires_in: 900,
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "token_expired" }),
      ).toBe(false);
    });

    it("returns false for invalid_token even when a locally valid token exists", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        expires_in: 3600,
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "invalid_token" }),
      ).toBe(false);
    });

    it("returns false for unauthorized even when a locally valid token exists", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        expires_in: 3600,
      });
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({ reason: "unauthorized" }),
      ).toBe(false);
    });

    it("returns true when stored scope covers step-up union", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read tools:write",
      });
      storageOf(params).getScope.mockResolvedValue(
        "mcp tools:read tools:write",
      );
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
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
          requiredScopes: ["tools:write"],
        }),
      ).toBe(false);
    });

    it("ignores inflated stored scope when token scope is explicit", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp",
      });
      storageOf(params).getScope.mockResolvedValue("mcp weather:read");
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
          requiredScopes: ["weather:read"],
        }),
      ).toBe(false);
    });

    it("returns false for insufficient_scope with no scopes in the challenge", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      storageOf(params).getScope.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);

      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
        }),
      ).toBe(false);
    });

    // #2068 round 11 — the callback leg of an *ordinary* authorization.
    // `resolvePersistedScopeAfterGrant` falls back to the requested scope when
    // the token response omits `scope` (RFC 6749 §5.1), but only step-up ever
    // populated that fallback. So a filtered request whose AS omitted `scope`
    // persisted nothing, the stale `offline_access` survived in storage, and
    // the "self-healing" this feature documents never happened.
    //
    // #2068 fixed that only while the opt-out was on, which was the case where
    // a stale scope caused a user-visible failure. #2117 dropped the gate, so
    // the recording is now unconditional and reads the authorize URL rather
    // than the provider — see `recordAuthorizationRequestScope`. The filter
    // still applies with the opt-out on, because the SDK's `offline_access`
    // augmentation is gated on the `refresh_token` grant type the provider
    // drops there.
    describe("persisting the filtered scope after an ordinary grant (#2068)", () => {
      async function completeWith(
        tokenScope: string | undefined,
        requestRefreshToken: boolean | undefined,
      ): Promise<ReturnType<typeof storageOf>> {
        const params = createMockParams();
        const storage = storageOf(params);
        storage.getScope.mockResolvedValue("mcp offline_access");
        storage.getClientInformation.mockResolvedValue({ client_id: "cid" });
        const manager = new OAuthManager(params);
        manager.setOAuthConfig({
          scope: "mcp",
          ...(requestRefreshToken !== undefined && { requestRefreshToken }),
        });
        mockedMcpAuth.mockResolvedValue("REDIRECT");

        const captureSpy = vi
          .spyOn(
            (await import("@inspector/core/auth/providers.js"))
              .BaseOAuthClientProvider.prototype,
            "getCapturedAuthUrl",
          )
          .mockReturnValue(new URL("https://as.example.com/authorize?state=s"));
        await manager.authenticate();
        captureSpy.mockRestore();

        // The callback leg calls `mcpAuth` again and requires AUTHORIZED.
        mockedMcpAuth.mockResolvedValue("AUTHORIZED");
        storage.getTokens.mockResolvedValue({
          access_token: "access",
          token_type: "Bearer",
          ...(tokenScope !== undefined && { scope: tokenScope }),
        });
        await manager.completeOAuthFlow("code");
        return storage;
      }

      it("persists the filtered request when the token response omits scope", async () => {
        const storage = await completeWith(undefined, false);
        expect(storage.saveScope).toHaveBeenLastCalledWith(SERVER_URL, "mcp");
      });

      // An explicit grant is authoritative and wins over what we requested.
      it("persists the granted scope when the token response carries one", async () => {
        const storage = await completeWith("mcp tools:read", false);
        expect(storage.saveScope).toHaveBeenLastCalledWith(
          SERVER_URL,
          "mcp tools:read",
        );
      });

      // #2117 inverted this. #2068 gated the recording on the opt-out being
      // on, so with the grant declared the ordinary leg persisted nothing;
      // that gate is gone, and one wire case now has one behavior rather than
      // two selected by a checkbox. Persisting here records no new claim: the
      // request is what storage already held, so this rewrites the same value
      // rather than asserting a scope the AS never mentioned.
      it("persists the request even with the grant on, matching what storage held", async () => {
        const storage = await completeWith(undefined, undefined);
        expect(storage.saveScope).toHaveBeenLastCalledWith(
          SERVER_URL,
          "mcp offline_access",
        );
      });
    });

    // #2068 round 8 — the step-up path never reads the provider's filtering
    // `scope` getter: `enrichChallengeWithScopes` unions the *raw* stored scope
    // with the challenge and `handleAuthChallenge` hands that straight to
    // `mcpAuth`. So an inherited `offline_access` reappeared here with the
    // setting off, and the SDK re-added `prompt=consent` — the exact failure
    // the option exists to prevent, on the one path that bypassed it.
    describe("step-up scope with the refresh grant declined (#2068)", () => {
      /** The `scope` this challenge run handed to the SDK. */
      async function scopeSentForChallenge(
        storedScope: string,
        configuredScope: string | undefined,
        requiredScopes: string[],
        requestRefreshToken: boolean | undefined,
      ): Promise<string | undefined> {
        const params = createMockParams();
        storageOf(params).getScope.mockResolvedValue(storedScope);
        storageOf(params).getTokens.mockResolvedValue({
          access_token: "tok",
          token_type: "Bearer",
          scope: storedScope,
        });
        storageOf(params).getClientInformation.mockResolvedValue({
          client_id: "cid",
        });
        const manager = new OAuthManager(params);
        manager.setOAuthConfig({
          ...(configuredScope !== undefined && { scope: configuredScope }),
          ...(requestRefreshToken !== undefined && { requestRefreshToken }),
        });
        mockedMcpAuth.mockResolvedValue("REDIRECT");

        await manager.handleAuthChallenge({
          reason: "insufficient_scope",
          requiredScopes,
        });

        const call = mockedMcpAuth.mock.calls.at(-1);
        return (call?.[1] as { scope?: string } | undefined)?.scope;
      }

      it("drops an inherited offline_access from the step-up union", async () => {
        const sent = await scopeSentForChallenge(
          "mcp offline_access",
          "mcp",
          ["tools:write"],
          false,
        );
        expect(sent?.split(/\s+/)).not.toContain("offline_access");
        // The step-up still asks for what the challenge demanded.
        expect(sent?.split(/\s+/)).toContain("tools:write");
      });

      it("keeps offline_access in the step-up union while the grant is on", async () => {
        const sent = await scopeSentForChallenge(
          "mcp offline_access",
          "mcp",
          ["tools:write"],
          undefined,
        );
        expect(sent?.split(/\s+/)).toContain("offline_access");
      });

      // Stripping a scope the challenge itself requires would loop:
      // re-authorize, earn the same challenge, strip it again.
      it("preserves an offline_access the challenge requires", async () => {
        const sent = await scopeSentForChallenge(
          "mcp",
          "mcp",
          ["offline_access"],
          false,
        );
        expect(sent?.split(/\s+/)).toContain("offline_access");
      });

      // The mixed case, and the one that made the guard above insufficient:
      // `enrichChallengeWithScopes` narrows `requiredScopes` to the *missing*
      // subset, so a challenge requiring both — against a stored scope that
      // already carries `offline_access` — arrives as just `["tools:write"]`.
      // Reading the narrowed list treats the server's explicit requirement as
      // inherited and strips it, and re-authorization then earns the same
      // challenge forever.
      it("preserves a required offline_access when the challenge also names a missing scope", async () => {
        const sent = await scopeSentForChallenge(
          "mcp offline_access",
          "mcp",
          ["offline_access", "tools:write"],
          false,
        );
        expect(sent?.split(/\s+/)).toContain("offline_access");
        expect(sent?.split(/\s+/)).toContain("tools:write");
      });
    });

    it("short-circuits handleAuthChallenge when scope already satisfied", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
        scope: "mcp tools:read tools:write",
      });
      storageOf(params).getScope.mockResolvedValue(
        "mcp tools:read tools:write",
      );
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
      storageOf(params).getScope.mockResolvedValue("stored union scope");
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
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
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
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
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
      // SEP-2350: a step-up redirect is recorded as `scope_step_up`, distinct
      // from a first-time `authorization_code` login.
      expect(manager.getOAuthFlowStep()).toBe("scope_step_up");
      captureSpy.mockRestore();
    });

    it("unions scopes and starts interactive step-up for insufficient_scope", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=step-up",
      );
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
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
      storageOf(params).getScope.mockResolvedValue("mcp");
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
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
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
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockImplementation(async () => {
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
      storageOf(params).getScope.mockResolvedValue("mcp");
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
        .mockResolvedValue({
          tokens: { access_token: "tok", token_type: "Bearer" },
          requestedScope: "mcp tools:read weather:read",
        });
      const params = createMockParams({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example.com",
            clientId: "app-client",
            clientSecret: "secret",
          },
        },
      });
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
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

      await manager.completeOAuthFlow("auth-code", "https://idp.example.com");

      expect(mintSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "mcp tools:read weather:read" }),
        "auth-code",
        "https://idp.example.com",
      );
      // Persisting the granted scope is the EMA flow's job (saveMintedTokens),
      // and it is mocked here -- the union reaching its config, asserted just
      // above, is what this test owns. emaFlow.test.ts covers the persistence.

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

    // #2018 — the manager→provider bridge for the custom authorization
    // parameters. The provider test proves the merge and the runner test proves
    // the options object, but neither crosses this seam: without this case,
    // deleting `authorizationParams:` from `createOAuthProvider` would leave the
    // feature dead with every other test still green.
    it("forwards configured authorizationParams to the provider it builds", async () => {
      const params = createMockParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({
        authorizationParams: { kc_idp_hint: "corp-idp", prompt: "login" },
      });

      const provider = await manager.createOAuthProviderForTransport();
      await provider.redirectToAuthorization(
        new URL("https://as.example.com/authorize?client_id=abc&state=xyz"),
      );

      const navigate = params.initialConfig.navigation
        ?.navigateToAuthorization as ReturnType<typeof vi.fn>;
      const navigated = navigate.mock.calls[0]?.[0] as URL;
      expect(navigated.searchParams.get("kc_idp_hint")).toBe("corp-idp");
      expect(navigated.searchParams.get("prompt")).toBe("login");
      // The flow's own parameters are untouched.
      expect(navigated.searchParams.get("state")).toBe("xyz");
    });

    // #2068 — the manager→provider bridge for the refresh-token opt-out. Same
    // gap as the authorizationParams case above: the provider test constructs
    // `BaseOAuthClientProvider` directly and the runner test stops at the
    // options object, so deleting `requestRefreshToken:` from
    // `createOAuthProvider` would leave the feature dead with every other test
    // still green.
    it("forwards the refresh-token opt-out to the provider it builds", async () => {
      const manager = new OAuthManager(createMockParams());
      manager.setOAuthConfig({ requestRefreshToken: false });

      const provider = await manager.createOAuthProviderForTransport();
      expect(provider.clientMetadata.grant_types).toEqual([
        "authorization_code",
      ]);
    });

    // #2068 round 5 — the provider-level test for "storage is never rewritten"
    // could not see this: `createOAuthProvider` reads `provider.scope` (the
    // filtered getter) and seeds storage when it comes back undefined. A
    // persisted scope of `offline_access` alone therefore used to be silently
    // overwritten by the configured scope, which is the one thing the filter
    // promises not to do. Exercised through the manager, where the seeding
    // branch actually lives.
    it("does not overwrite a persisted scope that filters down to nothing", async () => {
      const params = createMockParams();
      const storage = params.initialConfig.storage;
      if (!storage) throw new Error("expected mock storage");
      vi.mocked(storage.getScope).mockResolvedValue("offline_access");

      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ requestRefreshToken: false, scope: "mcp" });
      const provider = await manager.createOAuthProviderForTransport();

      expect(storage.saveScope).not.toHaveBeenCalled();
      // Still requests the configured scope, without the declined token.
      expect(provider.clientMetadata.scope).toBe("mcp");
    });

    it("declares the refresh_token grant when the opt-out is not configured", async () => {
      const manager = new OAuthManager(createMockParams());

      const provider = await manager.createOAuthProviderForTransport();
      expect(provider.clientMetadata.grant_types).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
    });

    it("drops a reserved key configured on the manager", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const params = createMockParams();
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({
        authorizationParams: { state: "spoofed", kc_idp_hint: "corp-idp" },
      });

      const provider = await manager.createOAuthProviderForTransport();
      await provider.redirectToAuthorization(
        new URL("https://as.example.com/authorize?client_id=abc&state=xyz"),
      );

      const navigate = params.initialConfig.navigation
        ?.navigateToAuthorization as ReturnType<typeof vi.fn>;
      const navigated = navigate.mock.calls[0]?.[0] as URL;
      expect(navigated.searchParams.get("state")).toBe("xyz");
      expect(navigated.searchParams.get("kc_idp_hint")).toBe("corp-idp");
      expect(warn).toHaveBeenCalled();
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

  describe("getOAuthState (storage not configured)", () => {
    it("returns undefined when storage is not configured", async () => {
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
      await expect(manager.getOAuthState()).resolves.toBeUndefined();
    });
  });

  describe("checkAuthChallengeSatisfied (storage not configured)", () => {
    it("returns false when storage is not configured", async () => {
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
      expect(
        await manager.checkAuthChallengeSatisfied({
          reason: "insufficient_scope",
        }),
      ).toBe(false);
    });
  });

  describe("resource_metadata forwarding (RFC 9728) — #2071", () => {
    const METADATA_URL = "http://127.0.0.1:3001/custom/protected-resource";

    it("forwards the advertised metadata URL to auth() as a URL", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());

      await manager.handleAuthChallenge({
        reason: "token_expired",
        resourceMetadataUrl: METADATA_URL,
      });

      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          resourceMetadataUrl: new URL(METADATA_URL),
        }),
      );
    });

    it("leaves the metadata URL undefined when the challenge advertises none", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());

      await manager.handleAuthChallenge({ reason: "token_expired" });

      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceMetadataUrl: undefined }),
      );
    });

    it("ignores a malformed metadata URL rather than failing authorization", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
        resourceMetadataUrl: "not-a-url",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceMetadataUrl: undefined }),
      );
    });

    it("uses the last observed challenge on the plain authenticate() path", async () => {
      // The legacy first-authorization path: no challenge is passed in, so the
      // one the transport observed is the only source (#2071).
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(new URL("https://auth.example.com/authorize?state=x"));

      manager.noteObservedAuthChallenge({
        reason: "unauthorized",
        resourceMetadataUrl: METADATA_URL,
      });
      await manager.authenticate();

      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          resourceMetadataUrl: new URL(METADATA_URL),
        }),
      );
      captureSpy.mockRestore();
    });

    it("clears the observed URL when a later challenge advertises none", async () => {
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(new URL("https://auth.example.com/authorize?state=x"));

      manager.noteObservedAuthChallenge({
        reason: "unauthorized",
        resourceMetadataUrl: METADATA_URL,
      });
      manager.noteObservedAuthChallenge({ reason: "unauthorized" });
      await manager.authenticate();

      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resourceMetadataUrl: undefined }),
      );
      captureSpy.mockRestore();
    });

    it("forwards it on the forced step-up reauthorization leg too", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const noScopeTokens = {
        access_token: "a",
        token_type: "Bearer",
        scope: "",
      };
      const midScopeTokens = {
        access_token: "b",
        token_type: "Bearer",
        scope: "newscope",
      };
      const grantedTokens = {
        access_token: "d",
        token_type: "Bearer",
        scope: "granted:scope",
      };
      storageOf(params)
        .getTokens.mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(midScopeTokens)
        .mockResolvedValueOnce(grantedTokens);
      const manager = new OAuthManager(params);

      await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        resourceMetadataUrl: METADATA_URL,
      });

      expect(mockedMcpAuth).toHaveBeenCalledTimes(2);
      expect(mockedMcpAuth).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          forceReauthorization: true,
          resourceMetadataUrl: new URL(METADATA_URL),
        }),
      );
    });
  });

  describe("handleAuthChallenge (additional branch coverage)", () => {
    it("resolves via the second satisfaction check inside the mutex", async () => {
      const params = createMockParams();
      const insufficientTokens = {
        access_token: "a1",
        token_type: "Bearer",
        scope: "mcp tools:read",
      };
      const sufficientTokens = {
        access_token: "a2",
        token_type: "Bearer",
        scope: "mcp tools:read weather:read",
      };
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
      storageOf(params)
        .getTokens.mockResolvedValueOnce(insufficientTokens)
        .mockResolvedValue(sufficientTokens);
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).not.toHaveBeenCalled();
    });

    it("persists broadened scope when silent refresh already satisfies the step-up scope", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const insufficientTokens = {
        access_token: "a1",
        refresh_token: "r1",
        token_type: "Bearer",
        scope: "mcp tools:read",
      };
      const sufficientTokens = {
        access_token: "a2",
        refresh_token: "r2",
        token_type: "Bearer",
        scope: "mcp tools:read weather:read",
      };
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
      storageOf(params)
        .getTokens.mockResolvedValueOnce(insufficientTokens)
        .mockResolvedValueOnce(insufficientTokens)
        .mockResolvedValueOnce(insufficientTokens)
        .mockResolvedValue(sufficientTokens);
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "mcp tools:read weather:read",
      );
    });

    it("returns satisfied without persisting scope when the fresh grant has no scope to record", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      // scope: "" (not omitted) avoids enrichChallengeWithAuthorizationScopes'
      // internal extra getTokens() re-fetch, which only triggers when the
      // passed grantedTokenScope is `undefined`.
      const noScopeTokens = {
        access_token: "a",
        token_type: "Bearer",
        scope: "",
      };
      const midScopeTokens = {
        access_token: "b",
        token_type: "Bearer",
        scope: "newscope",
      };
      const finalNoScopeTokens = {
        access_token: "c",
        token_type: "Bearer",
        scope: "",
      };
      storageOf(params)
        .getTokens.mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(midScopeTokens)
        .mockResolvedValueOnce(finalNoScopeTokens);
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
    });

    it("forces reauthorization and persists the granted scope when the retry succeeds", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const noScopeTokens = {
        access_token: "a",
        token_type: "Bearer",
        scope: "",
      };
      const midScopeTokens = {
        access_token: "b",
        token_type: "Bearer",
        scope: "newscope",
      };
      const grantedTokens = {
        access_token: "d",
        token_type: "Bearer",
        scope: "granted:scope",
      };
      storageOf(params)
        .getTokens.mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(midScopeTokens)
        .mockResolvedValueOnce(grantedTokens);
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).toHaveBeenCalledTimes(2);
      expect(mockedMcpAuth).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ forceReauthorization: true }),
      );
      expect(storageOf(params).saveScope).toHaveBeenCalledWith(
        SERVER_URL,
        "granted:scope",
      );
    });

    it("forces reauthorization without persisting scope when the retry grants no explicit scope", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const noScopeTokens = {
        access_token: "a",
        token_type: "Bearer",
        scope: "",
      };
      const midScopeTokens = {
        access_token: "b",
        token_type: "Bearer",
        scope: "newscope",
      };
      storageOf(params)
        .getTokens.mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(noScopeTokens)
        .mockResolvedValueOnce(midScopeTokens)
        .mockResolvedValueOnce(noScopeTokens);
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
    });

    it("returns failed when the forced reauthorization retry does not complete", async () => {
      mockedMcpAuth
        .mockResolvedValueOnce("AUTHORIZED")
        .mockResolvedValueOnce("REDIRECT");
      const params = createMockParams();
      storageOf(params).getScope.mockResolvedValue("mcp tools:read");
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        scope: "mcp tools:read",
      });
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error.message).toMatch(/weather:read/);
      }
    });

    it("falls back to challenge requiredScopes when no catalog scope is configured", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      const manager = new OAuthManager(params);

      const outcome = await manager.handleAuthChallenge({
        reason: "unauthorized",
        requiredScopes: ["fallback:scope"],
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(mockedMcpAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: "fallback:scope" }),
      );
    });
  });

  describe("completeOAuthFlow (non-Error rejection)", () => {
    it("wraps non-Error throw values in the dispatched error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockedMcpAuth.mockRejectedValue("plain-string-failure");
      const params = createMockParams();
      const manager = new OAuthManager(params);

      await expect(manager.completeOAuthFlow("code")).rejects.toBe(
        "plain-string-failure",
      );
      expect(params.dispatchOAuthError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
      );
      const dispatchedError = (
        params.dispatchOAuthError as ReturnType<typeof vi.fn>
      ).mock.calls[0][0].error as Error;
      expect(dispatchedError.message).toBe("plain-string-failure");
      errorSpy.mockRestore();
    });
  });

  describe("handleEnterpriseManagedAuthChallenge (additional branch coverage)", () => {
    it("returns failed when EMA silent re-mint fails during confirmed step-up", async () => {
      const mintError = new Error("mint failed during step-up");
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "mint_failed", error: mintError });
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

      const outcome = await manager.handleAuthChallenge(
        { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
        { confirmedStepUp: true },
      );

      expect(outcome).toEqual({ kind: "failed", error: mintError });
      silentSpy.mockRestore();
    });

    it("returns satisfied for EMA token_expired when refreshEmaResourceTokens succeeds, using the configured fallback scope", async () => {
      const refreshSpy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue({ access_token: "R", token_type: "Bearer" });
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
      manager.setOAuthConfig({
        enterpriseManaged: true,
        scope: "fallback:scope",
      });

      const outcome = await manager.handleAuthChallenge({
        reason: "token_expired",
      });

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(refreshSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "fallback:scope" }),
      );
      refreshSpy.mockRestore();
    });

    it("returns failed when starting the EMA IdP authorization throws an Error", async () => {
      const refreshSpy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue(undefined);
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockRejectedValue(new Error("idp unreachable"));
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

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error.message).toBe("idp unreachable");
      }
      refreshSpy.mockRestore();
      startSpy.mockRestore();
    });

    it("wraps non-Error throw values when starting EMA IdP authorization fails", async () => {
      const refreshSpy = vi
        .spyOn(emaFlow, "refreshEmaResourceTokens")
        .mockResolvedValue(undefined);
      const startSpy = vi
        .spyOn(emaFlow, "startEmaIdpAuthorization")
        .mockRejectedValue("idp offline");
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

      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.error.message).toBe("idp offline");
      }
      refreshSpy.mockRestore();
      startSpy.mockRestore();
    });

    it("returns interactive for EMA insufficient_scope with no prior scope and no configured fallback", async () => {
      const silentSpy = vi
        .spyOn(emaFlow, "trySilentEmaAuth")
        .mockResolvedValue({ status: "no_idp_session" });
      const authUrl = new URL(
        "https://idp.example.com/authorize?state=ema-empty",
      );
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

      const outcome = await manager.handleAuthChallenge(
        { reason: "insufficient_scope" },
        { confirmedStepUp: true },
      );

      expect(outcome).toEqual(
        expect.objectContaining({
          kind: "interactive",
          authorizationUrl: authUrl,
        }),
      );
      silentSpy.mockRestore();
      startSpy.mockRestore();
    });
  });

  describe("beginInteractiveAuthorization", () => {
    it("records flow state, navigates, and dispatches when state carries an authId", async () => {
      const authorizationUrl = new URL(
        "https://auth.example.com/authorize?state=begin-1",
      );
      const onBeforeOAuthRedirect = vi.fn().mockResolvedValue(undefined);
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue({
          execution: "quick",
          authId: "begin-auth-id",
        } as ReturnType<
          typeof import("@inspector/core/auth/utils.js").parseOAuthState
        >);
      const params = createMockParams({ onBeforeOAuthRedirect });
      storageOf(params).getClientInformation.mockResolvedValue({
        client_id: "cid",
      });
      const manager = new OAuthManager(params);

      await manager.beginInteractiveAuthorization(authorizationUrl);

      expect(onBeforeOAuthRedirect).toHaveBeenCalledWith("begin-auth-id");
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).toHaveBeenCalledWith(authorizationUrl);
      expect(manager.getOAuthFlowStep()).toBe("authorization_code");
      expect(manager.getOAuthFlowState()?.oauthClientInfo).toEqual({
        client_id: "cid",
      });
      expect(params.dispatchOAuthAuthorizationRequired).toHaveBeenCalledWith({
        url: authorizationUrl,
      });

      parseSpy.mockRestore();
    });

    it("skips onBeforeOAuthRedirect when there is no state param", async () => {
      const authorizationUrl = new URL("https://auth.example.com/authorize");
      const onBeforeOAuthRedirect = vi.fn();
      const params = createMockParams({ onBeforeOAuthRedirect });
      const manager = new OAuthManager(params);

      await manager.beginInteractiveAuthorization(authorizationUrl);

      expect(onBeforeOAuthRedirect).not.toHaveBeenCalled();
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).toHaveBeenCalledWith(authorizationUrl);
      expect(params.dispatchOAuthAuthorizationRequired).toHaveBeenCalledWith({
        url: authorizationUrl,
      });
    });

    it("skips onBeforeOAuthRedirect when state param has no authId", async () => {
      const authorizationUrl = new URL(
        "https://auth.example.com/authorize?state=zzz",
      );
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue(null);
      const onBeforeOAuthRedirect = vi.fn();
      const params = createMockParams({ onBeforeOAuthRedirect });
      const manager = new OAuthManager(params);

      await manager.beginInteractiveAuthorization(authorizationUrl);

      expect(onBeforeOAuthRedirect).not.toHaveBeenCalled();

      parseSpy.mockRestore();
    });

    it("does not navigate when the fallible setup rejects", async () => {
      // #2165: the web client drops its OAuth resume snapshot when this
      // rejects, which is only sound because the navigation resolves last.
      const params = createMockParams();
      storageOf(params).getClientInformation.mockRejectedValue(
        new Error("client information unreadable"),
      );
      const manager = new OAuthManager(params);

      await expect(
        manager.beginInteractiveAuthorization(
          new URL("https://auth.example.com/authorize"),
        ),
      ).rejects.toThrow("client information unreadable");
      expect(
        params.initialConfig.navigation!.navigateToAuthorization,
      ).not.toHaveBeenCalled();
      expect(params.dispatchOAuthAuthorizationRequired).not.toHaveBeenCalled();
    });

    it("throws when navigation is not configured", async () => {
      const params = createMockParams({
        initialConfig: {
          storage: createMockParams().initialConfig.storage,
          redirectUrlProvider: {
            getRedirectUrl: vi
              .fn()
              .mockReturnValue("http://localhost/callback"),
          },
        } as OAuthManagerConfig,
      });
      const manager = new OAuthManager(params);

      await expect(
        manager.beginInteractiveAuthorization(
          new URL("https://auth.example.com/authorize"),
        ),
      ).rejects.toThrow("OAuth navigation is required.");
    });
  });

  describe("createOAuthProvider (clientId not configured)", () => {
    it("skips savePreregisteredClientInformation when clientId is not configured", async () => {
      mockedMcpAuth.mockResolvedValue("REDIRECT");
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=no-client-id",
      );
      const params = createMockParams();
      params.initialConfig.clientId = undefined;
      const manager = new OAuthManager(params);
      const captureSpy = vi
        .spyOn(
          (await import("@inspector/core/auth/providers.js"))
            .BaseOAuthClientProvider.prototype,
          "getCapturedAuthUrl",
        )
        .mockReturnValue(capturedUrl);

      await manager.authenticate();

      expect(
        storageOf(params).savePreregisteredClientInformation,
      ).not.toHaveBeenCalled();
      captureSpy.mockRestore();
    });
  });

  describe("completeOAuthFlow (oauthClientInfo null fallback)", () => {
    it("stores null clientInfo when none is available and no flow state pre-exists", async () => {
      mockedMcpAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);

      await manager.completeOAuthFlow("code");

      expect(manager.getOAuthFlowState()?.oauthClientInfo).toBeNull();
    });

    it("stores null clientInfo when none is available and flow state already exists", async () => {
      const capturedUrl = new URL(
        "https://auth.example.com/authorize?state=existing-flow",
      );
      mockedMcpAuth
        .mockResolvedValueOnce("REDIRECT")
        .mockResolvedValueOnce("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "access",
        token_type: "Bearer",
        scope: "mcp",
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
      expect(manager.getOAuthFlowState()).toBeDefined();

      await manager.completeOAuthFlow("code");

      expect(manager.getOAuthFlowState()?.oauthClientInfo).toBeNull();
      captureSpy.mockRestore();
    });
  });

  describe("handleEnterpriseManagedAuthChallenge (scopeToPersist false arm)", () => {
    it("returns satisfied without persisting scope when the EMA mint has no scope to record", async () => {
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
      storageOf(params)
        .getTokens.mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          access_token: "g",
          token_type: "Bearer",
          scope: "granted",
        })
        .mockResolvedValueOnce({ access_token: "g2", token_type: "Bearer" });
      const manager = new OAuthManager(params);
      manager.setOAuthConfig({ enterpriseManaged: true });

      const outcome = await manager.handleAuthChallenge(
        { reason: "insufficient_scope" },
        { confirmedStepUp: true },
      );

      expect(outcome).toEqual({ kind: "satisfied" });
      expect(storageOf(params).saveScope).not.toHaveBeenCalled();
      silentSpy.mockRestore();
    });
  });
});
