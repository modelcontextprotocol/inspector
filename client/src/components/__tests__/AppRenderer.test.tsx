import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppRenderer from "../AppRenderer";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock the ext-apps module
jest.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  getToolUiResourceUri: (tool: Tool) => {
    const meta = (tool as Tool & { _meta?: { ui?: { resourceUri?: string } } })
      ._meta;
    return meta?.ui?.resourceUri || null;
  },
}));

// Mock @mcp-ui/client
jest.mock("@mcp-ui/client", () => ({
  AppRenderer: ({ toolName, html }: { toolName: string; html: string }) => (
    <div data-testid="mcp-ui-app-renderer">
      <div data-testid="tool-name">{toolName}</div>
      <div data-testid="html-content">{html}</div>
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
    tool: mockTool,
    mcpClient: mockMcpClient,
    onReadResource: jest.fn(),
    resourceContent: "",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should display waiting state when mcpClient is null", () => {
    render(<AppRenderer {...defaultProps} mcpClient={null} />);
    expect(screen.getByText(/Waiting for MCP client/i)).toBeInTheDocument();
  });

  it("should call onReadResource when resourceContent is empty", () => {
    const mockOnReadResource = jest.fn();
    render(
      <AppRenderer
        {...defaultProps}
        onReadResource={mockOnReadResource}
        resourceContent=""
      />,
    );

    expect(mockOnReadResource).toHaveBeenCalledWith("ui://test-app");
  });

  it("should display error when no resource URI is found", () => {
    const toolWithoutUri: Tool = {
      name: "noUriTool",
      description: "Tool without UI",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    };

    render(<AppRenderer {...defaultProps} tool={toolWithoutUri} />);

    expect(
      screen.getByText(/No UI resource URI found in tool metadata/i),
    ).toBeInTheDocument();
  });

  it("should render McpUiAppRenderer when client and resource are ready", () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    expect(screen.getByTestId("mcp-ui-app-renderer")).toBeInTheDocument();
    expect(screen.getByTestId("tool-name")).toHaveTextContent("testApp");
    expect(screen.getByTestId("html-content")).toHaveTextContent(
      "<html><body>Test</body></html>",
    );
  });

  it("should handle JSON resource content with MCP format", () => {
    const jsonContent = JSON.stringify({
      contents: [
        {
          uri: "ui://test-app",
          mimeType: "text/html",
          text: "<html><body>Test App</body></html>",
        },
      ],
    });

    render(<AppRenderer {...defaultProps} resourceContent={jsonContent} />);

    expect(screen.getByTestId("html-content")).toHaveTextContent(
      "<html><body>Test App</body></html>",
    );
  });

  it("should display error from JSON resource response", () => {
    const errorJson = JSON.stringify({
      error: "Failed to load resource",
    });

    render(<AppRenderer {...defaultProps} resourceContent={errorJson} />);

    expect(screen.getByText("Failed to load resource")).toBeInTheDocument();
  });

  it("should handle invalid JSON gracefully by using as-is", () => {
    const invalidJson = "{invalid json}";
    render(<AppRenderer {...defaultProps} resourceContent={invalidJson} />);

    expect(screen.getByTestId("html-content")).toHaveTextContent(
      "{invalid json}",
    );
  });

  it("should set minimum height on container", () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    const container = screen.getByTestId("mcp-ui-app-renderer").parentElement;
    expect(container).toHaveStyle({ minHeight: "400px" });
  });
});
