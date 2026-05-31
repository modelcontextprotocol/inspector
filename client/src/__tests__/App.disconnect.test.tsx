import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

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

jest.mock("../components/ResourcesTab", () => ({
  __esModule: true,
  default: () => <div>ResourcesTab</div>,
}));

jest.mock("../components/PromptsTab", () => ({
  __esModule: true,
  default: () => <div>PromptsTab</div>,
}));

jest.mock("../components/TasksTab", () => ({
  __esModule: true,
  default: () => <div>TasksTab</div>,
}));

jest.mock("../components/ConsoleTab", () => ({
  __esModule: true,
  default: () => <div>ConsoleTab</div>,
}));

jest.mock("../components/PingTab", () => ({
  __esModule: true,
  default: () => <div>PingTab</div>,
}));

jest.mock("../components/SamplingTab", () => ({
  __esModule: true,
  default: () => <div>SamplingTab</div>,
}));

jest.mock("../components/RootsTab", () => ({
  __esModule: true,
  default: () => <div>RootsTab</div>,
}));

jest.mock("../components/ElicitationTab", () => ({
  __esModule: true,
  default: () => <div>ElicitationTab</div>,
}));

jest.mock("../components/MetadataTab", () => ({
  __esModule: true,
  default: () => <div>MetadataTab</div>,
}));

jest.mock("../components/AuthDebugger", () => ({
  __esModule: true,
  default: () => <div>AuthDebugger</div>,
}));

jest.mock("../components/HistoryAndNotifications", () => ({
  __esModule: true,
  default: () => <div>HistoryAndNotifications</div>,
}));

jest.mock("../components/AppsTab", () => ({
  __esModule: true,
  default: () => <div>AppsTab</div>,
}));

jest.mock("../components/ToolsTab", () => ({
  __esModule: true,
  default: ({
    callTool,
    toolResult,
  }: {
    callTool: (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;
    toolResult: unknown;
  }) => (
    <div data-testid="tools-tab">
      <button
        type="button"
        onClick={() => void callTool("echo", { message: "hello" })}
      >
        run tool
      </button>
      {toolResult && (
        <div data-testid="tool-result">{JSON.stringify(toolResult)}</div>
      )}
    </div>
  ),
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

const mockClient = {
  request: jest.fn(),
  notification: jest.fn(),
  close: jest.fn(),
} as unknown as Client;

const makeRequest = jest.fn(async (request: { method: string }) => {
  if (request.method === "tools/list") {
    return {
      tools: [
        { name: "echo", inputSchema: { type: "object", properties: {} } },
      ],
      nextCursor: undefined,
    };
  }
  if (request.method === "tools/call") {
    return { content: [{ type: "text", text: "echo result" }] };
  }
  throw new Error(`Unexpected method: ${request.method}`);
});

const connectedState = {
  connectionStatus: "connected" as const,
  serverCapabilities: { tools: { listChanged: true } },
  serverImplementation: null,
  mcpClient: mockClient,
  requestHistory: [],
  clearRequestHistory: jest.fn(),
  makeRequest,
  cancelTask: jest.fn(),
  listTasks: jest.fn(),
  sendNotification: jest.fn(),
  handleCompletion: jest.fn(),
  completionsSupported: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
} as ReturnType<typeof useConnection>;

const disconnectedState = {
  ...connectedState,
  connectionStatus: "disconnected" as const,
  serverCapabilities: null,
  mcpClient: null,
};

describe("App - session state cleared on disconnect", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = "#tools";
  });

  it("clears tool result panel when connection is disconnected", async () => {
    mockUseConnection.mockReturnValue(connectedState);

    const { rerender } = render(<App />);

    // Trigger a tool call to populate toolResult
    fireEvent.click(screen.getByRole("button", { name: /run tool/i }));

    // Verify the result is shown
    await waitFor(() => {
      expect(screen.getByTestId("tool-result")).toBeInTheDocument();
    });

    // Simulate disconnect
    mockUseConnection.mockReturnValue(disconnectedState);
    rerender(<App />);

    // Result panel should be cleared
    await waitFor(() => {
      expect(screen.queryByTestId("tool-result")).not.toBeInTheDocument();
    });
  });
});
