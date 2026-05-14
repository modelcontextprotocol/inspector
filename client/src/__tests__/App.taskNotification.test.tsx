import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Notification } from "../lib/notificationTypes";

type OnNotificationHandler = (notification: Notification) => void;

type UseConnectionReturn = ReturnType<typeof useConnection>;

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
  getMCPTaskTtl: jest.fn(() => 300000),
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
    callTool,
  }: {
    callTool: (
      name: string,
      params: Record<string, unknown>,
      metadata?: Record<string, unknown>,
      runAsTask?: boolean,
    ) => Promise<unknown>;
  }) => (
    <div data-testid="tools-tab">
      <button
        type="button"
        onClick={() => {
          void callTool("longRunningTool", {}, undefined, true);
        }}
      >
        run as task
      </button>
    </div>
  ),
}));

jest.mock("../components/AppsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="apps-tab">AppsTab</div>,
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - task completion notification wakes polling loop", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = "#tools";
  });

  it("calls tasks/get immediately when a terminal task notification arrives, without waiting for pollInterval", async () => {
    const TASK_ID = "task-abc-123";
    // Use a long poll interval (longer than waitFor's 1 s timeout) to ensure
    // the test would fail if the notification is not handled promptly.
    const POLL_INTERVAL = 10_000;

    let capturedOnNotification: OnNotificationHandler | undefined;

    const makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/call") {
        return {
          task: {
            taskId: TASK_ID,
            status: "running",
            pollInterval: POLL_INTERVAL,
          },
        };
      }
      if (request.method === "tasks/get") {
        return { taskId: TASK_ID, status: "completed" };
      }
      if (request.method === "tasks/result") {
        return {
          content: [{ type: "text", text: "task result" }],
        };
      }
      throw new Error(`Unexpected method: ${request.method}`);
    });

    mockUseConnection.mockImplementation((options) => {
      capturedOnNotification = (
        options as { onNotification?: OnNotificationHandler }
      ).onNotification;
      return {
        connectionStatus: "connected",
        serverCapabilities: { tools: { listChanged: true }, tasks: true },
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
        listTasks: jest
          .fn()
          .mockResolvedValue({ tasks: [], nextCursor: undefined }),
        sendNotification: jest.fn(),
        handleCompletion: jest.fn(),
        completionsSupported: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as UseConnectionReturn;
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("tools-tab")).toBeInTheDocument();
    });

    // Start the task-based tool call (not awaited – it blocks on the polling loop)
    fireEvent.click(screen.getByRole("button", { name: /run as task/i }));

    // Let the initial tools/call request complete
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/call" }),
        expect.anything(),
      );
    });

    // The polling loop is now waiting on Promise.race([timer(10000), notification]).
    // Fire a terminal status notification for the task.  The fix makes this
    // resolve the race immediately so tasks/get is called without waiting 10 s.
    act(() => {
      if (!capturedOnNotification) {
        throw new Error("Expected onNotification to be captured");
      }
      capturedOnNotification({
        method: "notifications/tasks/status",
        params: {
          taskId: TASK_ID,
          status: "completed",
        },
      } as unknown as Notification);
    });

    // tasks/get must be called promptly (waitFor defaults to 1 s, which is
    // well under the 10 s poll interval – so this would time out without the fix).
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tasks/get" }),
        expect.anything(),
      );
    });

    // The final result must be fetched via tasks/result
    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tasks/result" }),
        expect.anything(),
      );
    });
  });

  it("does not wake the polling loop for a notification about a different task", async () => {
    const TASK_ID = "task-abc-123";
    const OTHER_TASK_ID = "task-xyz-999";
    const POLL_INTERVAL = 100; // short so the test completes quickly

    let capturedOnNotification: OnNotificationHandler | undefined;

    const makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/call") {
        return {
          task: {
            taskId: TASK_ID,
            status: "running",
            pollInterval: POLL_INTERVAL,
          },
        };
      }
      if (request.method === "tasks/get") {
        return { taskId: TASK_ID, status: "completed" };
      }
      if (request.method === "tasks/result") {
        return {
          content: [{ type: "text", text: "task result" }],
        };
      }
      throw new Error(`Unexpected method: ${request.method}`);
    });

    mockUseConnection.mockImplementation((options) => {
      capturedOnNotification = (
        options as { onNotification?: OnNotificationHandler }
      ).onNotification;
      return {
        connectionStatus: "connected",
        serverCapabilities: { tools: { listChanged: true }, tasks: true },
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
        listTasks: jest
          .fn()
          .mockResolvedValue({ tasks: [], nextCursor: undefined }),
        sendNotification: jest.fn(),
        handleCompletion: jest.fn(),
        completionsSupported: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as UseConnectionReturn;
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("tools-tab")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /run as task/i }));

    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/call" }),
        expect.anything(),
      );
    });

    // Fire a notification for a DIFFERENT task — should not affect polling for TASK_ID
    act(() => {
      if (!capturedOnNotification) {
        throw new Error("Expected onNotification to be captured");
      }
      capturedOnNotification({
        method: "notifications/tasks/status",
        params: {
          taskId: OTHER_TASK_ID,
          status: "completed",
        },
      } as unknown as Notification);
    });

    // The loop should still complete normally (via its own poll interval)
    await waitFor(
      () => {
        expect(makeRequest).toHaveBeenCalledWith(
          expect.objectContaining({ method: "tasks/get" }),
          expect.anything(),
        );
      },
      { timeout: 3000 },
    );
  });
});
