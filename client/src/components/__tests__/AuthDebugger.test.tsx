import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import AuthDebugger from "../AuthDebugger";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock OAuth data that matches the schemas
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
};

const mockOAuthClientInfo = {
  client_id: "test_client_id",
  client_secret: "test_client_secret",
  redirect_uris: ["http://localhost:3000/oauth/callback/debug"],
};

// Mock the toast hook
const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock MCP SDK functions - must be before imports
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
  discoverOAuthMetadata: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
  exchangeAuthorization: jest.fn(),
}));

// Import the functions to get their types
import {
  discoverOAuthMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";

// Type the mocked functions properly
const mockDiscoverOAuthMetadata = discoverOAuthMetadata as jest.MockedFunction<
  typeof discoverOAuthMetadata
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

// Mock Session Storage
const sessionStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
});

// Mock the location.origin
Object.defineProperty(window, "location", {
  value: {
    origin: "http://localhost:3000",
  },
});

describe("AuthDebugger", () => {
  const defaultAuthState = {
    isInitiatingAuth: false,
    oauthTokens: null,
    loading: false,
    oauthStep: "not_started" as const,
    oauthMetadata: null,
    oauthClientInfo: null,
    authorizationUrl: null,
    authorizationCode: "",
    latestError: null,
    statusMessage: null,
    validationError: null,
  };

  const defaultProps = {
    sseUrl: "https://example.com",
    onBack: jest.fn(),
    authState: defaultAuthState,
    updateAuthState: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorageMock.getItem.mockReturnValue(null);

    // Set up mock implementations
    mockDiscoverOAuthMetadata.mockResolvedValue(mockOAuthMetadata);
    mockRegisterClient.mockResolvedValue(mockOAuthClientInfo);
    mockStartAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://oauth.example.com/authorize"),
      codeVerifier: "test_verifier",
    });
    mockExchangeAuthorization.mockResolvedValue(mockOAuthTokens);
  });

  const renderAuthDebugger = (props: any = {}) => {
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
        renderAuthDebugger({ sseUrl: "", updateAuthState });
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
        oauthTokens: null,
        oauthStep: "not_started",
        latestError: null,
        oauthClientInfo: null,
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

      expect(mockDiscoverOAuthMetadata).toHaveBeenCalledWith(
        "https://example.com",
      );
    });
  });
});
