import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import { useDraggablePane } from "../lib/hooks/useDraggablePane";

// Mock URL params
const mockURLSearchParams = vi.fn();
vi.stubGlobal("URLSearchParams", mockURLSearchParams);

// Mock the hooks
vi.mock("../lib/hooks/useConnection", () => ({
  useConnection: vi.fn(),
}));

vi.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: vi.fn(),
}));

// Mock fetch for config
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("App", () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock URL params
    mockURLSearchParams.mockReturnValue({
      get: () => "3000",
    });

    // Mock fetch response
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          defaultEnvironment: {},
          defaultCommand: "test-command",
          defaultArgs: "--test",
        }),
    });

    // Mock useConnection hook
    const mockUseConnection = useConnection as jest.Mock;
    mockUseConnection.mockReturnValue({
      connectionStatus: "disconnected",
      serverCapabilities: null,
      mcpClient: null,
      requestHistory: [],
      makeRequest: vi.fn(),
      sendNotification: vi.fn(),
      connect: vi.fn(),
    });

    // Mock useDraggablePane hook
    const mockUseDraggablePane = useDraggablePane as jest.Mock;
    mockUseDraggablePane.mockReturnValue({
      height: 300,
      handleDragStart: vi.fn(),
    });
  });

  it("renders initial disconnected state", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(
      screen.getByText("Connect to an MCP server to start inspecting"),
    ).toBeInTheDocument();
  });

  it("loads config on mount", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/config");
  });

  it("shows connected interface when mcpClient is available", async () => {
    const mockUseConnection = useConnection as jest.Mock;
    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: {
        resources: true,
        prompts: true,
        tools: true,
      },
      mcpClient: {},
      requestHistory: [],
      makeRequest: vi.fn(),
      sendNotification: vi.fn(),
      connect: vi.fn(),
    });

    await act(async () => {
      render(<App />);
    });

    // Use more specific selectors
    const resourcesTab = screen.getByRole("tab", { name: /resources/i });
    const promptsTab = screen.getByRole("tab", { name: /prompts/i });
    const toolsTab = screen.getByRole("tab", { name: /tools/i });

    expect(resourcesTab).toBeInTheDocument();
    expect(promptsTab).toBeInTheDocument();
    expect(toolsTab).toBeInTheDocument();
  });

  it("disables tabs based on server capabilities", async () => {
    const mockUseConnection = useConnection as jest.Mock;
    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: {
        resources: false,
        prompts: true,
        tools: false,
      },
      mcpClient: {},
      requestHistory: [],
      makeRequest: vi.fn(),
      sendNotification: vi.fn(),
      connect: vi.fn(),
    });

    await act(async () => {
      render(<App />);
    });

    // Resources tab should be disabled
    const resourcesTab = screen.getByRole("tab", { name: /resources/i });
    expect(resourcesTab).toHaveAttribute("disabled");

    // Prompts tab should be enabled
    const promptsTab = screen.getByRole("tab", { name: /prompts/i });
    expect(promptsTab).not.toHaveAttribute("disabled");

    // Tools tab should be disabled
    const toolsTab = screen.getByRole("tab", { name: /tools/i });
    expect(toolsTab).toHaveAttribute("disabled");
  });

  it("shows notification count in sampling tab", async () => {
    const mockUseConnection = useConnection as jest.Mock;
    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: { sampling: true },
      mcpClient: {},
      requestHistory: [],
      makeRequest: vi.fn(),
      sendNotification: vi.fn(),
      connect: vi.fn(),
      onPendingRequest: (request, resolve, reject) => {
        // Simulate a pending request
        setPendingSampleRequests((prev) => [
          ...prev,
          { id: 1, request, resolve, reject },
        ]);
      },
    });

    await act(async () => {
      render(<App />);
    });

    // Initially no notification count
    const samplingTab = screen.getByRole("tab", { name: /sampling/i });
    expect(samplingTab.querySelector(".bg-red-500")).not.toBeInTheDocument();

    // Simulate a pending request
    await act(async () => {
      mockUseConnection.mock.calls[0][0].onPendingRequest(
        { method: "test", params: {} },
        () => {},
        () => {},
      );
    });

    // Should show notification count
    expect(samplingTab.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("persists command and args to localStorage", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      render(<App />);
    });

    // Simulate command change
    await act(async () => {
      const commandInput = screen.getByPlaceholderText(/command/i);
      fireEvent.change(commandInput, { target: { value: "new-command" } });
    });

    expect(setItemSpy).toHaveBeenCalledWith("lastCommand", "new-command");
  });

  it("shows error message when server has no capabilities", async () => {
    const mockUseConnection = useConnection as jest.Mock;
    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: {},
      mcpClient: {},
      requestHistory: [],
      makeRequest: vi.fn(),
      sendNotification: vi.fn(),
      connect: vi.fn(),
    });

    await act(async () => {
      render(<App />);
    });
    expect(
      screen.getByText(
        "The connected server does not support any MCP capabilities",
      ),
    ).toBeInTheDocument();
  });
});
