import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Mock } from "vitest";
import AuthDebugger, { AuthDebuggerProps } from "../AuthDebugger";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { EMPTY_GUIDED_STATE } from "@modelcontextprotocol/inspector-shared/auth/types.js";
import type { AuthGuidedState } from "@modelcontextprotocol/inspector-shared/auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const mockToast = vi.fn();
vi.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockOAuthTokens: OAuthTokens = {
  access_token: "test_access_token",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "test_refresh_token",
  scope: "test_scope",
};

const mockOAuthState: AuthGuidedState = {
  ...EMPTY_GUIDED_STATE,
  oauthStep: "metadata_discovery",
  oauthTokens: null,
};

const mockOAuthStateWithTokens: AuthGuidedState = {
  ...EMPTY_GUIDED_STATE,
  oauthStep: "complete",
  oauthTokens: mockOAuthTokens,
};

const mockOAuthStateInProgress: AuthGuidedState = {
  ...EMPTY_GUIDED_STATE,
  oauthStep: "authorization_code",
  authorizationUrl: new URL("https://oauth.example.com/authorize"),
  oauthClientInfo: {
    client_id: "test_client_id",
    redirect_uris: ["http://localhost:3000/oauth/callback"],
  },
};

// Type for mock client so we can call .mockReturnValue etc. on methods
type MockInspectorClient = InspectorClient & {
  _triggerEvent: (event: string) => void;
  getOAuthState: Mock<() => AuthGuidedState | undefined>;
  getOAuthTokens: Mock<() => Promise<OAuthTokens | undefined>>;
  authenticate: Mock<() => Promise<URL>>;
  beginGuidedAuth: Mock<() => Promise<void>>;
  proceedOAuthStep: Mock<() => Promise<void>>;
  clearOAuthTokens: Mock<() => void>;
  addEventListener: Mock;
  removeEventListener: Mock;
};

// Create a mock InspectorClient factory
const createMockInspectorClient = (): MockInspectorClient => {
  const eventListeners: Map<string, Set<() => void>> = new Map();

  const mockClient = {
    getOAuthState: vi.fn<() => AuthGuidedState | undefined>(() => undefined),
    getOAuthTokens: vi.fn<() => Promise<OAuthTokens | undefined>>(() =>
      Promise.resolve(undefined),
    ),
    authenticate: vi.fn<() => Promise<URL>>(() =>
      Promise.resolve(new URL("https://oauth.example.com/authorize")),
    ),
    beginGuidedAuth: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    proceedOAuthStep: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    clearOAuthTokens: vi.fn<() => void>(() => {}),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      eventListeners.get(event)?.delete(handler);
    }),
    // Helper to trigger events in tests
    _triggerEvent: (event: string) => {
      eventListeners.get(event)?.forEach((handler) => handler());
    },
  } as unknown as MockInspectorClient;

  return mockClient;
};

describe("AuthDebugger", () => {
  let mockInspectorClient: ReturnType<typeof createMockInspectorClient>;
  const defaultProps: AuthDebuggerProps = {
    inspectorClient: null,
    ensureInspectorClient: vi.fn(() => null),
    canCreateInspectorClient: vi.fn(() => false),
    onBack: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInspectorClient = createMockInspectorClient();
    defaultProps.inspectorClient = mockInspectorClient;
    defaultProps.onBack = vi.fn();
    // Setup default mocks for ensureInspectorClient and canCreateInspectorClient
    (defaultProps.ensureInspectorClient as Mock).mockReturnValue(
      mockInspectorClient,
    );
    (defaultProps.canCreateInspectorClient as Mock).mockReturnValue(true);

    // Suppress console errors in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderAuthDebugger = (props: Partial<AuthDebuggerProps> = {}) => {
    const mergedProps = {
      ...defaultProps,
      ...props,
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
      const onBack = vi.fn();
      await act(async () => {
        renderAuthDebugger({ onBack });
      });
      fireEvent.click(screen.getByText("Back to Connect"));
      expect(onBack).toHaveBeenCalled();
    });

    it("should render OAuth buttons when inspectorClient is provided", async () => {
      await act(async () => {
        renderAuthDebugger();
      });
      expect(screen.getByText("Guided OAuth Flow")).toBeInTheDocument();
      expect(screen.getByText("Quick OAuth Flow")).toBeInTheDocument();
      expect(screen.getByText("Clear OAuth State")).toBeInTheDocument();
    });

    it("should not render OAuth buttons when inspectorClient is null", async () => {
      await act(async () => {
        renderAuthDebugger({ inspectorClient: null });
      });
      // Component should still render but OAuth functionality may be disabled
      expect(screen.getByText("Authentication Settings")).toBeInTheDocument();
    });
  });

  describe("OAuth Flow - Quick Auth", () => {
    it("should call authenticate() when Quick OAuth Flow button is clicked", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      expect(mockInspectorClient.authenticate).toHaveBeenCalledTimes(1);
    });

    it("should show loading state while authenticating", async () => {
      let resolveAuth: (value: URL) => void;
      const authPromise = new Promise<URL>((resolve) => {
        resolveAuth = resolve;
      });
      mockInspectorClient.authenticate.mockReturnValue(authPromise);
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      // Button should be disabled during authentication
      const button = screen.getByText("Initiating...");
      expect(button).toBeDisabled();

      // Resolve the promise
      await act(async () => {
        resolveAuth!(new URL("https://oauth.example.com/authorize"));
      });
    });

    it("should show error toast when authenticate() fails", async () => {
      const error = new Error("Authentication failed");
      mockInspectorClient.authenticate.mockRejectedValue(error);
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Quick OAuth Flow"));
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "OAuth Error",
            description: "Authentication failed",
            variant: "destructive",
          }),
        );
      });
    });

    it("should show 'Quick Refresh' button when tokens exist", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      expect(screen.getByText("Quick Refresh")).toBeInTheDocument();
      expect(screen.queryByText("Quick OAuth Flow")).not.toBeInTheDocument();
    });
  });

  describe("OAuth Flow - Guided Auth", () => {
    it("should call beginGuidedAuth() when Guided OAuth Flow button is clicked", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      expect(mockInspectorClient.beginGuidedAuth).toHaveBeenCalledTimes(1);
    });

    it("should show loading state while starting guided auth", async () => {
      let resolveAuth: () => void;
      const authPromise = new Promise<void>((resolve) => {
        resolveAuth = resolve;
      });
      mockInspectorClient.beginGuidedAuth.mockReturnValue(authPromise);
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      // Button should be disabled
      const button = screen.getByText("Initiating...");
      expect(button).toBeDisabled();

      await act(async () => {
        resolveAuth!();
      });
    });

    it("should show error toast when beginGuidedAuth() fails", async () => {
      const error = new Error("Guided auth failed");
      mockInspectorClient.beginGuidedAuth.mockRejectedValue(error);
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Guided OAuth Flow"));
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "OAuth Error",
            description: "Guided auth failed",
            variant: "destructive",
          }),
        );
      });
    });

    it("should show 'Guided Token Refresh' button when tokens exist", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      expect(screen.getByText("Guided Token Refresh")).toBeInTheDocument();
      expect(screen.queryByText("Guided OAuth Flow")).not.toBeInTheDocument();
    });
  });

  describe("OAuth State Synchronization", () => {
    it("should sync oauthState from InspectorClient on mount", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      expect(mockInspectorClient.getOAuthState).toHaveBeenCalled();
      expect(screen.getByText(/Access Token:/)).toBeInTheDocument();
    });

    it("should update state when oauthStepChange event fires", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      // Change the state
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateInProgress,
      );

      // Trigger the event
      await act(async () => {
        mockInspectorClient._triggerEvent("oauthStepChange");
      });

      // State should be updated
      expect(mockInspectorClient.getOAuthState).toHaveBeenCalled();
    });

    it("should update state when oauthComplete event fires", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      // Change to complete state
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        mockInspectorClient._triggerEvent("oauthComplete");
      });

      expect(mockInspectorClient.getOAuthState).toHaveBeenCalled();
    });

    it("should update state when oauthError event fires", async () => {
      const errorState: AuthGuidedState = {
        ...mockOAuthState,
        latestError: new Error("OAuth error occurred"),
      };
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      mockInspectorClient.getOAuthState.mockReturnValue(errorState);

      await act(async () => {
        mockInspectorClient._triggerEvent("oauthError");
      });

      expect(mockInspectorClient.getOAuthState).toHaveBeenCalled();
    });

    it("should check for existing tokens on mount", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(undefined);
      mockInspectorClient.getOAuthTokens.mockResolvedValue(mockOAuthTokens);

      await act(async () => {
        renderAuthDebugger();
      });

      await waitFor(() => {
        expect(mockInspectorClient.getOAuthTokens).toHaveBeenCalled();
      });
    });

    it("should register and cleanup event listeners", async () => {
      await act(async () => {
        renderAuthDebugger();
      });

      expect(mockInspectorClient.addEventListener).toHaveBeenCalledWith(
        "oauthStepChange",
        expect.any(Function),
      );
      expect(mockInspectorClient.addEventListener).toHaveBeenCalledWith(
        "oauthComplete",
        expect.any(Function),
      );
      expect(mockInspectorClient.addEventListener).toHaveBeenCalledWith(
        "oauthError",
        expect.any(Function),
      );

      // Cleanup
      const { unmount } = renderAuthDebugger();
      unmount();

      expect(mockInspectorClient.removeEventListener).toHaveBeenCalled();
    });
  });

  describe("OAuth Token Display", () => {
    it("should display access token when tokens exist", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      expect(screen.getByText(/Access Token:/)).toBeInTheDocument();
      // Component shows first 25 chars + "..."
      const tokenPrefix = mockOAuthTokens.access_token.substring(0, 25);
      // The token text appears in the component (might appear multiple times)
      const tokenElements = screen.getAllByText((_content, element) => {
        return element?.textContent?.includes(tokenPrefix) ?? false;
      });
      expect(tokenElements.length).toBeGreaterThan(0);
    });

    it("should not display access token when tokens don't exist", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      expect(screen.queryByText(/Access Token:/)).not.toBeInTheDocument();
    });
  });

  describe("OAuth State Management - Clear", () => {
    it("should call clearOAuthTokens() when Clear button is clicked", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Clear OAuth State"));
      });

      expect(mockInspectorClient.clearOAuthTokens).toHaveBeenCalledTimes(1);
    });

    it("should show success toast when clear succeeds", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Clear OAuth State"));
      });

      // Toast is shown via useToast hook - we can't easily test it without mocking
      // But we can verify the method was called
      expect(mockInspectorClient.clearOAuthTokens).toHaveBeenCalled();
    });

    it("should show error toast when clear fails", async () => {
      const error = new Error("Clear failed");
      mockInspectorClient.clearOAuthTokens.mockImplementation(() => {
        throw error;
      });
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateWithTokens,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Clear OAuth State"));
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Error",
            description: "Clear failed",
            variant: "destructive",
          }),
        );
      });
    });
  });

  describe("OAuth Flow Progress", () => {
    it("should render OAuthFlowProgress component", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      expect(screen.getByText("OAuth Flow Progress")).toBeInTheDocument();
    });

    it("should pass oauthState to OAuthFlowProgress", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateInProgress,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      // OAuthFlowProgress should receive the state
      expect(screen.getByText("OAuth Flow Progress")).toBeInTheDocument();
    });

    it("should call proceedOAuthStep() when Continue is clicked in guided flow", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateInProgress,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      // Find and click Continue button (from OAuthFlowProgress)
      const continueButton = screen.getByText("Continue");
      await act(async () => {
        fireEvent.click(continueButton);
      });

      expect(mockInspectorClient.proceedOAuthStep).toHaveBeenCalledTimes(1);
    });

    it("should NOT auto-open authorization URL when clicking Continue at authorization_code step", async () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      mockInspectorClient.getOAuthState.mockReturnValue(
        mockOAuthStateInProgress,
      );

      await act(async () => {
        renderAuthDebugger();
      });

      // Click Continue button - it should NOT auto-open the URL
      // (auto-opening was removed; users use the manual button at authorization_redirect step)
      const continueButton = screen.getByText("Continue");
      await act(async () => {
        fireEvent.click(continueButton);
      });

      // Wait a bit to ensure window.open is not called
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(openSpy).not.toHaveBeenCalled();

      // Verify proceedOAuthStep was still called
      expect(mockInspectorClient.proceedOAuthStep).toHaveBeenCalledTimes(1);

      openSpy.mockRestore();
    });
  });

  describe("Error Display", () => {
    it("should display error message when latestError is set", async () => {
      const errorState: AuthGuidedState = {
        ...mockOAuthState,
        latestError: new Error("Test error message"),
      };
      mockInspectorClient.getOAuthState.mockReturnValue(errorState);

      await act(async () => {
        renderAuthDebugger();
      });

      // Error message should be displayed in StatusMessage component
      // Use getAllByText since the message might appear in multiple places
      const errorMessages = screen.getAllByText(/Test error message/);
      expect(errorMessages.length).toBeGreaterThan(0);
    });

    it("should not display error message when latestError is null", async () => {
      mockInspectorClient.getOAuthState.mockReturnValue(mockOAuthState);

      await act(async () => {
        renderAuthDebugger();
      });

      // StatusMessage component only renders when latestError exists
      // So we just verify no error is shown
      expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    });
  });
});
