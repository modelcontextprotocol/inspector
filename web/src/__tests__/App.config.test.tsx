import { render, waitFor } from "@testing-library/react";
import App from "../App";
import { DEFAULT_INSPECTOR_CONFIG } from "../lib/constants";
import { InspectorConfig } from "../lib/configurationTypes";
import * as configUtils from "../utils/configUtils";

// Mock auth dependencies first
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
}));

// Mock the config utils
jest.mock("../utils/configUtils", () => ({
  ...jest.requireActual("../utils/configUtils"),
  getInitialTransportType: jest.fn(() => "stdio"),
  getInitialSseUrl: jest.fn(() => "http://localhost:3001/sse"),
  getInitialCommand: jest.fn(() => "mcp-server-everything"),
  getInitialArgs: jest.fn(() => ""),
  initializeInspectorConfig: jest.fn(() => DEFAULT_INSPECTOR_CONFIG),
  saveInspectorConfig: jest.fn(),
}));

// Get references to the mocked functions
const mockInitializeInspectorConfig =
  configUtils.initializeInspectorConfig as jest.Mock;

// Mock InspectorClient hook
jest.mock(
  "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js",
  () => ({
    useInspectorClient: () => ({
      status: "disconnected",
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
    }),
  }),
);

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
global.fetch = jest.fn();

describe("App - Config Endpoint", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () =>
        Promise.resolve({
          defaultEnvironment: { TEST_ENV: "test" },
          defaultCommand: "test-command",
          defaultArgs: "test-args",
        }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Note: These tests are for the old /config endpoint which has been removed.
  // Config is now injected via HTML template (window.__INITIAL_CONFIG__).
  // These tests should be updated or removed to test the new HTML injection approach.

  test("initializes config from HTML injection", async () => {
    // Mock window.__INITIAL_CONFIG__
    (window as any).__INITIAL_CONFIG__ = {
      defaultEnvironment: { TEST_ENV: "test" },
      defaultCommand: "test-command",
      defaultArgs: ["test-arg1", "test-arg2"],
    };

    const mockConfig = {
      ...DEFAULT_INSPECTOR_CONFIG,
      MCP_INSPECTOR_API_TOKEN: {
        ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
        value: "test-api-token",
      },
    };

    mockInitializeInspectorConfig.mockReturnValue(mockConfig);

    render(<App />);

    // App should initialize without fetching /config endpoint
    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
