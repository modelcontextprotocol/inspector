import { render, waitFor } from "@testing-library/react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock auth dependencies first
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
}));

jest.mock("../lib/oauth-state-machine", () => ({
  OAuthStateMachine: jest.fn(),
}));

jest.mock("../lib/auth", () => ({
  InspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    tokens: jest.fn().mockResolvedValue(null),
    clear: jest.fn(),
  })),
  DebugInspectorOAuthClientProvider: jest.fn(),
}));

// Mock the config utils
jest.mock("../utils/configUtils", () => ({
  ...jest.requireActual("../utils/configUtils"),
  getMCPProxyAddress: jest.fn(() => "http://localhost:6277"),
  getMCPProxyAuthToken: jest.fn(() => ({
    token: "",
    header: "X-MCP-Proxy-Auth",
  })),
  getInitialTransportType: jest.fn(() => "stdio"),
  getInitialSseUrl: jest.fn(() => "http://localhost:3001/sse"),
  getInitialCommand: jest.fn(() => "mcp-server-everything"),
  getInitialArgs: jest.fn(() => ""),
  initializeInspectorConfig: jest.fn(() => ({})),
  saveInspectorConfig: jest.fn(),
}));

// Default connection state is disconnected
const disconnectedConnectionState = {
  connectionStatus: "disconnected" as const,
  serverCapabilities: null,
  mcpClient: null,
  requestHistory: [],
  clearRequestHistory: jest.fn(),
  makeRequest: jest.fn(),
  sendNotification: jest.fn(),
  handleCompletion: jest.fn(),
  completionsSupported: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
  serverImplementation: null,
};

// Connected state for tests that need an active connection
const connectedConnectionState = {
  ...disconnectedConnectionState,
  connectionStatus: "connected" as const,
  serverCapabilities: {},
  mcpClient: {
    request: jest.fn(),
    notification: jest.fn(),
    close: jest.fn(),
  } as unknown as Client,
};

// Mock required dependencies, but unrelated to routing.
jest.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: () => ({
    height: 300,
    handleDragStart: jest.fn(),
  }),
  useDraggableSidebar: () => ({
    width: 320,
    isDragging: false,
    handleDragStart: jest.fn(),
  }),
}));

jest.mock("../components/Sidebar", () => ({
  __esModule: true,
  default: () => <div>Sidebar</div>,
}));

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

// Use an empty module mock, so that mock state can be reset between tests.
jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - URL Fragment Routing", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.restoreAllMocks();

    // Inspector starts disconnected.
    mockUseConnection.mockReturnValue(disconnectedConnectionState);
  });

  test("does not set hash when starting disconnected", async () => {
    render(<App />);

    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });
  });

  test("sets default hash based on server capabilities priority", async () => {
    // Tab priority follows UI order: Resources | Prompts | Tools | Ping | Sampling | Roots | Auth
    //
    // Server capabilities determine the first three tabs; if none are present, falls back to Ping.

    const testCases = [
      {
        capabilities: { resources: { listChanged: true, subscribe: true } },
        expected: "#resources",
      },
      {
        capabilities: { prompts: { listChanged: true, subscribe: true } },
        expected: "#prompts",
      },
      {
        capabilities: { tools: { listChanged: true, subscribe: true } },
        expected: "#tools",
      },
      { capabilities: {}, expected: "#ping" },
    ];

    const { rerender } = render(<App />);

    for (const { capabilities, expected } of testCases) {
      window.location.hash = "";
      mockUseConnection.mockReturnValue({
        ...connectedConnectionState,
        serverCapabilities: capabilities,
      });

      rerender(<App />);

      await waitFor(() => {
        expect(window.location.hash).toBe(expected);
      });
    }
  });

  test("clears hash when disconnected", async () => {
    // Start with a hash set (simulating a connection)
    window.location.hash = "#resources";

    // App starts disconnected (default mock)
    render(<App />);

    // Should clear the hash when disconnected
    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });
  });
});
