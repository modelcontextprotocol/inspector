import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OAuthStateMachine,
  oauthTransitions,
} from "../../auth/state-machine.js";
import type { AuthGuidedState, OAuthStep } from "../../auth/types.js";
import { EMPTY_GUIDED_STATE } from "../../auth/types.js";
import type { BaseOAuthClientProvider } from "../../auth/providers.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

// Mock SDK functions
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: vi.fn(),
  discoverOAuthProtectedResourceMetadata: vi.fn(),
  registerClient: vi.fn(),
  startAuthorization: vi.fn(),
  exchangeAuthorization: vi.fn(),
  selectResourceURL: vi.fn(),
}));

describe("OAuthStateMachine", () => {
  let mockProvider: BaseOAuthClientProvider;
  let updateState: (updates: Partial<AuthGuidedState>) => void;
  let state: AuthGuidedState;

  beforeEach(() => {
    state = { ...EMPTY_GUIDED_STATE };
    updateState = vi.fn((updates: Partial<AuthGuidedState>) => {
      state = { ...state, ...updates };
    });

    mockProvider = {
      serverUrl: "http://localhost:3000",
      redirectUrl: "http://localhost:3000/callback",
      scope: "read write",
      clientMetadata: {
        redirect_uris: ["http://localhost:3000/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        client_name: "Test Client",
        scope: "read write",
      },
      clientInformation: vi.fn(),
      saveClientInformation: vi.fn(),
      tokens: vi.fn(),
      saveTokens: vi.fn(),
      codeVerifier: vi.fn(() => "test-code-verifier"),
      clear: vi.fn(),
      state: vi.fn(() => "test-state"),
    } as unknown as BaseOAuthClientProvider;
  });

  describe("oauthTransitions", () => {
    it("should have transitions for all OAuth steps", () => {
      const steps: OAuthStep[] = [
        "metadata_discovery",
        "client_registration",
        "authorization_redirect",
        "authorization_code",
        "token_request",
        "complete",
      ];

      steps.forEach((step) => {
        expect(oauthTransitions[step]).toBeDefined();
        expect(oauthTransitions[step].canTransition).toBeDefined();
        expect(oauthTransitions[step].execute).toBeDefined();
      });
    });
  });

  describe("OAuthStateMachine", () => {
    it("should create state machine instance", () => {
      const stateMachine = new OAuthStateMachine(
        "http://localhost:3000",
        mockProvider,
        updateState,
      );

      expect(stateMachine).toBeDefined();
    });

    it("should update state when executeStep is called", async () => {
      const stateMachine = new OAuthStateMachine(
        "http://localhost:3000",
        mockProvider,
        updateState,
      );

      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      } as OAuthMetadata);

      await stateMachine.executeStep(state);

      expect(updateState).toHaveBeenCalled();
    });
  });
});
