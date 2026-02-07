import { render, waitFor } from "@testing-library/react";
import App from "../App";
import { useInspectorClient } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";

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
  getInitialTransportType: jest.fn(() => "stdio"),
  getInitialSseUrl: jest.fn(() => "http://localhost:3001/sse"),
  getInitialCommand: jest.fn(() => "mcp-server-everything"),
  getInitialArgs: jest.fn(() => ""),
  initializeInspectorConfig: jest.fn(() => ({
    MCP_INSPECTOR_API_TOKEN: {
      label: "API Token",
      description:
        "Auth token for authenticating with the Inspector API server",
      value: "",
      is_session_item: true,
    },
  })),
  saveInspectorConfig: jest.fn(),
}));

// Default connection state is disconnected
const disconnectedInspectorClientState = {
  status: "disconnected" as const,
  messages: [],
  stderrLogs: [],
  fetchRequests: [],
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  capabilities: null,
  serverInfo: null,
  instructions: undefined,
  client: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
};

// Connected state for tests that need an active connection
const connectedInspectorClientState = {
  ...disconnectedInspectorClientState,
  status: "connected" as const,
  capabilities: {},
  client: {}, // Mock client object - needed for hash setting logic
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

// Mock InspectorClient hook
jest.mock(
  "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js",
  () => ({
    useInspectorClient: jest.fn(),
  }),
);

describe("App - URL Fragment Routing", () => {
  const mockUseInspectorClient = jest.mocked(useInspectorClient);

  beforeEach(() => {
    jest.restoreAllMocks();

    // Inspector starts disconnected.
    mockUseInspectorClient.mockReturnValue(disconnectedInspectorClientState);
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
      mockUseInspectorClient.mockReturnValue({
        ...connectedInspectorClientState,
        capabilities,
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
