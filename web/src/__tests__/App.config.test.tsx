import type { Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { DEFAULT_INSPECTOR_CONFIG } from "../lib/constants";
import { InspectorConfig } from "../lib/configurationTypes";
import * as configUtils from "../utils/configUtils";

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
    getInspectorApiToken: vi.fn(
      (config: InspectorConfig) =>
        config.MCP_INSPECTOR_API_TOKEN?.value || undefined,
    ),
    initializeInspectorConfig: vi.fn(() => DEFAULT_INSPECTOR_CONFIG),
    saveInspectorConfig: vi.fn(),
  };
});

// Get references to the mocked functions
const mockInitializeInspectorConfig =
  configUtils.initializeInspectorConfig as Mock;

// Mock InspectorClient hook
vi.mock(
  "@modelcontextprotocol/inspector-core/react/useInspectorClient.js",
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
      appRendererClient: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  }),
);

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
global.fetch = vi.fn();

describe("App - Config Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          defaultEnvironment: { TEST_ENV: "test" },
          defaultCommand: "test-command",
          defaultArgs: ["test-arg1", "test-arg2"],
          defaultTransport: "stdio",
          defaultServerUrl: "",
          sandboxUrl: "http://localhost:12345/sandbox",
        }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  test("when /api/config includes sandboxUrl, app completes config gate and shows main UI", async () => {
    mockInitializeInspectorConfig.mockReturnValue({
      ...DEFAULT_INSPECTOR_CONFIG,
      MCP_INSPECTOR_API_TOKEN: {
        ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
        value: "token",
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(/Connect to an MCP server to start inspecting/i),
      ).toBeInTheDocument();
    });
  });
});
