import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach, afterEach } from "@jest/globals";
import AppRenderer from "../AppRenderer";
import {
  Tool,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
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
  toolResult?: CompatibilityCallToolResult;
  onMessage?: (
    params: { role: "user"; content: { type: "text"; text: string }[] },
    extra: RequestHandlerExtra,
  ) => Promise<McpUiMessageResult>;
  onOpenLink?: (params: { url: string }) => Promise<{ isError: boolean }>;
};

let capturedOnOpenLink: MockMcpUiRendererProps["onOpenLink"];

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
      onOpenLink,
    }: MockMcpUiRendererProps) => {
      capturedOnOpenLink = onOpenLink;
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
    getServerCapabilities: jest.fn().mockReturnValue({}),
    setNotificationHandler: jest.fn(),
  } as unknown as Client;

  const defaultProps = {
    sandboxPath: "/sandbox",
    tool: mockTool,
    mcpClient: mockMcpClient,
    toolResult: null,
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

  it("should send provided tool input and tool result after app initialization", async () => {
    const result: CompatibilityCallToolResult = {
      content: [{ type: "text", text: "Budget initialized" }],
    };

    render(
      <AppRenderer
        {...defaultProps}
        toolInput={{ monthlyBudget: 2500 }}
        toolResult={result}
      />,
    );

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
    expect(resultEvent?.payload).toEqual(result);
  });

  it("should not send tool result event when toolResult is null", async () => {
    render(
      <AppRenderer
        {...defaultProps}
        toolInput={{ monthlyBudget: 2500 }}
        toolResult={null}
      />,
    );

    fireEvent.click(screen.getByTestId("initialize-app"));

    await waitFor(() => {
      const inputEvents = mockBridgeEvents.filter(
        (event) =>
          event.toolName === "testApp" && event.type === "sendToolInput",
      );
      expect(inputEvents).toHaveLength(1);
    });

    const resultEvents = mockBridgeEvents.filter(
      (event) =>
        event.toolName === "testApp" && event.type === "sendToolResult",
    );
    expect(resultEvents).toHaveLength(0);
  });

  it("should normalize compatibility wrapper tool results before sending", async () => {
    const wrappedResult = {
      toolResult: {
        content: [{ type: "text", text: "Wrapped result payload" }],
      },
    } as CompatibilityCallToolResult;

    render(
      <AppRenderer
        {...defaultProps}
        toolInput={{ monthlyBudget: 2500 }}
        toolResult={wrappedResult}
      />,
    );

    fireEvent.click(screen.getByTestId("initialize-app"));

    await waitFor(() => {
      const resultEvent = mockBridgeEvents.find(
        (event) =>
          event.toolName === "testApp" && event.type === "sendToolResult",
      );
      expect(resultEvent).toBeTruthy();
      expect(resultEvent?.payload).toEqual(wrappedResult.toolResult);
    });
  });

  describe("open link requests", () => {
    let openSpy: jest.SpiedFunction<typeof window.open>;

    beforeEach(() => {
      openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    });

    afterEach(() => {
      openSpy.mockRestore();
    });

    it("opens http(s) links in a new tab with noopener and noreferrer", async () => {
      render(<AppRenderer {...defaultProps} />);

      const result = await capturedOnOpenLink?.({
        url: "https://example.com/path?q=1",
      });

      expect(result).toEqual({ isError: false });
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(
        "https://example.com/path?q=1",
        "_blank",
        "noopener,noreferrer",
      );
    });

    it.each([
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<p>hi</p>",
      "file:///etc/passwd",
      "/relative/path",
      "not a url",
      "",
    ])("refuses to open %p", async (url) => {
      render(<AppRenderer {...defaultProps} />);

      const result = await capturedOnOpenLink?.({ url });

      expect(result).toEqual({ isError: true });
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
