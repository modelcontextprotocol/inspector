/**
 * OAuthManager unit tests. Uses mocked getServerUrl, fetch, storage, and
 * dispatch callbacks to verify config merge, callback invocation, clearOAuthTokens,
 * error propagation, and getOAuthFlowState/getOAuthFlowStep after beginGuidedAuth.
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
import { OAuthStateMachine } from "@inspector/core/auth/state-machine.js";
import type { OAuthFlowState, OAuthStep } from "@inspector/core/auth/types.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

// Mock the SDK auth() entry point so quick-flow paths don't hit the network.
// Other named exports of the module are left intact for code that uses them.
vi.mock("@modelcontextprotocol/sdk/client/auth.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@modelcontextprotocol/sdk/client/auth.js")
    >();
  return { ...actual, auth: vi.fn() };
});

const mockedAuth = vi.mocked(auth);

const SERVER_URL = "https://example.com/mcp";

function createMockParams(
  overrides?: Partial<OAuthManagerParams>,
): OAuthManagerParams {
  const dispatchOAuthStepChange = vi.fn();
  const dispatchOAuthComplete = vi.fn();
  const dispatchOAuthAuthorizationRequired = vi.fn();
  const dispatchOAuthError = vi.fn();

  const storage = {
    getScope: vi.fn().mockReturnValue(undefined),
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
    dispatchOAuthStepChange,
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
    mockedAuth.mockReset();
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
      mockedAuth.mockResolvedValue("REDIRECT");
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

    it("throws when auth() unexpectedly returns AUTHORIZED", async () => {
      mockedAuth.mockResolvedValue("AUTHORIZED");
      const manager = new OAuthManager(createMockParams());
      await expect(manager.authenticate()).rejects.toThrow(
        "Unexpected: auth() returned AUTHORIZED without authorization code",
      );
    });

    it("throws when no authorization URL is captured", async () => {
      mockedAuth.mockResolvedValue("REDIRECT");
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
      mockedAuth.mockResolvedValue("REDIRECT");
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

  describe("guided flow", () => {
    function patchStateMachine(
      onExecute: (state: OAuthFlowState) => void,
    ): ReturnType<typeof vi.spyOn> {
      return vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          onExecute(state);
        });
    }

    it("beginGuidedAuth seeds client info from config and executes the first step", async () => {
      const execSpy = patchStateMachine(() => {});
      const params = createMockParams();
      const manager = new OAuthManager(params);

      await manager.beginGuidedAuth();

      expect(execSpy).toHaveBeenCalledTimes(1);
      expect(manager.getOAuthFlowState()?.oauthClientInfo).toEqual({
        client_id: "test-client",
        client_secret: "test-secret",
      });
      execSpy.mockRestore();
    });

    it("runGuidedAuth dispatches authorizationRequired and returns the URL", async () => {
      const authUrl = new URL("https://auth.example.com/authorize?state=guid");
      const execSpy = patchStateMachine((state) => {
        state.oauthStep = "authorization_code";
        state.authorizationUrl = authUrl;
      });
      const parseSpy = vi
        .spyOn(await import("@inspector/core/auth/utils.js"), "parseOAuthState")
        .mockReturnValue({
          execution: "guided",
          authId: "guid-id",
        } as ReturnType<
          typeof import("@inspector/core/auth/utils.js").parseOAuthState
        >);
      const onBeforeOAuthRedirect = vi.fn().mockResolvedValue(undefined);
      const params = createMockParams({ onBeforeOAuthRedirect });
      const manager = new OAuthManager(params);

      const result = await manager.runGuidedAuth();

      expect(result).toEqual(authUrl);
      expect(onBeforeOAuthRedirect).toHaveBeenCalledWith("guid-id");
      expect(params.dispatchOAuthAuthorizationRequired).toHaveBeenCalledWith({
        url: authUrl,
      });
      execSpy.mockRestore();
      parseSpy.mockRestore();
    });

    it("runGuidedAuth returns undefined when the flow already completed", async () => {
      const execSpy = patchStateMachine((state) => {
        state.oauthStep = "complete";
      });
      const manager = new OAuthManager(createMockParams());
      const result = await manager.runGuidedAuth();
      expect(result).toBeUndefined();
      execSpy.mockRestore();
    });

    it("runGuidedAuth throws when no authorization URL is produced", async () => {
      const execSpy = patchStateMachine((state) => {
        state.oauthStep = "authorization_code";
        state.authorizationUrl = null;
      });
      const manager = new OAuthManager(createMockParams());
      await expect(manager.runGuidedAuth()).rejects.toThrow(
        "Failed to generate authorization URL",
      );
      execSpy.mockRestore();
    });

    it("runGuidedAuth loops through intermediate steps before stopping", async () => {
      const authUrl = new URL("https://auth.example.com/authorize");
      const steps: OAuthStep[] = ["client_registration", "authorization_code"];
      let i = 0;
      const execSpy = patchStateMachine((state) => {
        state.oauthStep = steps[i++];
        if (state.oauthStep === "authorization_code") {
          state.authorizationUrl = authUrl;
        }
      });
      const manager = new OAuthManager(createMockParams());
      const result = await manager.runGuidedAuth();
      expect(result).toEqual(authUrl);
      // beginGuidedAuth runs the first step (client_registration); the loop then
      // runs one more step that reaches authorization_code and stops.
      expect(execSpy).toHaveBeenCalledTimes(2);
      execSpy.mockRestore();
    });

    it("the state-machine update callback merges updates and dispatches step changes", async () => {
      // Drive the updateState closure (oauthManager lines 268-280) by reaching
      // into the real OAuthStateMachine instance's private updateState field.
      // The mocked executeStep is a `function` so `this` is the machine.
      interface MachineWithUpdate {
        updateState: (updates: Partial<OAuthFlowState>) => void;
      }
      const captured: { update?: (u: Partial<OAuthFlowState>) => void } = {};
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async function (
          this: MachineWithUpdate,
        ): Promise<void> {
          captured.update = this.updateState.bind(this);
        });

      const params = createMockParams();
      const manager = new OAuthManager(params);
      await manager.beginGuidedAuth();

      expect(captured.update).toBeDefined();
      const update = captured.update!;

      // Non-complete update: merges and dispatches with the new step.
      update({ oauthStep: "client_registration" });
      expect(params.dispatchOAuthStepChange).toHaveBeenLastCalledWith({
        step: "client_registration",
        previousStep: "metadata_discovery",
        state: { oauthStep: "client_registration" },
      });

      // Complete update: also stamps completedAt.
      update({ oauthStep: "complete" });
      expect(manager.getOAuthFlowState()?.completedAt).toEqual(
        expect.any(Number),
      );

      // Update with no oauthStep falls back to the current step.
      update({ authorizationCode: "x" });
      expect(params.dispatchOAuthStepChange).toHaveBeenLastCalledWith({
        step: "complete",
        previousStep: "complete",
        state: { authorizationCode: "x" },
      });

      execSpy.mockRestore();
    });
  });

  describe("setGuidedAuthorizationCode", () => {
    it("throws when current step is not authorization_code", async () => {
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async () => {});
      const manager = new OAuthManager(createMockParams());
      await manager.beginGuidedAuth();
      // After begin, step is still metadata_discovery (executeStep is a no-op).
      await expect(
        manager.setGuidedAuthorizationCode("code", false),
      ).rejects.toThrow(
        /Cannot set authorization code at step metadata_discovery/,
      );
      execSpy.mockRestore();
    });

    it("dispatches a step change without completing when completeFlow is false", async () => {
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          state.oauthStep = "authorization_code";
        });
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await manager.beginGuidedAuth();

      await manager.setGuidedAuthorizationCode("the-code", false);

      expect(params.dispatchOAuthStepChange).toHaveBeenLastCalledWith({
        step: "authorization_code",
        previousStep: "authorization_code",
        state: { authorizationCode: "the-code" },
      });
      execSpy.mockRestore();
    });

    it("completes the flow and dispatches complete with tokens", async () => {
      const tokens = { access_token: "T", token_type: "Bearer" };
      // Phases: begin -> authorization_code; complete-flow: first executeStep
      // moves to token_request (loop body runs), second reaches complete.
      const phases: OAuthStep[] = [
        "authorization_code",
        "token_request",
        "complete",
      ];
      let phase = 0;
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          state.oauthStep = phases[phase++];
          if (state.oauthStep === "complete") {
            state.oauthTokens = tokens;
          }
        });
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await manager.beginGuidedAuth();

      await manager.setGuidedAuthorizationCode("the-code", true);

      expect(params.dispatchOAuthComplete).toHaveBeenCalledWith({ tokens });
      execSpy.mockRestore();
    });

    it("throws when completing yields no tokens", async () => {
      let phase = 0;
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          if (phase === 0) {
            state.oauthStep = "authorization_code";
          } else {
            state.oauthStep = "complete";
            state.oauthTokens = null;
          }
          phase++;
        });
      const manager = new OAuthManager(createMockParams());
      await manager.beginGuidedAuth();
      await expect(
        manager.setGuidedAuthorizationCode("code", true),
      ).rejects.toThrow("Failed to exchange authorization code for tokens");
      execSpy.mockRestore();
    });
  });

  describe("proceedOAuthStep", () => {
    it("executes a step when in a guided flow", async () => {
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async () => {});
      const manager = new OAuthManager(createMockParams());
      await manager.beginGuidedAuth();
      execSpy.mockClear();
      await manager.proceedOAuthStep();
      expect(execSpy).toHaveBeenCalledTimes(1);
      execSpy.mockRestore();
    });
  });

  describe("completeOAuthFlow (quick, standard)", () => {
    it("completes via the quick path and dispatches complete", async () => {
      const tokens = { access_token: "QT", token_type: "Bearer" };
      mockedAuth.mockResolvedValue("AUTHORIZED");
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
      mockedAuth.mockResolvedValue("REDIRECT");
      const params = createMockParams();
      const manager = new OAuthManager(params);

      await expect(manager.completeOAuthFlow("code")).rejects.toThrow(
        /Expected AUTHORIZED after providing authorization code/,
      );
      expect(params.dispatchOAuthError).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("throws when tokens cannot be retrieved after authorization", async () => {
      mockedAuth.mockResolvedValue("AUTHORIZED");
      const params = createMockParams();
      storageOf(params).getTokens.mockResolvedValue(undefined);
      const manager = new OAuthManager(params);

      await expect(manager.completeOAuthFlow("code")).rejects.toThrow(
        "Failed to retrieve tokens after authorization",
      );
      expect(params.dispatchOAuthError).toHaveBeenCalled();
    });

    it("delegates to the guided path when a state machine exists", async () => {
      const tokens = { access_token: "GT", token_type: "Bearer" };
      let phase = 0;
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          if (phase === 0) {
            state.oauthStep = "authorization_code";
          } else {
            state.oauthStep = "complete";
            state.oauthTokens = tokens;
          }
          phase++;
        });
      const params = createMockParams();
      const manager = new OAuthManager(params);
      await manager.beginGuidedAuth();

      await manager.completeOAuthFlow("code");

      expect(params.dispatchOAuthComplete).toHaveBeenCalledWith({ tokens });
      // auth() (quick path) must not be used when a guided machine exists.
      expect(mockedAuth).not.toHaveBeenCalled();
      execSpy.mockRestore();
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

  describe("getOAuthTokens (in-memory)", () => {
    it("returns tokens from in-memory flow state when present", async () => {
      const tokens = { access_token: "MEM", token_type: "Bearer" };
      const execSpy = vi
        .spyOn(OAuthStateMachine.prototype, "executeStep")
        .mockImplementation(async (state: OAuthFlowState) => {
          state.oauthTokens = tokens;
        });
      const params = createMockParams();
      // Storage returns something different to prove the in-memory wins.
      storageOf(params).getTokens.mockResolvedValue({
        access_token: "STORED",
        token_type: "Bearer",
      });
      const manager = new OAuthManager(params);
      await manager.beginGuidedAuth();

      expect(await manager.getOAuthTokens()).toEqual(tokens);
      execSpy.mockRestore();
    });

    it("returns undefined when provider.tokens() throws", async () => {
      const params = createMockParams();
      storageOf(params).getTokens.mockRejectedValue(new Error("boom"));
      const manager = new OAuthManager(params);
      expect(await manager.getOAuthTokens()).toBeUndefined();
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
