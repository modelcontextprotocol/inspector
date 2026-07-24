import { render, waitFor } from "@testing-library/react";
import App from "../App";
import { DEFAULT_INSPECTOR_CONFIG } from "../lib/constants";
import { InspectorConfig } from "../lib/configurationTypes";
import * as configUtils from "../utils/configUtils";

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

// Mock the config utils — keep the real implementations but allow overriding
jest.mock("../utils/configUtils", () => ({
  ...jest.requireActual("../utils/configUtils"),
  getMCPProxyAddress: jest.fn(() => "http://localhost:6277"),
  getMCPProxyAuthToken: jest.fn((config: InspectorConfig) => ({
    token: config.MCP_PROXY_AUTH_TOKEN.value,
    header: "X-MCP-Proxy-Auth",
  })),
  getInitialTransportType: jest.fn(() => "stdio"),
  getInitialSseUrl: jest.fn(() => "http://localhost:3001/sse"),
  getInitialCommand: jest.fn(() => "mcp-server-everything"),
  getInitialArgs: jest.fn(() => ""),
  initializeInspectorConfig: jest.fn(() => DEFAULT_INSPECTOR_CONFIG),
  saveInspectorConfig: jest.fn(),
  getAutoConnect: jest.fn(() => false),
  stripAutoConnectParam: jest.fn(),
}));

const mockGetAutoConnect = configUtils.getAutoConnect as jest.Mock;
const mockStripAutoConnectParam =
  configUtils.stripAutoConnectParam as jest.Mock;

// Mock useConnection to capture the connect function
const mockConnect = jest.fn();
jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: () => ({
    connectionStatus: "disconnected",
    serverCapabilities: null,
    mcpClient: null,
    requestHistory: [],
    clearRequestHistory: jest.fn(),
    makeRequest: jest.fn(),
    sendNotification: jest.fn(),
    handleCompletion: jest.fn(),
    completionsSupported: false,
    connect: mockConnect,
    disconnect: jest.fn(),
  }),
}));

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
global.fetch = jest.fn().mockResolvedValue({
  json: () => Promise.resolve({}),
});

describe("App - autoConnect query param", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({}),
    });
  });

  test("calls connectMcpServer on mount when autoConnect=true", async () => {
    mockGetAutoConnect.mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  test("strips autoConnect param from URL after consuming it", async () => {
    mockGetAutoConnect.mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
      expect(mockStripAutoConnectParam).toHaveBeenCalledTimes(1);
    });
  });

  test("does not call connectMcpServer when autoConnect is not set", async () => {
    mockGetAutoConnect.mockReturnValue(false);

    render(<App />);

    // Wait for initial render effects to settle
    await waitFor(() => {
      expect(mockGetAutoConnect).toHaveBeenCalled();
    });

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockStripAutoConnectParam).not.toHaveBeenCalled();
  });
});
