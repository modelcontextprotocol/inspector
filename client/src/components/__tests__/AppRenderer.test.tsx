import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppRenderer from "../AppRenderer";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock the ext-apps module
jest.mock("@modelcontextprotocol/ext-apps/app-bridge", () => {
  class MockAppBridge {
    oninitialized: (() => void) | null = null;
    onerror: ((error: Error) => void) | null = null;

    async connect() {
      // Simulate successful connection
      setTimeout(() => {
        if (this.oninitialized) {
          this.oninitialized();
        }
      }, 0);
    }

    async close() {
      // Mock close
    }
  }

  class MockPostMessageTransport {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_source: Window | null, _target: Window | null) {
      // Mock constructor
    }
  }

  return {
    AppBridge: MockAppBridge,
    PostMessageTransport: MockPostMessageTransport,
    getToolUiResourceUri: (tool: Tool) => {
      const meta = (
        tool as Tool & { _meta?: { ui?: { resourceUri?: string } } }
      )._meta;
      return meta?.ui?.resourceUri || null;
    },
    buildAllowAttribute: (permissions?: Record<string, unknown>) => {
      return permissions ? "custom-permissions" : "";
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
    request: jest.fn(),
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

  it("should display loading state initially", () => {
    render(<AppRenderer {...defaultProps} />);

    expect(screen.getByText(/Loading MCP App/i)).toBeInTheDocument();
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

  it("should not call onReadResource when resourceContent is provided", () => {
    const mockOnReadResource = jest.fn();
    render(
      <AppRenderer
        {...defaultProps}
        onReadResource={mockOnReadResource}
        resourceContent="<html>test</html>"
      />,
    );

    expect(mockOnReadResource).not.toHaveBeenCalled();
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

    expect(screen.getByText(/No UI resource URI found/i)).toBeInTheDocument();
  });

  it("should render iframe with proper attributes", async () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        "sandbox",
        "allow-scripts allow-same-origin",
      );
      expect(iframe).toHaveAttribute("title", "MCP App: testApp");
    });
  });

  it("should display initialized message when app connects", async () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/App connected/i)).toBeInTheDocument();
      expect(screen.getByText(/testApp/)).toBeInTheDocument();
    });
  });

  it("should handle JSON resource content with MCP format", async () => {
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

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });

  it("should handle plain HTML resource content", async () => {
    const htmlContent = "<html><body>Plain HTML</body></html>";

    render(<AppRenderer {...defaultProps} resourceContent={htmlContent} />);

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });

  it("should apply custom permissions to iframe", async () => {
    const toolWithPermissions: Tool = {
      ...mockTool,
      _meta: {
        ui: {
          resourceUri: "ui://test-app",
          permissions: {
            camera: true,
            microphone: true,
          },
        },
      },
    } as Tool & {
      _meta?: {
        ui?: { resourceUri?: string; permissions?: Record<string, unknown> };
      };
    };

    render(
      <AppRenderer
        {...defaultProps}
        tool={toolWithPermissions}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toHaveAttribute("allow", "custom-permissions");
    });
  });

  it("should update when resourceContent changes", async () => {
    const { rerender } = render(
      <AppRenderer {...defaultProps} resourceContent="" />,
    );

    expect(screen.getByText(/Loading MCP App/i)).toBeInTheDocument();

    // Update with content
    rerender(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Updated</body></html>"
      />,
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });

  it("should cleanup on unmount", async () => {
    const { unmount } = render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/App connected/i)).toBeInTheDocument();
    });

    // Unmount should not throw errors
    unmount();
  });

  it("should handle missing contentWindow gracefully", () => {
    // This test verifies that the component handles edge cases
    // The actual error handling is tested through the error display
    render(
      <AppRenderer
        {...defaultProps}
        mcpClient={null}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    // Should still show loading state
    expect(screen.getByText(/Loading MCP App/i)).toBeInTheDocument();
  });

  it("should set minimum height on iframe", async () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toHaveStyle({ minHeight: "400px" });
    });
  });

  it("should have proper styling classes on iframe", async () => {
    render(
      <AppRenderer
        {...defaultProps}
        resourceContent="<html><body>Test</body></html>"
      />,
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toHaveClass("w-full", "flex-1", "border", "rounded");
    });
  });

  it("should handle JSON parsing errors gracefully", async () => {
    const invalidJson = "{invalid json content}";

    render(<AppRenderer {...defaultProps} resourceContent={invalidJson} />);

    // Should still attempt to render as HTML
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });

  it("should handle empty contents array in JSON response", async () => {
    const jsonContent = JSON.stringify({
      contents: [],
    });

    render(<AppRenderer {...defaultProps} resourceContent={jsonContent} />);

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });

  it("should extract text from first text content in MCP response", async () => {
    const jsonContent = JSON.stringify({
      contents: [
        {
          uri: "ui://test-app",
          mimeType: "application/json",
          text: '{"data": "not html"}',
        },
        {
          uri: "ui://test-app",
          mimeType: "text/html",
          text: "<html><body>Actual HTML</body></html>",
        },
      ],
    });

    render(<AppRenderer {...defaultProps} resourceContent={jsonContent} />);

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeInTheDocument();
    });
  });
});
