import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OAuthStateMachine,
  oauthTransitions,
} from "@inspector/core/auth/state-machine.js";
import type { OAuthFlowState, OAuthStep } from "@inspector/core/auth/types.js";
import { EMPTY_OAUTH_FLOW_STATE } from "@inspector/core/auth/types.js";
import type { BaseOAuthClientProvider } from "@inspector/core/auth/providers.js";
import type {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

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
  let updateState: (updates: Partial<OAuthFlowState>) => void;
  let state: OAuthFlowState;

  beforeEach(() => {
    state = { ...EMPTY_OAUTH_FLOW_STATE };
    updateState = vi.fn((updates: Partial<OAuthFlowState>) => {
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
        resourceMetadata as OAuthProtectedResourceMetadata,
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

    it("should use authorization_servers URL from resource metadata for auth server discovery", async () => {
      const authServerUrl = "https://auth-server.com/";
      const resourceMetaDifferentAuth: OAuthProtectedResourceMetadata = {
        resource: serverUrl,
        authorization_servers: [authServerUrl],
        scopes_supported: ["read", "write"],
      };
      const selectedResource = new URL(serverUrl);
      const {
        discoverOAuthProtectedResourceMetadata,
        discoverAuthorizationServerMetadata,
        selectResourceURL,
      } = await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockResolvedValue(
        resourceMetaDifferentAuth,
      );
      vi.mocked(selectResourceURL).mockResolvedValue(selectedResource);

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL(authServerUrl),
        expect.any(Object),
      );
      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceMetadata: resourceMetaDifferentAuth,
          authServerUrl: new URL(authServerUrl),
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
        metaNoServers as OAuthProtectedResourceMetadata,
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
        redirect_uris: ["http://localhost/callback"],
        client_id: "registered-client-id",
      });

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
        token_type: "Bearer",
      });

      const providerWithMetadata = {
        ...mockProvider,
        getServerMetadata: vi.fn(() => metadata),
      } as unknown as BaseOAuthClientProvider;

      const tokenRequestState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "token_request",
        oauthMetadata: metadata as OAuthMetadata,
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

    it("token_request execute throws when client information cannot be obtained", async () => {
      const metadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };
      const providerNoClient = {
        ...mockProvider,
        getServerMetadata: vi.fn(() => metadata),
        clientInformation: vi.fn(async () => undefined),
      } as unknown as BaseOAuthClientProvider;

      const tokenState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "token_request",
        oauthMetadata: metadata as OAuthMetadata,
        authorizationCode: "code-without-client",
      };

      await expect(
        oauthTransitions.token_request.execute({
          state: tokenState,
          serverUrl: "http://localhost:3000",
          provider: providerNoClient,
          updateState,
        }),
      ).rejects.toThrow("Client information not available for token exchange");
    });

    it("wraps a non-Error thrown by resource metadata discovery into an Error", async () => {
      const { discoverOAuthProtectedResourceMetadata } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      // Reject with a non-Error so the catch takes the `new Error(String(e))`
      // branch (line 45).
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockRejectedValue(
        "string-rejection",
      );

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await stateMachine.executeStep(state);

      const call = vi
        .mocked(updateState)
        .mock.calls.find((c) => "resourceMetadataError" in c[0]);
      expect(call?.[0].resourceMetadataError).toBeInstanceOf(Error);
      expect(call?.[0].resourceMetadataError?.message).toBe("string-rejection");
    });

    it("throws when authorization server metadata discovery returns nothing", async () => {
      const {
        discoverOAuthProtectedResourceMetadata,
        discoverAuthorizationServerMetadata,
      } = await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(discoverOAuthProtectedResourceMetadata).mockRejectedValue(
        new Error("no resource metadata"),
      );
      // SDK returns undefined → execute throws "Failed to discover OAuth
      // metadata" (line 69).
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(
        undefined as unknown as OAuthMetadata,
      );

      const stateMachine = new OAuthStateMachine(
        serverUrl,
        mockProvider,
        updateState,
      );
      await expect(stateMachine.executeStep(state)).rejects.toThrow(
        "Failed to discover OAuth metadata",
      );
    });

    it("client_registration falls back to metadata.scopes_supported when provider scope is empty", async () => {
      const { registerClient } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(registerClient).mockResolvedValue({
        redirect_uris: ["http://localhost/callback"],
        client_id: "registered",
      });

      // provider.scope empty → falls into the scope-derivation block; the
      // resourceMetadata has no scopes_supported so it uses metadata's.
      const providerEmptyScope = {
        ...mockProvider,
        scope: "",
        clientMetadata: {
          redirect_uris: ["http://localhost:3000/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          client_name: "Test Client",
          scope: "",
        },
        clientInformation: vi.fn(async () => undefined),
      } as unknown as BaseOAuthClientProvider;

      const regState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "client_registration",
        oauthMetadata: {
          issuer: "http://localhost:3000",
          authorization_endpoint: "http://localhost:3000/authorize",
          token_endpoint: "http://localhost:3000/token",
          response_types_supported: ["code"],
          scopes_supported: ["alpha", "beta"],
        } as OAuthMetadata,
        resourceMetadata: {
          resource: "http://localhost:3000",
        } as OAuthProtectedResourceMetadata,
      };

      await oauthTransitions.client_registration.execute({
        state: regState,
        serverUrl,
        provider: providerEmptyScope,
        updateState,
      });

      expect(providerEmptyScope.clientMetadata.scope).toBe("alpha beta");
      expect(registerClient).toHaveBeenCalled();
    });

    it("authorization_redirect discovers scopes when provider scope is empty", async () => {
      const { startAuthorization } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      vi.mocked(startAuthorization).mockResolvedValue({
        authorizationUrl: new URL("http://localhost:3000/authorize?x=1"),
        codeVerifier: "verifier-xyz",
      });

      const providerEmptyScope = {
        ...mockProvider,
        scope: "",
        saveCodeVerifier: vi.fn(),
        state: vi.fn(() => "st"),
        redirectUrl: "http://localhost:3000/callback",
      } as unknown as BaseOAuthClientProvider;

      const redirectState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "authorization_redirect",
        oauthMetadata: {
          issuer: "http://localhost:3000",
          authorization_endpoint: "http://localhost:3000/authorize",
          token_endpoint: "http://localhost:3000/token",
          response_types_supported: ["code"],
        } as OAuthMetadata,
        oauthClientInfo: { client_id: "test-client" },
        // resourceMetadata with scopes_supported so discoverScopes resolves.
        resourceMetadata: {
          resource: "http://localhost:3000",
          scopes_supported: ["s1", "s2"],
        } as OAuthProtectedResourceMetadata,
      };

      await oauthTransitions.authorization_redirect.execute({
        state: redirectState,
        serverUrl,
        provider: providerEmptyScope,
        updateState,
      });

      expect(startAuthorization).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({ scope: "s1 s2" }),
      );
      expect(providerEmptyScope.saveCodeVerifier).toHaveBeenCalledWith(
        "verifier-xyz",
      );
    });

    it("authorization_code execute sets a validation error and throws when code is blank", async () => {
      const codeState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "authorization_code",
        authorizationCode: "   ",
      };

      await expect(
        oauthTransitions.authorization_code.execute({
          state: codeState,
          serverUrl,
          provider: mockProvider,
          updateState,
        }),
      ).rejects.toThrow("Authorization code required");

      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          validationError: "You need to provide an authorization code",
        }),
      );
    });

    it("authorization_code execute advances to token_request when a code is present", async () => {
      const codeState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "authorization_code",
        authorizationCode: "good-code",
      };

      await oauthTransitions.authorization_code.execute({
        state: codeState,
        serverUrl,
        provider: mockProvider,
        updateState,
      });

      expect(updateState).toHaveBeenCalledWith(
        expect.objectContaining({
          validationError: null,
          oauthStep: "token_request",
        }),
      );
    });

    it("token_request execute throws when provider metadata is unavailable", async () => {
      const providerNoMeta = {
        ...mockProvider,
        codeVerifier: vi.fn(() => "cv"),
        getServerMetadata: vi.fn(() => null),
      } as unknown as BaseOAuthClientProvider;

      const tokenState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "token_request",
        authorizationCode: "code",
        oauthClientInfo: { client_id: "c" },
      };

      await expect(
        oauthTransitions.token_request.execute({
          state: tokenState,
          serverUrl,
          provider: providerNoMeta,
          updateState,
        }),
      ).rejects.toThrow("OAuth metadata not available");
    });

    it("token_request execute coerces a string resource into a URL for exchange", async () => {
      const { exchangeAuthorization } =
        await import("@modelcontextprotocol/sdk/client/auth.js");
      const metadata = {
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/authorize",
        token_endpoint: "http://localhost:3000/token",
        response_types_supported: ["code"],
      };
      vi.mocked(exchangeAuthorization).mockResolvedValue({
        access_token: "tok",
        token_type: "Bearer",
      });

      const providerWithMeta = {
        ...mockProvider,
        codeVerifier: vi.fn(() => "cv"),
        getServerMetadata: vi.fn(() => metadata),
        clientInformation: vi.fn(async () => ({ client_id: "c" })),
        saveTokens: vi.fn(),
        redirectUrl: "http://localhost:3000/callback",
      } as unknown as BaseOAuthClientProvider;

      const tokenState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "token_request",
        authorizationCode: "code",
        oauthClientInfo: { client_id: "c" },
        // resource as a *string* exercises the `new URL(resource)` branch.
        resource: "http://localhost:3000/resource" as unknown as URL,
      };

      await oauthTransitions.token_request.execute({
        state: tokenState,
        serverUrl,
        provider: providerWithMeta,
        updateState,
      });

      expect(exchangeAuthorization).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({
          resource: new URL("http://localhost:3000/resource"),
        }),
      );
    });

    it("complete.canTransition always returns false (terminal state)", async () => {
      const result = await oauthTransitions.complete.canTransition({
        state: { ...EMPTY_OAUTH_FLOW_STATE, oauthStep: "complete" },
        serverUrl: "http://localhost:3000",
        provider: mockProvider,
        updateState,
      });
      expect(result).toBe(false);
      // execute is a no-op
      await expect(
        oauthTransitions.complete.execute({
          state: { ...EMPTY_OAUTH_FLOW_STATE, oauthStep: "complete" },
          serverUrl: "http://localhost:3000",
          provider: mockProvider,
          updateState,
        }),
      ).resolves.toBeUndefined();
    });

    it("executeStep throws when the current step cannot transition", async () => {
      // metadata_discovery.canTransition is unconditional (returns true), but
      // token_request requires authorizationCode + metadata + clientInfo; an
      // empty state will refuse to transition.
      const stateMachine = new OAuthStateMachine(
        "http://localhost:3000",
        mockProvider,
        updateState,
      );
      const blockedState: OAuthFlowState = {
        ...EMPTY_OAUTH_FLOW_STATE,
        oauthStep: "token_request",
      };
      await expect(stateMachine.executeStep(blockedState)).rejects.toThrow(
        /Cannot transition from token_request/,
      );
    });
  });
});
