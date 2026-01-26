import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppsTab from "../AppsTab";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Tabs } from "../ui/tabs";

// Mock AppRenderer component
jest.mock("../AppRenderer", () => {
  return function MockAppRenderer({
    tool,
    resourceContent,
  }: {
    tool: Tool;
    resourceContent: string;
  }) {
    return (
      <div data-testid="app-renderer">
        <div>Tool: {tool.name}</div>
        <div>Content: {resourceContent || "No content"}</div>
      </div>
    );
  };
});

describe("AppsTab", () => {
  const mockAppTool: Tool = {
    name: "weatherApp",
    description: "Weather app with UI",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    _meta: {
      ui: {
        resourceUri: "ui://weather-app",
      },
    },
  } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

  const mockRegularTool: Tool = {
    name: "regularTool",
    description: "Regular tool without UI",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  };

  const defaultProps = {
    tools: [],
    listTools: jest.fn(),
    error: null,
    mcpClient: null,
    onReadResource: jest.fn(),
    resourceContentMap: {},
  };

  const renderAppsTab = (props = {}) => {
    return render(
      <Tabs defaultValue="apps">
        <AppsTab {...defaultProps} {...props} />
      </Tabs>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should display message when no apps are available", () => {
    renderAppsTab();

    expect(screen.getByText(/No MCP Apps available/i)).toBeInTheDocument();
    expect(screen.getByText(/_meta\.ui\.resourceUri/)).toBeInTheDocument();
  });

  it("should filter and display only tools with UI metadata", () => {
    renderAppsTab({
      tools: [mockAppTool, mockRegularTool],
    });

    // Should show the app tool
    expect(screen.getByText("weatherApp")).toBeInTheDocument();
    expect(screen.getByText("Weather app with UI")).toBeInTheDocument();
    expect(screen.getByText("ui://weather-app")).toBeInTheDocument();

    // Should not show the regular tool
    expect(screen.queryByText("regularTool")).not.toBeInTheDocument();
  });

  it("should display multiple app tools in a grid", () => {
    const mockAppTool2: Tool = {
      name: "calendarApp",
      description: "Calendar app with UI",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      _meta: {
        ui: {
          resourceUri: "ui://calendar-app",
        },
      },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [mockAppTool, mockAppTool2],
    });

    expect(screen.getByText("weatherApp")).toBeInTheDocument();
    expect(screen.getByText("calendarApp")).toBeInTheDocument();
  });

  it("should call listTools when refresh button is clicked", () => {
    const mockListTools = jest.fn();
    renderAppsTab({
      tools: [mockAppTool],
      listTools: mockListTools,
    });

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);

    expect(mockListTools).toHaveBeenCalledTimes(1);
  });

  it("should display error message when error prop is provided", () => {
    const errorMessage = "Failed to fetch tools";
    renderAppsTab({
      error: errorMessage,
    });

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it("should open app renderer when an app card is clicked", () => {
    renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: { "ui://weather-app": "<html>test</html>" },
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    expect(appCard).toBeTruthy();
    fireEvent.click(appCard!);

    // AppRenderer should be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Tool: weatherApp")).toBeInTheDocument();
  });

  it("should close app renderer when close button is clicked", () => {
    renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: { "ui://weather-app": "<html>test</html>" },
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Close the app
    const closeButton = screen.getByRole("button", { name: "" }); // X button has no text
    fireEvent.click(closeButton);

    // AppRenderer should be removed
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should pass resourceContent to AppRenderer", () => {
    const resourceContent = "<html><body>Weather App UI</body></html>";
    renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: { "ui://weather-app": resourceContent },
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText(`Content: ${resourceContent}`)).toBeInTheDocument();
  });

  it("should handle tool without description", () => {
    const toolWithoutDescription: Tool = {
      name: "noDescriptionApp",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      _meta: {
        ui: {
          resourceUri: "ui://no-description-app",
        },
      },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithoutDescription],
    });

    expect(screen.getByText("noDescriptionApp")).toBeInTheDocument();
    expect(screen.getByText("ui://no-description-app")).toBeInTheDocument();
  });

  it("should reset selected tool when tools list changes and selected tool is removed", () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: { "ui://weather-app": "<html>test</html>" },
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Update tools list to remove the selected tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab
          {...defaultProps}
          tools={[]}
          resourceContentMap={{ "ui://weather-app": "<html>test</html>" }}
        />
      </Tabs>,
    );

    // AppRenderer should be removed
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should maintain selected tool when tools list updates but includes the same tool", () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: { "ui://weather-app": "<html>test</html>" },
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Update tools list with the same tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab
          {...defaultProps}
          tools={[mockAppTool]}
          resourceContentMap={{ "ui://weather-app": "<html>test</html>" }}
        />
      </Tabs>,
    );

    // AppRenderer should still be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
  });

  it("should display app cards with hover effect", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    expect(appCard).toHaveClass("hover:border-primary");
    expect(appCard).toHaveClass("cursor-pointer");
  });

  it("should handle empty resourceContentMap", () => {
    renderAppsTab({
      tools: [mockAppTool],
      resourceContentMap: {},
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    // AppRenderer should still be rendered but with no content
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Content: No content")).toBeInTheDocument();
  });
});
