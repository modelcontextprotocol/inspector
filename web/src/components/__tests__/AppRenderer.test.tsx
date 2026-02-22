import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, vi } from "vitest";
import AppRenderer from "../AppRenderer";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AppRendererClient } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import type { RequestHandlerExtra } from "@mcp-ui/client";
import type { McpUiMessageResult } from "@modelcontextprotocol/ext-apps/app-bridge";

const mockToast = vi.fn();
vi.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@mcp-ui/client", () => ({
  AppRenderer: ({
    toolName,
    toolResult,
    onMessage,
  }: {
    toolName: string;
    toolResult?: unknown;
    onMessage?: (
      params: { role: "user"; content: { type: "text"; text: string }[] },
      extra: RequestHandlerExtra,
    ) => Promise<McpUiMessageResult>;
  }) => (
    <div data-testid="mcp-ui-app-renderer">
      <div data-testid="tool-name">{toolName}</div>
      {toolResult !== undefined && <div data-testid="tool-result-received" />}
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
      type: "object",
      properties: {},
    },
    _meta: {
      ui: {
        resourceUri: "ui://test-app",
      },
    },
  } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

  const mockCallTool = vi.fn().mockResolvedValue({ content: [] });
  const mockClient = {
    callTool: mockCallTool,
    request: vi.fn(),
    getServerCapabilities: vi.fn().mockReturnValue({}),
    setNotificationHandler: vi.fn(),
  } as unknown as AppRendererClient;

  const defaultProps = {
    sandboxPath: "/sandbox",
    tool: mockTool,
    appRendererClient: mockClient,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallTool.mockResolvedValue({ content: [] });
  });

  it("should display waiting state when appRendererClient is null", () => {
    render(<AppRenderer {...defaultProps} appRendererClient={null} />);
    expect(screen.getByText(/Waiting for MCP client/i)).toBeInTheDocument();
  });

  it("should render McpUiAppRenderer when client is ready", async () => {
    render(<AppRenderer {...defaultProps} />);

    await screen.findByTestId("tool-result-received");

    expect(screen.getByTestId("mcp-ui-app-renderer")).toBeInTheDocument();
    expect(screen.getByTestId("tool-name")).toHaveTextContent("testApp");
  });

  it("should set minimum height on container", async () => {
    render(<AppRenderer {...defaultProps} />);

    await screen.findByTestId("tool-result-received");

    const container = screen.getByTestId("mcp-ui-app-renderer").parentElement;
    expect(container).toHaveStyle({ minHeight: "400px" });
  });

  it("should show toast when onMessage is triggered", async () => {
    render(<AppRenderer {...defaultProps} />);

    await screen.findByTestId("tool-result-received");

    fireEvent.click(screen.getByTestId("trigger-message"));

    expect(mockToast).toHaveBeenCalledWith({
      description: "Test message",
    });
  });

  it("should call tools/call when mounted with tool and toolInput", async () => {
    render(<AppRenderer {...defaultProps} toolInput={{ key: "value" }} />);

    await screen.findByTestId("tool-result-received");

    expect(mockCallTool).toHaveBeenCalledWith({
      name: "testApp",
      arguments: { key: "value" },
    });
  });
});
