import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";

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

jest.mock("../components/ToolsTab", () => ({
  __esModule: true,
  default: ({
    listTools,
    tools,
  }: {
    listTools: () => void;
    tools: Array<{ name: string }>;
  }) => (
    <div data-testid="tools-tab">
      <button type="button" onClick={listTools}>
        mock list tools
      </button>
      <div data-testid="tools-list">{JSON.stringify(tools)}</div>
    </div>
  ),
}));

jest.mock("../components/AppsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="apps-tab">AppsTab</div>,
}));

global.fetch = jest.fn().mockResolvedValue({
  json: () => Promise.resolve({}),
});

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - list_changed notification handling", () => {
  const mockUseConnection = jest.mocked(useConnection);
  let capturedOnNotification: ((notification: Notification) => void) | null =
    null;
  let makeRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnNotification = null;
    window.location.hash = "#tools";

    makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/list") {
        return {
          tools: [
            {
              name: "testTool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          nextCursor: undefined,
        };
      }
      if (request.method === "resources/list") {
        return { resources: [], nextCursor: undefined };
      }
      if (request.method === "resources/templates/list") {
        return { resourceTemplates: [], nextCursor: undefined };
      }
      if (request.method === "prompts/list") {
        return { prompts: [], nextCursor: undefined };
      }
      throw new Error(`Unexpected method: ${request.method}`);
    });

    mockUseConnection.mockImplementation((options) => {
      // Capture the onNotification callback passed by App
      if (options.onNotification) {
        capturedOnNotification = options.onNotification;
      }

      return {
        connectionStatus: "connected",
        serverCapabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
        serverImplementation: null,
        mcpClient: {
          request: jest.fn(),
          notification: jest.fn(),
          close: jest.fn(),
        } as unknown as Client,
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
    });
  });

  it("refreshes tools list when notifications/tools/list_changed is received", async () => {
    render(<App />);

    // First, load tools via the UI button
    fireEvent.click(screen.getByRole("button", { name: /mock list tools/i }));

    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/list" }),
        expect.anything(),
      );
    });

    // Clear call history to track the re-fetch
    makeRequest.mockClear();

    // Simulate receiving a tools/list_changed notification
    expect(capturedOnNotification).not.toBeNull();
    act(() => {
      capturedOnNotification!({
        method: "notifications/tools/list_changed",
      } as Notification);
    });

    // Verify that tools/list was re-fetched
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/list" }),
        expect.anything(),
      );
    });
  });

  it("refreshes resources when notifications/resources/list_changed is received", async () => {
    render(<App />);

    expect(capturedOnNotification).not.toBeNull();

    act(() => {
      capturedOnNotification!({
        method: "notifications/resources/list_changed",
      } as Notification);
    });

    // Verify that both resources/list and resources/templates/list are re-fetched
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "resources/list" }),
        expect.anything(),
      );
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "resources/templates/list" }),
        expect.anything(),
      );
    });
  });

  it("refreshes prompts when notifications/prompts/list_changed is received", async () => {
    render(<App />);

    expect(capturedOnNotification).not.toBeNull();

    act(() => {
      capturedOnNotification!({
        method: "notifications/prompts/list_changed",
      } as Notification);
    });

    // Verify that prompts/list was re-fetched
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "prompts/list" }),
        expect.anything(),
      );
    });
  });
});
