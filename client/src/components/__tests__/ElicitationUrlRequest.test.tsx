import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach, afterEach } from "@jest/globals";
import ElicitationUrlRequest from "../ElicitationUrlRequest";
import {
  PendingElicitationRequest,
  UrlElicitationRequestData,
} from "../ElicitationTab";

// Mock useCopy hook
const mockSetCopied = jest.fn();
let mockCopied = false;
jest.mock("@/lib/hooks/useCopy.ts", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    copied: mockCopied,
    setCopied: mockSetCopied,
  })),
}));

// Mock toast
jest.mock("@/lib/hooks/useToast.ts", () => ({
  toast: jest.fn(),
}));

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  CheckCheck: ({ className }: { className?: string }) => (
    <div data-testid="check-check-icon" className={className}>
      CheckCheck
    </div>
  ),
  Copy: ({ className }: { className?: string }) => (
    <div data-testid="copy-icon" className={className}>
      Copy
    </div>
  ),
}));

// Mock JsonView component
jest.mock("../JsonView", () => {
  return function MockJsonView({ data }: { data: string }) {
    return <div data-testid="json-view">{data}</div>;
  };
});

// Get the mocked toast function
const { toast } = jest.requireMock("@/lib/hooks/useToast.ts");

describe("ElicitationUrlRequest", () => {
  const mockOnResolve = jest.fn();
  const mockWindowOpen = jest.fn();
  const mockConsoleError = jest.fn();
  const mockWriteText = jest.fn();
  const originalWindowOpen = window.open;
  const originalConsoleError = console.error;
  const originalClipboard = navigator.clipboard;

  type UrlPendingElicitationRequest = PendingElicitationRequest & {
    request: UrlElicitationRequestData;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCopied = false;
    window.open = mockWindowOpen;
    console.error = mockConsoleError;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    });
    mockWriteText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    window.open = originalWindowOpen;
    console.error = originalConsoleError;
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  const createMockRequest = (
    overrides: Partial<UrlPendingElicitationRequest> = {},
  ): UrlPendingElicitationRequest => ({
    id: 1,
    request: {
      mode: "url",
      id: 1,
      message: "Please authorize access to your repositories.",
      url: "https://github.com/login/oauth/authorize?client_id=abc123",
      elicitationId: "550e8400-e29b-41d4-a716-446655440000",
    },
    ...overrides,
  });

  const renderElicitationUrlRequest = (
    request: UrlPendingElicitationRequest = createMockRequest(),
  ) => {
    return render(
      <ElicitationUrlRequest request={request} onResolve={mockOnResolve} />,
    );
  };

  describe("Rendering", () => {
    it("should render the component", () => {
      renderElicitationUrlRequest();
      expect(screen.getByTestId("elicitation-request")).toBeInTheDocument();
    });

    it("should display request message", () => {
      const message = "Please provide your API key to continue.";
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message,
            url: "https://example.com/api-key",
            elicitationId: "test-id",
          },
        }),
      );
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("should display domain extracted from URL", () => {
      renderElicitationUrlRequest();
      expect(screen.getByText("Domain: github.com")).toBeInTheDocument();
    });

    it("should display full URL", () => {
      const url = "https://example.com/auth?code=xyz";
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test message",
            url,
            elicitationId: "test-id",
          },
        }),
      );
      expect(screen.getByText(/Full URL:/)).toBeInTheDocument();
      expect(
        screen.getByText((content, element) => {
          return element?.textContent === `Full URL: ${url}`;
        }),
      ).toBeInTheDocument();
    });

    it("should render all action buttons", () => {
      renderElicitationUrlRequest();
      expect(
        screen.getByRole("button", { name: /^accept and open$/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^accept$/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /decline/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /copy url/i }),
      ).toBeInTheDocument();
    });

    it("should render JsonView with request schema", () => {
      renderElicitationUrlRequest();
      expect(screen.getByTestId("json-view")).toBeInTheDocument();
    });

    it("should display request data in JSON format", () => {
      const request = createMockRequest();
      renderElicitationUrlRequest(request);
      const jsonView = screen.getByTestId("json-view");
      const jsonData = JSON.parse(jsonView.textContent || "{}");
      expect(jsonData.message).toBe(request.request.message);
      expect(jsonData.url).toBe(request.request.url);
      expect(jsonData.elicitationId).toBe(request.request.elicitationId);
    });
  });

  describe("User Interactions", () => {
    it("should call window.open and onResolve with accept action when 'Accept and open' button is clicked", () => {
      const request = createMockRequest();
      renderElicitationUrlRequest(request);

      fireEvent.click(screen.getByRole("button", { name: /accept and open/i }));

      expect(mockWindowOpen).toHaveBeenCalledWith(
        request.request.url,
        "_blank",
        "noopener,noreferrer",
      );
      expect(mockOnResolve).toHaveBeenCalledWith(1, {
        action: "accept",
      });
    });

    it("should call onResolve with decline action when Decline button is clicked", () => {
      renderElicitationUrlRequest();

      fireEvent.click(screen.getByRole("button", { name: /decline/i }));

      expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "decline" });
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it("should call onResolve with cancel action when Cancel button is clicked", () => {
      renderElicitationUrlRequest();

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "cancel" });
      expect(mockWindowOpen).not.toHaveBeenCalled();
    });
  });

  describe("URL Validation and Warnings", () => {
    it("should not show protocol warning for HTTPS URLs", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://example.com/secure",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.queryByText("Not https protocol")).not.toBeInTheDocument();
    });

    it("should show protocol warning for HTTP URLs", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "http://example.com/insecure",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Not https protocol")).toBeInTheDocument();
    });

    it("should show warning for Punycode (internationalized) URLs", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://xn--nxasmq6b.com/path",
            elicitationId: "test-id",
          },
        }),
      );

      expect(
        screen.getByText("This URL contains internationalized characters"),
      ).toBeInTheDocument();
    });

    it("should show warning for URLs with non-Latin characters", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://xn--r8jz45g.com/path", // Punycode for 見.com
            elicitationId: "test-id",
          },
        }),
      );

      expect(
        screen.getByText("This URL contains internationalized characters"),
      ).toBeInTheDocument();
    });

    it("should show multiple warnings when applicable", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "http://xn--nxasmq6b.com/path",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Not https protocol")).toBeInTheDocument();
      expect(
        screen.getByText("This URL contains internationalized characters"),
      ).toBeInTheDocument();
    });
  });

  describe("Invalid URL Handling", () => {
    it("should display 'Invalid URL' for malformed URLs without crashing", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "not-a-valid-url",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Domain: Invalid URL")).toBeInTheDocument();
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it("should not show warnings for invalid URLs", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "invalid-url",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.queryByText("Not https protocol")).not.toBeInTheDocument();
      expect(
        screen.queryByText("This URL contains internationalized characters"),
      ).not.toBeInTheDocument();
    });

    it("should handle empty URL string", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Domain: Invalid URL")).toBeInTheDocument();
    });

    it("should still allow interaction with buttons when URL is invalid", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "invalid",
            elicitationId: "test-id",
          },
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
      expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "decline" });
    });
  });

  describe("Different URL Protocols", () => {
    it("should handle localhost URLs", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "http://localhost:3000/auth",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Domain: localhost")).toBeInTheDocument();
      expect(screen.getByText("Not https protocol")).toBeInTheDocument();
    });

    it("should handle URLs with ports", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://example.com:8080/path",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Domain: example.com")).toBeInTheDocument();
    });

    it("should handle URLs with query parameters", () => {
      const url =
        "https://example.com/auth?client_id=123&redirect_uri=http://localhost";
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url,
            elicitationId: "test-id",
          },
        }),
      );

      expect(
        screen.getByText((content, element) => {
          return element?.textContent === `Full URL: ${url}`;
        }),
      ).toBeInTheDocument();
    });

    it("should handle URLs with hash fragments", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://example.com/page#section",
            elicitationId: "test-id",
          },
        }),
      );

      expect(screen.getByText("Domain: example.com")).toBeInTheDocument();
    });
  });

  describe("Request ID Handling", () => {
    it("should use correct request ID when calling onResolve", () => {
      const customId = 42;
      renderElicitationUrlRequest(
        createMockRequest({
          id: customId,
        }),
      );

      fireEvent.click(
        screen.getByRole("button", { name: /^accept and open$/i }),
      );

      expect(mockOnResolve).toHaveBeenCalledWith(customId, {
        action: "accept",
      });
    });

    it("should pass different IDs for different actions", () => {
      const customId = 99;
      renderElicitationUrlRequest(
        createMockRequest({
          id: customId,
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(mockOnResolve).toHaveBeenCalledWith(customId, {
        action: "cancel",
      });
    });
  });

  describe("Copy URL Functionality", () => {
    it("should copy URL to clipboard when Copy URL button is clicked", async () => {
      const url = "https://example.com/auth";
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url,
            elicitationId: "test-id",
          },
        }),
      );

      const copyButton = screen.getByRole("button", { name: /copy url/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(url);
      });
    });

    it("should call setCopied when copy succeeds", async () => {
      renderElicitationUrlRequest();

      const copyButton = screen.getByRole("button", { name: /copy url/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockSetCopied).toHaveBeenCalledWith(true);
      });
    });

    it("should show Copy icon when not copied", () => {
      mockCopied = false;
      renderElicitationUrlRequest();

      expect(screen.getByTestId("copy-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("check-check-icon")).not.toBeInTheDocument();
    });

    it("should show CheckCheck icon when copied", () => {
      mockCopied = true;
      renderElicitationUrlRequest();

      expect(screen.getByTestId("check-check-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("copy-icon")).not.toBeInTheDocument();
    });

    it("should show toast error when clipboard write fails", async () => {
      const error = new Error("Clipboard access denied");
      mockWriteText.mockRejectedValue(error);

      renderElicitationUrlRequest();

      const copyButton = screen.getByRole("button", { name: /copy url/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith({
          title: "Error",
          description: expect.stringContaining("Clipboard access denied"),
        });
      });
    });

    it("should handle non-Error clipboard failures", async () => {
      mockWriteText.mockRejectedValue("Unknown error");

      renderElicitationUrlRequest();

      const copyButton = screen.getByRole("button", { name: /copy url/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith({
          title: "Error",
          description: expect.stringContaining("Unknown error"),
        });
      });
    });
  });

  describe("Button Disabled States", () => {
    it("should disable 'Accept and open' button when URL is invalid", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "not-a-valid-url",
            elicitationId: "test-id",
          },
        }),
      );

      const acceptAndOpenButton = screen.getByRole("button", {
        name: /^accept and open$/i,
      });
      expect(acceptAndOpenButton).toBeDisabled();
    });

    it("should enable 'Accept and open' button when URL is valid", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "https://example.com/valid",
            elicitationId: "test-id",
          },
        }),
      );

      const acceptAndOpenButton = screen.getByRole("button", {
        name: /^accept and open$/i,
      });
      expect(acceptAndOpenButton).not.toBeDisabled();
    });

    it("should not call window.open when 'Accept and open' is clicked with invalid URL", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "invalid",
            elicitationId: "test-id",
          },
        }),
      );

      const acceptAndOpenButton = screen.getByRole("button", {
        name: /^accept and open$/i,
      });

      // Button is disabled, but try to click anyway
      fireEvent.click(acceptAndOpenButton);

      expect(mockWindowOpen).not.toHaveBeenCalled();
    });

    it("should keep other buttons enabled when URL is invalid", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "invalid-url",
            elicitationId: "test-id",
          },
        }),
      );

      expect(
        screen.getByRole("button", { name: /^accept$/i }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole("button", { name: /decline/i }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole("button", { name: /copy url/i }),
      ).not.toBeDisabled();
    });

    it("should disable 'Accept and open' for empty URL", () => {
      renderElicitationUrlRequest(
        createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Test",
            url: "",
            elicitationId: "test-id",
          },
        }),
      );

      const acceptAndOpenButton = screen.getByRole("button", {
        name: /^accept and open$/i,
      });
      expect(acceptAndOpenButton).toBeDisabled();
    });
  });
});
