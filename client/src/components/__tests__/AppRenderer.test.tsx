import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppRenderer from "../AppRenderer";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RequestHandlerExtra } from "@mcp-ui/client";
import { McpUiMessageResult } from "@modelcontextprotocol/ext-apps";

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

// Mock @mcp-ui/client
jest.mock("@mcp-ui/client", () => ({
  AppRenderer: ({
    toolName,
    onMessage,
  }: {
    toolName: string;
    onMessage?: (
      params: { role: "user"; content: { type: "text"; text: string }[] },
      extra: RequestHandlerExtra,
    ) => Promise<McpUiMessageResult>;
  }) => (
    <div data-testid="mcp-ui-app-renderer">
      <div data-testid="tool-name">{toolName}</div>
      <button
        data-testid="trigger-message"
        onClick={() =>
          onMessage?.(
            { role: "user", content: [{ type: "text", text: "Test message" }] },
            {} as RequestHandlerExtra,
          )
        }
      >
        Trigger Message
      </button>
    </div>
  ),
}));

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
    request: jest.fn(),
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
});
