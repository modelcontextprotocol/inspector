import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppRenderer from "../AppRenderer";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RequestHandlerExtra } from "@mcp-ui/client";
import { McpUiMessageResult } from "@modelcontextprotocol/ext-apps";

type BridgeEvent = {
  type: "sendToolInput" | "sendToolResult";
  toolName: string;
  payload: unknown;
};

type MockMcpUiRendererProps = {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolResult?: CallToolResult;
  onMessage?: (
    params: { role: "user"; content: { type: "text"; text: string }[] },
    extra: RequestHandlerExtra,
  ) => Promise<McpUiMessageResult>;
};

const mockBridgeEvents: BridgeEvent[] = [];

// Mock the ext-apps module
jest.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  getToolUiResourceUri: (tool: Tool) => {
    const meta = (tool as Tool & { _meta?: { ui?: { resourceUri?: string } } })
      ._meta;
    return meta?.ui?.resourceUri || null;
  },
}));

// Mock toast hook
const mockToast = jest.fn();
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock @mcp-ui/client to simulate bridge delivery only after app initialization
jest.mock("@mcp-ui/client", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    AppRenderer: ({
      toolName,
      toolInput,
      toolResult,
      onMessage,
    }: MockMcpUiRendererProps) => {
      const [isInitialized, setIsInitialized] = React.useState(false);

      React.useEffect(() => {
        setIsInitialized(false);
      }, [toolName]);

      React.useEffect(() => {
        if (isInitialized && toolInput) {
          mockBridgeEvents.push({
            type: "sendToolInput",
            toolName,
            payload: toolInput,
          });
        }
      }, [isInitialized, toolInput, toolName]);

      React.useEffect(() => {
        if (isInitialized && toolResult) {
          mockBridgeEvents.push({
            type: "sendToolResult",
            toolName,
            payload: toolResult,
          });
        }
      }, [isInitialized, toolResult, toolName]);

      return (
        <div data-testid="mcp-ui-app-renderer">
          <div data-testid="tool-name">{toolName}</div>
          <div data-testid="tool-result">
            {JSON.stringify(toolResult ?? null)}
          </div>
          <button
            data-testid="initialize-app"
            onClick={() => setIsInitialized(true)}
          >
            Initialize App
          </button>
          <button
            data-testid="trigger-message"
            onClick={() =>
              onMessage?.(
                {
                  role: "user",
                  content: [{ type: "text", text: "Test message" }],
                },
                {} as RequestHandlerExtra,
              )
            }
          >
            Trigger Message
          </button>
        </div>
      );
    },
  };
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("AppRenderer", () => {
  const mockTool: Tool = {
    name: "testApp",
    description: "Test app with UI",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    _meta: {
      ui: {
        resourceUri: "ui://test-app",
      },
    },
  } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

  const mockMcpClient = {
    request: jest.fn(
      () =>
        new Promise<CallToolResult>(() => {
          // Intentionally unresolved for baseline rendering tests.
        }),
    ),
    getServerCapabilities: jest.fn().mockReturnValue({}),
    setNotificationHandler: jest.fn(),
  } as unknown as Client;

  const defaultProps = {
    sandboxPath: "/sandbox",
    tool: mockTool,
    mcpClient: mockMcpClient,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBridgeEvents.length = 0;
  });

  it("should display waiting state when mcpClient is null", () => {
    render(<AppRenderer {...defaultProps} mcpClient={null} />);
    expect(screen.getByText(/Waiting for MCP client/i)).toBeInTheDocument();
  });

  it("should render McpUiAppRenderer when client is ready", () => {
    render(<AppRenderer {...defaultProps} />);

    expect(screen.getByTestId("mcp-ui-app-renderer")).toBeInTheDocument();
    expect(screen.getByTestId("tool-name")).toHaveTextContent("testApp");
  });

  it("should set minimum height on container", () => {
    render(<AppRenderer {...defaultProps} />);

    const container = screen.getByTestId("mcp-ui-app-renderer").parentElement;
    expect(container).toHaveStyle({ minHeight: "400px" });
  });

  it("should show toast when onMessage is triggered", () => {
    render(<AppRenderer {...defaultProps} />);

    fireEvent.click(screen.getByTestId("trigger-message"));

    expect(mockToast).toHaveBeenCalledWith({
      description: "Test message",
    });
  });

  it("should call tools/call and send tool input/result after app initialization", async () => {
    const mockResult: CallToolResult = {
      content: [{ type: "text", text: "Budget initialized" }],
    };
    const requestMock = jest.fn().mockResolvedValue(mockResult);
    const mcpClient = {
      ...mockMcpClient,
      request: requestMock,
    } as unknown as Client;

    render(
      <AppRenderer
        {...defaultProps}
        mcpClient={mcpClient}
        toolInput={{ monthlyBudget: 2500 }}
      />,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        {
          method: "tools/call",
          params: {
            name: "testApp",
            arguments: { monthlyBudget: 2500 },
          },
        },
        expect.any(Object),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(mockBridgeEvents).toHaveLength(0);

    fireEvent.click(screen.getByTestId("initialize-app"));

    await waitFor(() => {
      const toolEvents = mockBridgeEvents.filter(
        (event) => event.toolName === "testApp",
      );
      expect(toolEvents.map((event) => event.type)).toEqual([
        "sendToolInput",
        "sendToolResult",
      ]);
    });

    const resultEvent = mockBridgeEvents.find(
      (event) =>
        event.toolName === "testApp" && event.type === "sendToolResult",
    );
    expect(resultEvent?.payload).toEqual(mockResult);
  });

  it("should send an app-consumable error result when tools/call fails", async () => {
    const requestMock = jest
      .fn()
      .mockRejectedValue(new Error("tool execution failed"));
    const mcpClient = {
      ...mockMcpClient,
      request: requestMock,
    } as unknown as Client;

    render(
      <AppRenderer {...defaultProps} mcpClient={mcpClient} toolInput={{}} />,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId("initialize-app"));

    await waitFor(() => {
      const resultEvent = mockBridgeEvents.find(
        (event) =>
          event.toolName === "testApp" && event.type === "sendToolResult",
      );

      expect(resultEvent?.payload).toEqual({
        content: [{ type: "text", text: "tool execution failed" }],
        isError: true,
      });
    });
  });

  it("should ignore stale tool results after switching app tools", async () => {
    const firstResult: CallToolResult = {
      content: [{ type: "text", text: "stale result" }],
    };
    const secondResult: CallToolResult = {
      content: [{ type: "text", text: "fresh result" }],
    };

    const firstRequest = createDeferred<CallToolResult>();
    const secondRequest = createDeferred<CallToolResult>();
    const requestMock = jest
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const mcpClient = {
      ...mockMcpClient,
      request: requestMock,
    } as unknown as Client;

    const { rerender } = render(
      <AppRenderer
        {...defaultProps}
        mcpClient={mcpClient}
        toolInput={{ month: "january" }}
      />,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    const secondTool = {
      ...mockTool,
      name: "budgetAllocatorApp",
    };

    rerender(
      <AppRenderer
        {...defaultProps}
        mcpClient={mcpClient}
        tool={secondTool}
        toolInput={{ month: "february" }}
      />,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(2);
    });

    secondRequest.resolve(secondResult);
    await waitFor(() => {
      expect(screen.getByTestId("tool-result")).toHaveTextContent(
        "fresh result",
      );
    });

    fireEvent.click(screen.getByTestId("initialize-app"));

    await waitFor(() => {
      const freshEvents = mockBridgeEvents.filter(
        (event) =>
          event.toolName === "budgetAllocatorApp" &&
          event.type === "sendToolResult",
      );
      expect(freshEvents).toHaveLength(1);
      expect(freshEvents[0].payload).toEqual(secondResult);
    });

    firstRequest.resolve(firstResult);
    await Promise.resolve();
    await Promise.resolve();

    const secondToolResultEvents = mockBridgeEvents.filter(
      (event) =>
        event.toolName === "budgetAllocatorApp" &&
        event.type === "sendToolResult",
    );

    expect(secondToolResultEvents).toHaveLength(1);
    expect(secondToolResultEvents[0].payload).toEqual(secondResult);
    expect(screen.getByTestId("tool-result")).toHaveTextContent("fresh result");
  });
});
