import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import AuthDebugger, { AuthDebuggerProps } from "../AuthDebugger";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SESSION_KEYS } from "@/lib/constants";

const mockOAuthTokens = {
  access_token: "test_access_token",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "test_refresh_token",
  scope: "test_scope",
};

const mockOAuthMetadata = {
  issuer: "https://oauth.example.com",
  authorization_endpoint: "https://oauth.example.com/authorize",
  token_endpoint: "https://oauth.example.com/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  scopes_supported: ["read", "write"],
};

const mockOAuthClientInfo = {
  client_id: "test_client_id",
  client_secret: "test_client_secret",
  redirect_uris: ["http://localhost:3000/oauth/callback/debug"],
};

// Mock MCP SDK functions - must be before imports
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
  discoverAuthorizationServerMetadata: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
  exchangeAuthorization: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  selectResourceURL: jest.fn(),
}));

// Import the functions to get their types
import {
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  auth,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { EMPTY_DEBUGGER_STATE } from "@/lib/auth-types";

// Mock local auth module
jest.mock("@/lib/auth", () => ({
  DebugInspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    tokens: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    clear: jest.fn().mockImplementation(() => {
      // Mock the real clear() behavior which removes items from sessionStorage
      sessionStorage.removeItem("[https://example.com/mcp] mcp_tokens");
      sessionStorage.removeItem("[https://example.com/mcp] mcp_client_info");
      sessionStorage.removeItem(
        "[https://example.com/mcp] mcp_server_metadata",
      );
    }),
    redirectUrl: "http://localhost:3000/oauth/callback/debug",
    clientMetadata: {
      redirect_uris: ["http://localhost:3000/oauth/callback/debug"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MCP Inspector",
    },
    clientInformation: jest.fn().mockImplementation(async () => {
      const serverUrl = "https://example.com/mcp";
      const preregisteredKey = `[${serverUrl}] ${SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION}`;
      const preregisteredData = sessionStorage.getItem(preregisteredKey);
      if (preregisteredData) {
        return JSON.parse(preregisteredData);
      }
      const dynamicKey = `[${serverUrl}] ${SESSION_KEYS.CLIENT_INFORMATION}`;
      const dynamicData = sessionStorage.getItem(dynamicKey);
      if (dynamicData) {
        return JSON.parse(dynamicData);
      }
      return undefined;
    }),
    saveClientInformation: jest.fn().mockImplementation((clientInfo) => {
      const serverUrl = "https://example.com/mcp";
      const key = `[${serverUrl}] ${SESSION_KEYS.CLIENT_INFORMATION}`;
      sessionStorage.setItem(key, JSON.stringify(clientInfo));
    }),
    saveTokens: jest.fn(),
    redirectToAuthorization: jest.fn(),
    saveCodeVerifier: jest.fn(),
    codeVerifier: jest.fn(),
    saveServerMetadata: jest.fn(),
    getServerMetadata: jest.fn(),
  })),
  discoverScopes: jest.fn().mockResolvedValue("read write" as never),
}));

import { discoverScopes } from "@/lib/auth";

// Type the mocked functions properly
const mockDiscoverAuthorizationServerMetadata =
  discoverAuthorizationServerMetadata as jest.MockedFunction<
    typeof discoverAuthorizationServerMetadata
  >;
const mockRegisterClient = registerClient as jest.MockedFunction<
  typeof registerClient
>;
const mockStartAuthorization = startAuthorization as jest.MockedFunction<
  typeof startAuthorization
>;
const mockExchangeAuthorization = exchangeAuthorization as jest.MockedFunction<
  typeof exchangeAuthorization
>;
const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockDiscoverOAuthProtectedResourceMetadata =
  discoverOAuthProtectedResourceMetadata as jest.MockedFunction<
    typeof discoverOAuthProtectedResourceMetadata
  >;
const mockDiscoverScopes = discoverScopes as jest.MockedFunction<
  typeof discoverScopes
>;

const sessionStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
});

describe("AuthDebugger", () => {
  const defaultAuthState = EMPTY_DEBUGGER_STATE;

  const defaultProps = {
    serverUrl: "https://example.com/mcp",
    onBack: jest.fn(),
    authState: defaultAuthState,
    updateAuthState: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorageMock.getItem.mockReturnValue(null);

    // Suppress console errors in tests to avoid JSDOM navigation noise
    jest.spyOn(console, "error").mockImplementation(() => {});

    // Set default mock behaviors with complete OAuth metadata
    mockDiscoverAuthorizationServerMetadata.mockResolvedValue({
      issuer: "https://oauth.example.com",
      authorization_endpoint: "https://oauth.example.com/authorize",
      token_endpoint: "https://oauth.example.com/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      scopes_supported: ["read", "write"],
    });
    mockRegisterClient.mockResolvedValue(mockOAuthClientInfo);
    mockDiscoverOAuthProtectedResourceMetadata.mockRejectedValue(
      new Error("No protected resource metadata found"),
    );
    mockStartAuthorization.mockImplementation(async (_sseUrl, options) => {
      const authUrl = new URL("https://oauth.example.com/authorize");

      if (options.scope) {
        authUrl.searchParams.set("scope", options.scope);
      }

      return {
        authorizationUrl: authUrl,
        codeVerifier: "test_verifier",
      };
    });
    mockExchangeAuthorization.mockResolvedValue(mockOAuthTokens);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renderAuthDebugger = (props: Partial<AuthDebuggerProps> = {}) => {
    const mergedProps = {
      ...defaultProps,
      ...props,
      authState: { ...defaultAuthState, ...(props.authState || {}) },
    };
    return render(
      <TooltipProvider>
        <AuthDebugger {...mergedProps} />
      </TooltipProvider>,
    );
  };

  describe("Initial Rendering", () => {
    it("should render the component with correct title", async () => {
      await act(async () => {
        renderAuthDebugger();
      });
      expect(screen.getByText("Authentication Settings")).toBeInTheDocument();
    });

    it("should call onBack when Back button is clicked", async () => {
      const onBack = jest.fn();
      await act(async () => {
        renderAuthDebugger({ onBack });
      });
      fireEvent.click(screen.getByText("Back to Connect"));
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe("OAuth Flow", () => {
    it("should start OAuth flow when 'Guided OAuth Flow' is clicked", async () => {
      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      expect(screen.getByText("OAuth Flow Progress")).toBeInTheDocument();
    });

    it("should show error when OAuth flow is started without sseUrl", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ serverUrl: "", updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      expect(updateAuthState).toHaveBeenCalledWith({
        statusMessage: {
          type: "error",
          message:
            "Please enter a server URL in the sidebar before authenticating",
        },
      });
    });

    it("should start quick OAuth flow and properly fetch and save metadata", async () => {
      // Setup the auth mock
      mockAuth.mockResolvedValue("AUTHORIZED");

      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      // Should first discover and save OAuth metadata
      expect(mockDiscoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL("https://example.com/"),
      );

      // Check that updateAuthState was called with the right info message
      expect(updateAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          oauthStep: "authorization_code",
        }),
      );
    });

    it("should show error when quick OAuth flow fails to discover metadata", async () => {
      mockDiscoverAuthorizationServerMetadata.mockRejectedValue(
        new Error("Metadata discovery failed"),
      );

      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      // Check that updateAuthState was called with an error message
      expect(updateAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          statusMessage: {
            type: "error",
            message: expect.stringContaining("Failed to start OAuth flow"),
          },
        }),
      );
    });
  });

  describe("Session Storage Integration", () => {
    it("should load OAuth tokens from session storage", async () => {
      // Mock the specific key for tokens with server URL
      sessionStorageMock.getItem.mockImplementation((key) => {
        if (key === "[https://example.com] mcp_tokens") {
          return JSON.stringify(mockOAuthTokens);
        }
        return null;
      });

      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            oauthTokens: mockOAuthTokens,
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/Access Token:/)).toBeInTheDocument();
      });
    });

    it("should handle errors loading OAuth tokens from session storage", async () => {
      // Mock console to avoid cluttering test output
      const originalError = console.error;
      console.error = jest.fn();

      // Mock getItem to return invalid JSON for tokens
      sessionStorageMock.getItem.mockImplementation((key) => {
        if (key === "[https://example.com] mcp_tokens") {
          return "invalid json";
        }
        return null;
      });

      await act(async () => {
        renderAuthDebugger();
      });

      // Component should still render despite the error
      expect(screen.getByText("Authentication Settings")).toBeInTheDocument();

      // Restore console.error
      console.error = originalError;
    });
  });

  describe("OAuth State Management", () => {
    it("should clear OAuth state when Clear button is clicked", async () => {
      const updateAuthState = jest.fn();
      // Mock the session storage to return tokens for the specific key
      sessionStorageMock.getItem.mockImplementation((key) => {
        if (key === "[https://example.com] mcp_tokens") {
          return JSON.stringify(mockOAuthTokens);
        }
        return null;
      });

      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            oauthTokens: mockOAuthTokens,
          },
          updateAuthState,
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Clear OAuth State"));
      });

      expect(updateAuthState).toHaveBeenCalledWith({
        authServerUrl: null,
        authorizationUrl: null,
        isInitiatingAuth: false,
        resourceMetadata: null,
        resourceMetadataError: null,
        resource: null,
        oauthTokens: null,
        oauthStep: "metadata_discovery",
        latestError: null,
        oauthClientInfo: null,
        oauthMetadata: null,
        authorizationCode: "",
        validationError: null,
        statusMessage: {
          type: "success",
          message: "OAuth tokens cleared successfully",
        },
      });

      // Verify session storage was cleared
      expect(sessionStorageMock.removeItem).toHaveBeenCalled();
    });
  });

  describe("OAuth Flow Steps", () => {
    it("should handle OAuth flow step progression", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: {
            ...defaultAuthState,
            isInitiatingAuth: false, // Changed to false so button is enabled
            oauthStep: "metadata_discovery",
          },
        });
      });

      // Verify metadata discovery step
      expect(screen.getByText("Metadata Discovery")).toBeInTheDocument();

      // Click Continue - this should trigger metadata discovery
      await act(async () => {
        fireEvent.click(screen.getByText("Continue"));
      });

      expect(mockDiscoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL("https://example.com/"),
      );
    });

    // Setup helper for OAuth authorization tests
    const setupAuthorizationUrlTest = async (metadata: OAuthMetadata) => {
      const updateAuthState = jest.fn();

      // Mock the session storage to return metadata
      sessionStorageMock.getItem.mockImplementation((key) => {
        if (key === `[https://example.com] ${SESSION_KEYS.SERVER_METADATA}`) {
          return JSON.stringify(metadata);
        }
        if (
          key === `[https://example.com] ${SESSION_KEYS.CLIENT_INFORMATION}`
        ) {
          return JSON.stringify(mockOAuthClientInfo);
        }
        return null;
      });

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: {
            ...defaultAuthState,
            isInitiatingAuth: false,
            oauthStep: "authorization_redirect",
            oauthMetadata: metadata,
            oauthClientInfo: mockOAuthClientInfo,
          },
        });
      });

      // Click Continue to trigger authorization
      await act(async () => {
        fireEvent.click(screen.getByText("Continue"));
      });

      return updateAuthState;
    };

    it("should include scope in authorization URL when scopes_supported is present", async () => {
      const metadataWithScopes = {
        ...mockOAuthMetadata,
        scopes_supported: ["read", "write", "admin"],
      };

      const updateAuthState =
        await setupAuthorizationUrlTest(metadataWithScopes);

      // Wait for the updateAuthState to be called
      await waitFor(() => {
        expect(updateAuthState).toHaveBeenCalledWith(
          expect.objectContaining({
            authorizationUrl: expect.objectContaining({
              href: "https://oauth.example.com/authorize?scope=read+write",
            }),
          }),
        );
      });
    });

    it("should include scope in authorization URL when scopes_supported is not present", async () => {
      const updateAuthState =
        await setupAuthorizationUrlTest(mockOAuthMetadata);

      // Wait for the updateAuthState to be called
      await waitFor(() => {
        expect(updateAuthState).toHaveBeenCalledWith(
          expect.objectContaining({
            authorizationUrl: expect.objectContaining({
              href: "https://oauth.example.com/authorize?scope=read+write",
            }),
          }),
        );
      });
    });

    it("should omit scope from authorization URL when discoverScopes returns undefined", async () => {
      // Mock discoverScopes to return undefined (no scopes available)
      mockDiscoverScopes.mockResolvedValueOnce(undefined);

      const updateAuthState =
        await setupAuthorizationUrlTest(mockOAuthMetadata);

      // Wait for the updateAuthState to be called
      await waitFor(() => {
        expect(updateAuthState).toHaveBeenCalledWith(
          expect.objectContaining({
            authorizationUrl: expect.not.stringContaining("scope="),
          }),
        );
      });
    });
  });

  describe("Client Registration behavior", () => {
    it("uses preregistered (static) client information without calling DCR", async () => {
      const preregClientInfo = {
        client_id: "static_client_id",
        client_secret: "static_client_secret",
        redirect_uris: ["http://localhost:3000/oauth/callback/debug"],
      };

      // Return preregistered client info for the server-specific key
      sessionStorageMock.getItem.mockImplementation((key) => {
        if (
          key ===
          `[${defaultProps.serverUrl}] ${SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION}`
        ) {
          return JSON.stringify(preregClientInfo);
        }
        return null;
      });

      const updateAuthState = jest.fn();

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: {
            ...defaultAuthState,
            isInitiatingAuth: false,
            oauthStep: "client_registration",
            oauthMetadata: mockOAuthMetadata as unknown as OAuthMetadata,
          },
        });
      });

      // Proceed from client_registration → authorization_redirect
      await act(async () => {
        fireEvent.click(screen.getByText("Continue"));
      });

      // Should NOT attempt dynamic client registration
      expect(mockRegisterClient).not.toHaveBeenCalled();

      // Should advance with the preregistered client info
      expect(updateAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          oauthClientInfo: expect.objectContaining({
            client_id: "static_client_id",
          }),
          oauthStep: "authorization_redirect",
        }),
      );
    });

    it("falls back to DCR when no static client information is available", async () => {
      // No preregistered or dynamic client info present in session storage
      sessionStorageMock.getItem.mockImplementation(() => null);

      // DCR returns a new client
      mockRegisterClient.mockResolvedValueOnce(mockOAuthClientInfo);

      const updateAuthState = jest.fn();

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: {
            ...defaultAuthState,
            isInitiatingAuth: false,
            oauthStep: "client_registration",
            oauthMetadata: mockOAuthMetadata as unknown as OAuthMetadata,
          },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Continue"));
      });

      expect(mockRegisterClient).toHaveBeenCalledTimes(1);

      // Should save and advance with the DCR client info
      expect(updateAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          oauthClientInfo: expect.objectContaining({
            client_id: "test_client_id",
          }),
          oauthStep: "authorization_redirect",
        }),
      );

      // Verify the dynamically registered client info was persisted
      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        `[${defaultProps.serverUrl}] ${SESSION_KEYS.CLIENT_INFORMATION}`,
        expect.any(String),
      );
    });
  });

  describe("OAuth State Persistence", () => {
    it("should store auth state to sessionStorage before redirect in Quick OAuth Flow", async () => {
      const updateAuthState = jest.fn();

      // Setup mocks for OAuth flow
      mockStartAuthorization.mockResolvedValue({
        authorizationUrl: new URL(
          "https://oauth.example.com/authorize?client_id=test_client_id&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foauth%2Fcallback%2Fdebug",
        ),
        codeVerifier: "test_verifier",
      });

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: { ...defaultAuthState },
        });
      });

      // Click Quick OAuth Flow
      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      // Wait for the flow to reach the authorization step
      await waitFor(() => {
        expect(sessionStorage.setItem).toHaveBeenCalledWith(
          SESSION_KEYS.AUTH_DEBUGGER_STATE,
          expect.stringContaining('"oauthStep":"authorization_code"'),
        );
      });

      // Verify the stored state includes all the accumulated data
      const storedStateCall = (
        sessionStorage.setItem as jest.Mock
      ).mock.calls.find((call) => call[0] === SESSION_KEYS.AUTH_DEBUGGER_STATE);

      expect(storedStateCall).toBeDefined();
      const storedState = JSON.parse(storedStateCall![1] as string);

      expect(storedState).toMatchObject({
        oauthStep: "authorization_code",
        authorizationUrl: expect.stringMatching(
          /^https:\/\/oauth\.example\.com\/authorize/,
        ),
        oauthMetadata: expect.objectContaining({
          token_endpoint: "https://oauth.example.com/token",
        }),
        oauthClientInfo: expect.objectContaining({
          client_id: "test_client_id",
        }),
      });
    });
  });

  describe("OAuth Protected Resource Metadata", () => {
    it("should successfully fetch and display protected resource metadata", async () => {
      const updateAuthState = jest.fn();
      const mockResourceMetadata = {
        resource: "https://example.com/mcp",
        authorization_servers: ["https://custom-auth.example.com"],
        bearer_methods_supported: ["header", "body"],
        resource_documentation: "https://example.com/mcp/docs",
        resource_policy_uri: "https://example.com/mcp/policy",
      };

      // Mock successful metadata discovery
      mockDiscoverOAuthProtectedResourceMetadata.mockResolvedValue(
        mockResourceMetadata,
      );
      mockDiscoverAuthorizationServerMetadata.mockResolvedValue(
        mockOAuthMetadata,
      );

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: { ...defaultAuthState },
        });
      });

      // Click Guided OAuth Flow to start the process
      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      // Verify that the flow started with metadata discovery
      expect(updateAuthState).toHaveBeenCalledWith({
        oauthStep: "metadata_discovery",
        authorizationUrl: null,
        statusMessage: null,
        latestError: null,
      });

      // Click Continue to trigger metadata discovery
      const continueButton = await screen.findByText("Continue");
      await act(async () => {
        fireEvent.click(continueButton);
      });

      // Wait for the metadata to be fetched
      await waitFor(() => {
        expect(mockDiscoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
          "https://example.com/mcp",
        );
      });

      // Verify the state was updated with the resource metadata
      await waitFor(() => {
        expect(updateAuthState).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceMetadata: mockResourceMetadata,
            authServerUrl: new URL("https://custom-auth.example.com"),
            oauthStep: "client_registration",
          }),
        );
      });
    });

    it("should handle protected resource metadata fetch failure gracefully", async () => {
      const updateAuthState = jest.fn();
      const mockError = new Error("Failed to fetch resource metadata");

      // Mock failed metadata discovery
      mockDiscoverOAuthProtectedResourceMetadata.mockRejectedValue(mockError);
      // But OAuth metadata should still work with the original URL
      mockDiscoverAuthorizationServerMetadata.mockResolvedValue(
        mockOAuthMetadata,
      );

      await act(async () => {
        renderAuthDebugger({
          updateAuthState,
          authState: { ...defaultAuthState },
        });
      });

      // Click Guided OAuth Flow
      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      // Click Continue to trigger metadata discovery
      const continueButton = await screen.findByText("Continue");
      await act(async () => {
        fireEvent.click(continueButton);
      });

      // Wait for the metadata fetch to fail
      await waitFor(() => {
        expect(mockDiscoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
          "https://example.com/mcp",
        );
      });

      // Verify the flow continues despite the error
      await waitFor(() => {
        expect(updateAuthState).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceMetadataError: mockError,
            // Should use the original server URL as fallback
            authServerUrl: new URL("https://example.com/"),
            oauthStep: "client_registration",
          }),
        );
      });

      // Verify that regular OAuth metadata discovery was still called
      expect(mockDiscoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL("https://example.com/"),
      );
    });
  });
});
