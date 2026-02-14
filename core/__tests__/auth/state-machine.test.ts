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
      getServerMetadata: vi.fn(() => null),
      saveServerMetadata: vi.fn(),
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

  describe("Resource metadata discovery and selection", () => {
    const serverUrl = "http://localhost:3000";
    const resourceMetadata = {
      resource: "http://localhost:3000",
      authorization_servers: ["http://localhost:3000"],
      scopes_supported: ["read", "write"],
    };

    beforeEach(async () => {
      const {
        discoverAuthorizationServerMetadata,
        discoverOAuthProtectedResourceMetadata,
        selectResourceURL,
      } = await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      } as OAuthMetadata);
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockReset();
      vi.mocked(selectResourceURL).mockReset();
    });

    it("should discover resource metadata from well-known and use first authorization server", async () => {
      const selectedResource = new URL("http://localhost:3000");
      const { discoverOAuthProtectedResourceMetadata, selectResourceURL } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockResolvedValue(
        resourceMetadata as any,
      );
      vi.mocked(selectResourceURL).mockResolvedValue(selectedResource);

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      expect(discoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
        serverUrl,
      );
      expect(selectResourceURL).toHaveBeenCalledWith(
        serverUrl,
        mockProvider,
        resourceMetadata,
      );
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceMetadata,
          resource: selectedResource,
          resourceMetadataError: null,
          authServerUrl: new URL("http://localhost:3000"),
          oauthStep: "client_registration",
        }),
      );
    });

    it("should call selectResourceURL only when resource metadata is present", async () => {
      const { discoverOAuthProtectedResourceMetadata, selectResourceURL } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockRejectedValue(
        new Error(
          "Resource server does not implement OAuth 2.0 Protected Resource Metadata.",
        ),
      );

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      expect(selectResourceURL).not.toHaveBeenCalled();
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceMetadata: null,
          resourceMetadataError: expect.any(Error),
          oauthStep: "client_registration",
        }),
      );
    });

    it("should use default auth server URL when discovery fails", async () => {
      const {
        discoverOAuthProtectedResourceMetadata,
        discoverAuthorizationServerMetadata,
      } = await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockRejectedValue(
        new Error("Discovery failed"),
      );
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      } as OAuthMetadata);

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL("/", serverUrl),
        {}, // No fetchFn when not provided (conditional spread omits it)
      );
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          authServerUrl: new URL("/", serverUrl),
        }),
      );
    });

    it("should use default auth server when metadata has empty authorization_servers", async () => {
      const { discoverOAuthProtectedResourceMetadata, selectResourceURL } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      const metaNoServers = {
        ...resourceMetadata,
        authorization_servers: [] as string[],
      };
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockResolvedValue(
        metaNoServers as any,
      );
      vi.mocked(selectResourceURL).mockResolvedValue(
        new URL("http://localhost:3000"),
      );

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      expect(selectResourceURL).toHaveBeenCalledWith(
        serverUrl,
        mockProvider,
        metaNoServers,
      );
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceMetadata: metaNoServers,
          authServerUrl: new URL("/", serverUrl),
          oauthStep: "client_registration",
        }),
      );
    });

    it("should pass fetchFn to registerClient when provided", async () => {
      const { registerClient } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      const mockFetchFn = vi.fn();
      vi.mocked(registerClient).mockResolvedValue({
        client_id: "registered-client-id",
      } as any);

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
        mockFetchFn,
      );
      await stateMachine.executeStep(state);
      expect(state.oauthStep).toBe("client_registration");

      await stateMachine.executeStep(state);

      expect(registerClient).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({
          fetchFn: mockFetchFn,
        }),
      );
    });

    it("should pass fetchFn to exchangeAuthorization when provided", async () => {
      const { exchangeAuthorization } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      const mockFetchFn = vi.fn();
      const metadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };
      vi.mocked(exchangeAuthorization).mockResolvedValue({
        access_token: "test-token",
      } as any);

      const providerWithMetadata = {
        ...mockProvider,
        getServerMetadata: vi.fn(() => metadata),
      } as unknown as BaseOAuthClientProvider;

      const tokenRequestState: AuthGuidedState = {
        ...EMPTY_GUIDED_STATE,
        oauthStep: "token_request",
        oauthMetadata: metadata as any,
        oauthClientInfo: { client_id: "test-client" },
        authorizationCode: "test-code",
      };

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        providerWithMetadata,
        updateState,
        mockFetchFn,
      );
      await stateMachine.executeStep(tokenRequestState);

      expect(exchangeAuthorization).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({
          fetchFn: mockFetchFn,
        }),
      );
    });
  });
});
