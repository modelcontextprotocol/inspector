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
    toolInput,
  }: {
    tool: Tool;
    toolInput?: Record<string, unknown>;
  }) {
    return (
      <div data-testid="app-renderer">
        <div>Tool: {tool.name}</div>
        <div data-testid="tool-input">{JSON.stringify(toolInput)}</div>
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

  it("should open app renderer when an app card is clicked and Open App button is clicked if fields exist", () => {
    const toolWithFields: Tool = {
      name: "fieldsApp",
      inputSchema: {
        type: "object",
        properties: {
          field1: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://fields" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithFields],
    });

    const appCard = screen.getByText("fieldsApp").closest("div");
    expect(appCard).toBeTruthy();
    fireEvent.click(appCard!);

    // Should see the input form now, not the renderer yet
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("App Input")).toBeInTheDocument();

    // Click Open App button
    const openAppButton = screen.getByRole("button", { name: /open app/i });
    fireEvent.click(openAppButton);

    // AppRenderer should be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Tool: fieldsApp")).toBeInTheDocument();
  });

  it("should close app renderer when close button is clicked", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Close the app (Deselect tool)
    const closeButton = screen.getByRole("button", { name: /close app/i });
    fireEvent.click(closeButton);

    // AppRenderer should be removed
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
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
  });

  it("should reset selected tool when tools list changes and selected tool is removed", () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Update tools list to remove the selected tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab {...defaultProps} tools={[]} />
      </Tabs>,
    );

    // AppRenderer should be removed
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should maintain selected tool when tools list updates but includes the same tool", () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    // Update tools list with the same tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab {...defaultProps} tools={[mockAppTool]} />
      </Tabs>,
    );

    // AppRenderer should still be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
  });

  it("should maximize and minimize the app window", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately

    // Now Maximize button should be visible
    expect(
      screen.getByRole("button", { name: /maximize/i }),
    ).toBeInTheDocument();

    // Initially, ListPane should be visible
    expect(screen.getByText("MCP Apps")).toBeInTheDocument();

    // Click Maximize
    const maximizeButton = screen.getByRole("button", { name: /maximize/i });
    fireEvent.click(maximizeButton);

    // ListPane should be hidden
    expect(screen.queryByText("MCP Apps")).not.toBeInTheDocument();

    // Click Minimize
    const minimizeButton = screen.getByRole("button", { name: /minimize/i });
    fireEvent.click(minimizeButton);

    // ListPane should be visible again
    expect(screen.getByText("MCP Apps")).toBeInTheDocument();
  });

  it("should reset maximized state when app is closed", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately

    // Maximize
    fireEvent.click(screen.getByRole("button", { name: /maximize/i }));
    expect(screen.queryByText("MCP Apps")).not.toBeInTheDocument();

    // Close app (deselect tool)
    fireEvent.click(screen.getByRole("button", { name: /close app/i }));

    // ListPane should be visible again
    expect(screen.getByText("MCP Apps")).toBeInTheDocument();
  });

  it("should display app cards in the list", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    const appItem = screen.getByText("weatherApp").closest("div");
    expect(appItem).toBeTruthy();
  });

  it("should handle empty resourceContentMap", () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    // weatherApp has no properties in mockAppTool, so it should be open immediately

    // AppRenderer should still be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
  });

  it("should handle various input types and pass them to AppRenderer", () => {
    const toolWithComplexSchema: Tool = {
      name: "complexApp",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          toggle: { type: "boolean" },
          number: { type: "number" },
          choice: { type: "string", enum: ["a", "b"] },
        },
      },
      _meta: { ui: { resourceUri: "ui://complex" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithComplexSchema],
    });

    fireEvent.click(screen.getByText("complexApp"));

    // Fill the form
    fireEvent.change(screen.getByLabelText("text"), {
      target: { value: "hello" },
    });
    // Checkboxes are often rendered with a label next to them, let's look for the text
    const toggleLabel = screen.getByText(/Toggle this option/i);
    fireEvent.click(toggleLabel);
    fireEvent.change(screen.getByLabelText("number"), {
      target: { value: "42" },
    });

    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput.text).toBe("hello");
    expect(toolInput.toggle).toBe(true);
    expect(toolInput.number).toBe(42);
  });

  it("should handle nullable fields", () => {
    const toolWithNullable: Tool = {
      name: "nullableApp",
      inputSchema: {
        type: "object",
        properties: {
          nullableField: { type: ["string", "null"] },
        },
      },
      _meta: { ui: { resourceUri: "ui://nullable" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithNullable],
    });

    fireEvent.click(screen.getByText("nullableApp"));

    // Check the 'null' checkbox
    const nullCheckbox = screen.getByLabelText("null");
    fireEvent.click(nullCheckbox);

    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput.nullableField).toBe(null);
  });

  it("should allow going back to input form from app renderer", () => {
    const toolWithFields: Tool = {
      name: "fieldsApp",
      inputSchema: {
        type: "object",
        properties: {
          field1: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://fields" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithFields],
    });

    fireEvent.click(screen.getByText("fieldsApp"));
    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    const backButton = screen.queryByRole("button", { name: /back to input/i });
    expect(backButton).toBeInTheDocument();
  });

  it("should skip input form if tool has no input fields", () => {
    const toolNoFields: Tool = {
      name: "noFieldsApp",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: { ui: { resourceUri: "ui://no-fields" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolNoFields],
    });

    fireEvent.click(screen.getByText("noFieldsApp"));

    // Should see the renderer immediately
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Tool: noFieldsApp")).toBeInTheDocument();

    // Should NOT see the back button
    expect(
      screen.queryByRole("button", { name: /back to input/i }),
    ).not.toBeInTheDocument();
  });

  it("should allow going back to input form from app renderer if fields exist", () => {
    const toolWithFields: Tool = {
      name: "fieldsApp",
      inputSchema: {
        type: "object",
        properties: {
          field1: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://fields" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithFields],
    });

    fireEvent.click(screen.getByText("fieldsApp"));

    // Should see input form first
    expect(screen.getByText("App Input")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    const backButton = screen.getByRole("button", { name: /back to input/i });
    fireEvent.click(backButton);

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("App Input")).toBeInTheDocument();
  });
});
