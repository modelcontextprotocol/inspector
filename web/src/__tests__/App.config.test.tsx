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
  getInspectorApiToken: jest.fn(
    (config: InspectorConfig) =>
      config.MCP_INSPECTOR_API_TOKEN?.value || undefined,
  ),
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
      ok: true,
      json: () =>
        Promise.resolve({
          defaultEnvironment: { TEST_ENV: "test" },
          defaultCommand: "test-command",
          defaultArgs: ["test-arg1", "test-arg2"],
          defaultTransport: "stdio",
          defaultServerUrl: "",
        }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("fetches /api/config when API token is present and applies response", async () => {
    const mockConfig = {
      ...DEFAULT_INSPECTOR_CONFIG,
      MCP_INSPECTOR_API_TOKEN: {
        ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
        value: "test-api-token",
      },
    };

    mockInitializeInspectorConfig.mockReturnValue(mockConfig);

    render(<App />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/config"),
        expect.objectContaining({
          headers: {
            "x-mcp-remote-auth": "Bearer test-api-token",
          },
        }),
      );
    });
  });
});
