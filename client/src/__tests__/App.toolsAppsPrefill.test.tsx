import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

type ToolListEntry = {
  name: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
  };
  _meta: Record<string, unknown>;
};

type AppsTabProps = {
  tools: ToolListEntry[];
  prefilledToolCall?: {
    id: number;
    toolName: string;
    params: Record<string, unknown>;
    result: {
      content: Array<{ type: string; text: string }>;
    };
  } | null;
  onPrefilledToolCallConsumed?: (callId: number) => void;
};

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
    callTool,
  }: {
    listTools: () => void;
    callTool: (
      name: string,
      params: Record<string, unknown>,
      metadata?: Record<string, unknown>,
      runAsTask?: boolean,
    ) => Promise<unknown>;
  }) => (
    <div data-testid="tools-tab">
      <button type="button" onClick={listTools}>
        mock list tools
      </button>
      <button
        type="button"
        onClick={() => {
          void callTool("weatherApp", { city: "Lisbon" });
        }}
      >
        mock run app tool
      </button>
    </div>
  ),
}));

jest.mock("../components/AppsTab", () => ({
  __esModule: true,
  default: (props: AppsTabProps) => {
    const prefilled =
      props && "prefilledToolCall" in props ? props.prefilledToolCall : null;
    const tools = props && "tools" in props ? props.tools : [];

    return (
      <div data-testid="apps-tab">
        <div data-testid="apps-tools">{JSON.stringify(tools)}</div>
        <div data-testid="apps-prefilled">
          {JSON.stringify(prefilled ?? null)}
        </div>
        {prefilled && (
          <button
            type="button"
            onClick={() => props?.onPrefilledToolCallConsumed?.(prefilled.id)}
          >
            consume prefilled
          </button>
        )}
      </div>
    );
  },
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - Tools to Apps prefilled handoff", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = "#tools";
  });

  it("passes prefilled call data to AppsTab for tools using _meta['ui/resourceUri']", async () => {
    const makeRequest = jest.fn(async (request: { method: string }) => {
      if (request.method === "tools/list") {
        return {
          tools: [
            {
              name: "weatherApp",
              inputSchema: {
                type: "object",
                properties: {
                  city: { type: "string" },
                },
              },
              _meta: {
                "ui/resourceUri": "ui://weather-app",
              },
            },
          ],
          nextCursor: undefined,
        };
      }

      if (request.method === "tools/call") {
        return {
          content: [{ type: "text", text: "weather result" }],
        };
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

    fireEvent.click(screen.getByRole("button", { name: /mock list tools/i }));

    await waitFor(() => {
      const tools = JSON.parse(
        screen.getByTestId("apps-tools").textContent || "[]",
      );
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("weatherApp");
    });

    fireEvent.click(screen.getByRole("button", { name: /mock run app tool/i }));

    await waitFor(() => {
      const prefilled = JSON.parse(
        screen.getByTestId("apps-prefilled").textContent || "null",
      );
      expect(prefilled.toolName).toBe("weatherApp");
      expect(prefilled.params).toEqual({ city: "Lisbon" });
      expect(prefilled.result.content[0].text).toBe("weather result");
    });

    fireEvent.click(screen.getByRole("button", { name: /consume prefilled/i }));

    await waitFor(() => {
      expect(screen.getByTestId("apps-prefilled")).toHaveTextContent("null");
    });
  });
});
