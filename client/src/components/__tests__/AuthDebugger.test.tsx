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
import { EMPTY_DEBUGGER_STATE } from "@/lib/auth-types";

const mockOAuthTokens = {
  access_token: "test_access_token",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "test_refresh_token",
  scope: "test_scope",
};

// Mock MCP SDK functions
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
  extractWWWAuthenticateParams: jest.fn().mockReturnValue({}),
}));

// Mock local auth module
jest.mock("@/lib/auth", () => ({
  DebugInspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    tokens: jest.fn().mockImplementation(() => Promise.resolve(undefined)),
    clear: jest.fn().mockImplementation(() => {
      // Mock the real clear() behavior
      sessionStorage.removeItem("[https://example.com/mcp] mcp_tokens");
    }),
  })),
}));

// Mock the AuthDebuggerFlow component since it has complex async behavior
jest.mock("../AuthDebuggerFlow", () => ({
  AuthDebuggerFlow: jest.fn(({ onComplete, onCancel, onError }) => (
    <div data-testid="mock-auth-debugger-flow">
      <button onClick={() => onComplete(mockOAuthTokens)}>Mock Complete</button>
      <button onClick={() => onCancel()}>Mock Cancel</button>
      <button onClick={() => onError(new Error("Test error"))}>
        Mock Error
      </button>
    </div>
  )),
}));

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

    // Suppress console errors in tests
    jest.spyOn(console, "error").mockImplementation(() => {});
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

    it("should show Debug Flow and Quick Flow buttons when no tokens exist", async () => {
      await act(async () => {
        renderAuthDebugger();
      });
      expect(
        screen.getByRole("button", { name: "Debug Flow" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Quick Flow" }),
      ).toBeInTheDocument();
    });

    it("should show Debug Flow and Quick Flow buttons when tokens exist", async () => {
      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            oauthTokens: mockOAuthTokens,
          },
        });
      });
      expect(
        screen.getByRole("button", { name: "Debug Flow" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Quick Flow" }),
      ).toBeInTheDocument();
    });
  });

  describe("Debug Flow", () => {
    it("should show error when debug flow is started without serverUrl", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ serverUrl: "", updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Debug Flow" }));
      });

      expect(updateAuthState).toHaveBeenCalledWith({
        statusMessage: {
          type: "error",
          message:
            "Please enter a server URL in the sidebar before authenticating",
        },
      });
    });

    it("should show AuthDebuggerFlow when debug flow is started", async () => {
      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Debug Flow" }));
      });

      expect(screen.getByTestId("mock-auth-debugger-flow")).toBeInTheDocument();
    });

    it("should handle flow completion", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Debug Flow" }));
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Mock Complete"));
      });

      expect(updateAuthState).toHaveBeenCalledWith({
        oauthTokens: mockOAuthTokens,
        oauthStep: "complete",
      });
    });

    it("should handle flow cancellation", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Debug Flow" }));
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Mock Cancel"));
      });

      expect(updateAuthState).toHaveBeenCalledWith({
        statusMessage: {
          type: "info",
          message: "OAuth flow cancelled",
        },
      });
    });

    it("should handle flow error", async () => {
      const updateAuthState = jest.fn();
      await act(async () => {
        renderAuthDebugger({ updateAuthState });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Debug Flow" }));
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Mock Error"));
      });

      expect(updateAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          latestError: expect.any(Error),
          statusMessage: {
            type: "error",
            message: "OAuth flow failed: Test error",
          },
        }),
      );
    });
  });

  describe("Session Storage Integration", () => {
    it("should display OAuth tokens when they exist", async () => {
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

  describe("Status Messages", () => {
    it("should display success messages", async () => {
      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            statusMessage: {
              type: "success",
              message: "Test success message",
            },
          },
        });
      });

      expect(screen.getByText("Test success message")).toBeInTheDocument();
    });

    it("should display error messages", async () => {
      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            statusMessage: {
              type: "error",
              message: "Test error message",
            },
          },
        });
      });

      expect(screen.getByText("Test error message")).toBeInTheDocument();
    });

    it("should display info messages", async () => {
      await act(async () => {
        renderAuthDebugger({
          authState: {
            ...defaultAuthState,
            statusMessage: {
              type: "info",
              message: "Test info message",
            },
          },
        });
      });

      expect(screen.getByText("Test info message")).toBeInTheDocument();
    });
  });
});
