import { render, waitFor } from "@testing-library/react";
import type { UseInspectorClientResult } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";
import App from "../App";
import { useInspectorClient } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";

// Mock auth dependencies first
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: vi.fn(),
}));

// Mock the config utils (async factory so we can spread importActual)
vi.mock("../utils/configUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/configUtils")>();
  return {
    ...actual,
    getInitialTransportType: vi.fn(() => "stdio"),
    getInitialSseUrl: vi.fn(() => "http://localhost:3001/sse"),
    getInitialCommand: vi.fn(() => "mcp-server-everything"),
    getInitialArgs: vi.fn(() => ""),
    initializeInspectorConfig: vi.fn(() => ({
      MCP_INSPECTOR_API_TOKEN: {
        label: "API Token",
        description:
          "Auth token for authenticating with the Inspector API server",
        value: "test-token",
        is_session_item: true,
      },
    })),
    saveInspectorConfig: vi.fn(),
  };
});

// Default connection state is disconnected (cast for mock)
const disconnectedInspectorClientState: UseInspectorClientResult = {
  status: "disconnected",
  messages: [],
  stderrLogs: [],
  fetchRequests: [],
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  capabilities: {},
  serverInfo: { name: "", version: "" },
  instructions: undefined,
  client: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

// Connected state for tests that need an active connection
const connectedInspectorClientState: UseInspectorClientResult = {
  ...disconnectedInspectorClientState,
  status: "connected",
  capabilities: {},
  client: {} as UseInspectorClientResult["client"], // Mock client - needed for hash setting logic
  serverInfo: { name: "", version: "" },
};

// Mock required dependencies, but unrelated to routing.
vi.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: () => ({
    height: 300,
    handleDragStart: vi.fn(),
  }),
  useDraggableSidebar: () => ({
    width: 320,
    isDragging: false,
    handleDragStart: vi.fn(),
  }),
}));

vi.mock("../components/Sidebar", () => ({
  __esModule: true,
  default: () => <div>Sidebar</div>,
}));

// Mock fetch
global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

// Mock InspectorClient hook
vi.mock(
  "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js",
  () => ({
    useInspectorClient: vi.fn(),
  }),
);

// jsdom does not provide window.matchMedia; useTheme calls it.
const mockMatchMedia = (matches = false) => ({
  matches,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  media: "",
});

describe("App - URL Fragment Routing", () => {
  const mockUseInspectorClient = vi.mocked(useInspectorClient);

  beforeEach(() => {
    vi.restoreAllMocks();

    window.matchMedia = vi
      .fn()
      .mockImplementation((_query: string) =>
        mockMatchMedia(false),
      ) as unknown as typeof window.matchMedia;

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
