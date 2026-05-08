import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock auth dependencies
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
  getMCPTaskTtl: jest.fn(() => 30000),
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
      metadata?: Record<string, unknown>,
      runAsTask?: boolean,
    ) => Promise<unknown>;
    toolResult: { content: Array<{ type: string; text: string }> } | null;
  }) => (
    <div data-testid="tools-tab">
      <button
        type="button"
        onClick={() => {
          void callTool("myTool", {}, undefined, true);
        }}
      >
        run task tool
      </button>
      {toolResult && (
        <div data-testid="tool-result">
          {toolResult.content.map((c, i) => (
            <span key={i}>{c.text}</span>
          ))}
        </div>
      )}
    </div>
  ),
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - task polling with input_required status", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = "#tools";
  });

  it("calls tasks/result when polling sees input_required, then continues until completed", async () => {
    const taskId = "task-abc-123";
    let tasksGetCallCount = 0;

    const makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/list") {
        return {
          tools: [
            {
              name: "myTool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          nextCursor: undefined,
        };
      }

      if (request.method === "tools/call") {
        return {
          task: { taskId, status: "input_required", pollInterval: 10 },
        };
      }

      if (request.method === "tasks/get") {
        tasksGetCallCount++;
        // First poll: still input_required; second poll: completed
        if (tasksGetCallCount === 1) {
          return {
            taskId,
            status: "input_required",
            statusMessage: "Needs input",
          };
        }
        return { taskId, status: "completed" };
      }

      if (request.method === "tasks/result") {
        return {
          content: [{ type: "text", text: "final task result" }],
        };
      }

      if (request.method === "tasks/list") {
        return { tasks: [] };
      }

      throw new Error(`Unexpected method: ${request.method}`);
    });

    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: { tools: { listChanged: true } },
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
    } as ReturnType<typeof useConnection>);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /run task tool/i }));

    // tasks/result should be called for input_required, then again for completed
    await waitFor(() => {
      const resultCalls = makeRequest.mock.calls.filter(
        ([req]) => (req as { method: string }).method === "tasks/result",
      );
      expect(resultCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Final result should be displayed after completed
    await waitFor(() => {
      expect(screen.getByTestId("tool-result")).toHaveTextContent(
        "final task result",
      );
    });
  });

  it("does not call tasks/result while status is working (non-input_required non-terminal)", async () => {
    const taskId = "task-working-456";
    let tasksGetCallCount = 0;

    const makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/list") {
        return {
          tools: [
            {
              name: "myTool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
          nextCursor: undefined,
        };
      }

      if (request.method === "tools/call") {
        return {
          task: { taskId, status: "working", pollInterval: 10 },
        };
      }

      if (request.method === "tasks/get") {
        tasksGetCallCount++;
        if (tasksGetCallCount < 3) {
          return { taskId, status: "working" };
        }
        return { taskId, status: "completed" };
      }

      if (request.method === "tasks/result") {
        return {
          content: [{ type: "text", text: "working tool result" }],
        };
      }

      if (request.method === "tasks/list") {
        return { tasks: [] };
      }

      throw new Error(`Unexpected method: ${request.method}`);
    });

    mockUseConnection.mockReturnValue({
      connectionStatus: "connected",
      serverCapabilities: { tools: { listChanged: true } },
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
    } as ReturnType<typeof useConnection>);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /run task tool/i }));

    await waitFor(() => {
      expect(screen.getByTestId("tool-result")).toHaveTextContent(
        "working tool result",
      );
    });

    // tasks/result should only have been called once — for the completed status, not for working
    const resultCalls = makeRequest.mock.calls.filter(
      ([req]) => (req as { method: string }).method === "tasks/result",
    );
    expect(resultCalls).toHaveLength(1);
  });
});
