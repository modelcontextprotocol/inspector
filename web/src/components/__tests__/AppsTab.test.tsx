import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import AppsTab from "../AppsTab";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

vi.mock("../AppRenderer", () => ({
  default: function MockAppRenderer({
    tool,
    toolInput,
  }: {
    tool: Tool;
    toolInput?: Record<string, unknown>;
  }) {
    return (
      <div data-testid="app-renderer">
        <div>Tool: {tool.name}</div>
        <div data-testid="tool-input">{JSON.stringify(toolInput ?? {})}</div>
      </div>
    );
  },
}));

const renderAppsTab = (props: React.ComponentProps<typeof AppsTab>) =>
  render(
    <Tabs value="apps">
      <AppsTab {...props} />
    </Tabs>,
  );

describe("AppsTab", () => {
  const mockAppTool: Tool = {
    name: "weatherApp",
    description: "Weather app with UI",
    inputSchema: {
      type: "object",
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
      type: "object",
      properties: {},
    },
  };

  const listTools = vi.fn();
  const mockMcpClient = {
    callTool: vi.fn(),
    request: vi.fn(),
    getServerCapabilities: vi.fn().mockReturnValue({}),
    setNotificationHandler: vi.fn(),
  } as unknown as Client;

  const defaultProps = {
    sandboxPath: "http://localhost:6277/sandbox",
    tools: [] as Tool[],
    listTools,
    error: null as string | null,
    appRendererClient: mockMcpClient,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should display message when no apps are available", () => {
    renderAppsTab(defaultProps);

    expect(screen.getByText(/No MCP Apps available/i)).toBeInTheDocument();
    expect(screen.getByText(/_meta\.ui\.resourceUri/)).toBeInTheDocument();
  });

  it("should filter and display only tools with UI metadata", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool, mockRegularTool],
    });

    expect(screen.getByText("weatherApp")).toBeInTheDocument();
    expect(screen.getByText("Weather app with UI")).toBeInTheDocument();
    expect(screen.queryByText("regularTool")).not.toBeInTheDocument();
  });

  it("should display multiple app tools in a grid", () => {
    const mockAppTool2: Tool = {
      name: "calendarApp",
      description: "Calendar app with UI",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: {
        ui: {
          resourceUri: "ui://calendar-app",
        },
      },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool, mockAppTool2],
    });

    expect(screen.getByText("weatherApp")).toBeInTheDocument();
    expect(screen.getByText("calendarApp")).toBeInTheDocument();
  });

  it("should call listTools when refresh button is clicked", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
      listTools,
    });

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("should display error message when error prop is provided", () => {
    const errorMessage = "Failed to fetch tools";
    renderAppsTab({
      ...defaultProps,
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
      ...defaultProps,
      tools: [toolWithFields],
    });

    const appCard = screen.getByText("fieldsApp").closest("div");
    expect(appCard).toBeTruthy();
    fireEvent.click(appCard!);

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("App Input")).toBeInTheDocument();

    const openAppButton = screen.getByRole("button", { name: /open app/i });
    fireEvent.click(openAppButton);

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Tool: fieldsApp")).toBeInTheDocument();
  });

  it("should close app renderer when close button is clicked", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    const closeButton = screen.getByRole("button", { name: /close app/i });
    fireEvent.click(closeButton);

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should handle tool without description", () => {
    const toolWithoutDescription: Tool = {
      name: "noDescriptionApp",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: {
        ui: {
          resourceUri: "ui://no-description-app",
        },
      },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      ...defaultProps,
      tools: [toolWithoutDescription],
    });

    expect(screen.getByText("noDescriptionApp")).toBeInTheDocument();
  });

  it("should reset selected tool when tools list changes and selected tool is removed", () => {
    const { rerender } = renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    rerender(
      <Tabs value="apps">
        <AppsTab {...defaultProps} tools={[]} />
      </Tabs>,
    );

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should maintain selected tool when tools list updates but includes the same tool", () => {
    const { rerender } = renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    rerender(
      <Tabs value="apps">
        <AppsTab {...defaultProps} tools={[mockAppTool]} />
      </Tabs>,
    );

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
  });

  it("should maximize and minimize the app window", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    expect(
      screen.getByRole("button", { name: /maximize/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("MCP Apps")).toBeInTheDocument();

    const maximizeButton = screen.getByRole("button", { name: /maximize/i });
    fireEvent.click(maximizeButton);

    expect(screen.queryByText("MCP Apps")).not.toBeInTheDocument();

    const minimizeButton = screen.getByRole("button", { name: /minimize/i });
    fireEvent.click(minimizeButton);

    expect(screen.getByText("MCP Apps")).toBeInTheDocument();
  });

  it("should reset maximized state when app is closed", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    fireEvent.click(screen.getByRole("button", { name: /maximize/i }));
    expect(screen.queryByText("MCP Apps")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close app/i }));

    expect(screen.getByText("MCP Apps")).toBeInTheDocument();
  });

  it("should display app cards in the list", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appItem = screen.getByText("weatherApp").closest("div");
    expect(appItem).toBeTruthy();
  });

  it("should handle empty resourceContentMap", () => {
    renderAppsTab({
      ...defaultProps,
      tools: [mockAppTool],
    });

    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

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
      ...defaultProps,
      tools: [toolWithComplexSchema],
    });

    fireEvent.click(screen.getByText("complexApp"));

    const textInput = document.getElementById("text");
    expect(textInput).toBeTruthy();
    if (textInput) {
      fireEvent.change(textInput, { target: { value: "hello" } });
    }

    const toggleLabel = screen.getByText(/Toggle this option/i);
    fireEvent.click(toggleLabel);

    const numberInput = document.getElementById("number");
    expect(numberInput).toBeTruthy();
    if (numberInput) {
      fireEvent.change(numberInput, { target: { value: "42" } });
    }

    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    const toolInputEl = screen.getByTestId("tool-input");
    const toolInput = JSON.parse(toolInputEl.textContent || "{}");
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
          nullableField: { type: ["string", "null"] as unknown as string },
        },
      },
      _meta: { ui: { resourceUri: "ui://nullable" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      ...defaultProps,
      tools: [toolWithNullable],
    });

    fireEvent.click(screen.getByText("nullableApp"));

    const nullCheckbox = screen.getByLabelText("null");
    fireEvent.click(nullCheckbox);

    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    const toolInputEl = screen.getByTestId("tool-input");
    const toolInput = JSON.parse(toolInputEl.textContent || "{}");
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
      ...defaultProps,
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
      ...defaultProps,
      tools: [toolNoFields],
    });

    fireEvent.click(screen.getByText("noFieldsApp"));

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    expect(screen.getByText("Tool: noFieldsApp")).toBeInTheDocument();
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
      ...defaultProps,
      tools: [toolWithFields],
    });

    fireEvent.click(screen.getByText("fieldsApp"));
    expect(screen.getByText("App Input")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();

    const backButton = screen.getByRole("button", { name: /back to input/i });
    fireEvent.click(backButton);

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("App Input")).toBeInTheDocument();
  });

  it("should show Refresh Apps button and not show Clear", () => {
    renderAppsTab(defaultProps);

    expect(
      screen.getByRole("button", { name: "Refresh Apps" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });
});
