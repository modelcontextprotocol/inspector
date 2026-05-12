import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import AppsTab from "../AppsTab";
import {
  Tool,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Tabs } from "../ui/tabs";

// Mock AppRenderer component
jest.mock("../AppRenderer", () => {
  return function MockAppRenderer({
    tool,
    toolInput,
    toolResult,
  }: {
    tool: Tool;
    toolInput?: Record<string, unknown>;
    toolResult?: unknown;
  }) {
    return (
      <div data-testid="app-renderer">
        <div>Tool: {tool.name}</div>
        <div data-testid="tool-input">{JSON.stringify(toolInput)}</div>
        <div data-testid="tool-result">
          {JSON.stringify(toolResult ?? null)}
        </div>
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
    callTool: jest.fn(
      async () =>
        ({
          content: [],
        }) as CompatibilityCallToolResult,
    ),
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

  it("should open app renderer when an app card is clicked and Open App button is clicked if fields exist", async () => {
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
    const mockCallTool = jest.fn(
      async () =>
        ({
          content: [],
        }) as CompatibilityCallToolResult,
    );

    renderAppsTab({
      tools: [toolWithFields],
      callTool: mockCallTool,
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

    await waitFor(() => {
      expect(mockCallTool).toHaveBeenCalledWith("fieldsApp", {
        field1: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });
    expect(screen.getByText("Tool: fieldsApp")).toBeInTheDocument();
  });

  it("should close app renderer when close button is clicked", async () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

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

  it("should reset selected tool when tools list changes and selected tool is removed", async () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    // Update tools list to remove the selected tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab {...defaultProps} tools={[]} />
      </Tabs>,
    );

    // AppRenderer should be removed
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should maintain selected tool when tools list updates but includes the same tool", async () => {
    const { rerender } = renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);
    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    // Update tools list with the same tool
    rerender(
      <Tabs defaultValue="apps">
        <AppsTab {...defaultProps} tools={[mockAppTool]} />
      </Tabs>,
    );

    // AppRenderer should still be rendered
    expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
  });

  it("should maximize and minimize the app window", async () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /maximize/i }),
      ).toBeInTheDocument();
    });

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

  it("should reset maximized state when app is closed", async () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Select the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /maximize/i }),
      ).toBeInTheDocument();
    });

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

  it("should handle empty resourceContentMap", async () => {
    renderAppsTab({
      tools: [mockAppTool],
    });

    // Open the app
    const appCard = screen.getByText("weatherApp").closest("div");
    fireEvent.click(appCard!);

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });
  });

  it("should handle various input types and pass them to AppRenderer", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput.text).toBe("hello");
    expect(toolInput.toggle).toBe(true);
    expect(toolInput.number).toBe(42);
  });

  it("should handle nullable fields", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput.nullableField).toBe(null);
  });

  it("should allow going back to input form from app renderer", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    const backButton = screen.queryByRole("button", { name: /back to input/i });
    expect(backButton).toBeInTheDocument();
  });

  it("should skip input form if tool has no input fields", async () => {
    const toolNoFields: Tool = {
      name: "noFieldsApp",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: { ui: { resourceUri: "ui://no-fields" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };
    const mockCallTool = jest.fn(
      async () =>
        ({
          content: [],
        }) as CompatibilityCallToolResult,
    );

    renderAppsTab({
      tools: [toolNoFields],
      callTool: mockCallTool,
    });

    fireEvent.click(screen.getByText("noFieldsApp"));

    await waitFor(() => {
      expect(mockCallTool).toHaveBeenCalledWith("noFieldsApp", {});
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });
    expect(screen.getByText("Tool: noFieldsApp")).toBeInTheDocument();

    // Should NOT see the back button
    expect(
      screen.queryByRole("button", { name: /back to input/i }),
    ).not.toBeInTheDocument();
  });

  it("should allow going back to input form from app renderer if fields exist", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    const backButton = screen.getByRole("button", { name: /back to input/i });
    fireEvent.click(backButton);

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(screen.getByText("App Input")).toBeInTheDocument();
  });

  it("should auto-render app from prefilled tools tab call without manual click", async () => {
    const toolWithFields: Tool = {
      name: "prefilledApp",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://prefilled" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };
    const onPrefilledToolCallConsumed = jest.fn();
    const prefilledResult: CompatibilityCallToolResult = {
      content: [{ type: "text", text: "weather result" }],
    };

    renderAppsTab({
      tools: [toolWithFields],
      prefilledToolCall: {
        id: 42,
        toolName: "prefilledApp",
        params: { city: "Lisbon" },
        result: prefilledResult,
      },
      onPrefilledToolCallConsumed,
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
      expect(screen.getByText("Tool: prefilledApp")).toBeInTheDocument();
    });

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput).toEqual({ city: "Lisbon" });
    expect(screen.getByTestId("tool-result")).toHaveTextContent(
      "weather result",
    );
    expect(onPrefilledToolCallConsumed).toHaveBeenCalledWith(42);
  });

  it("should not auto-render app when no prefilled tool call is provided", () => {
    const toolWithFields: Tool = {
      name: "manualApp",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://manual" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    renderAppsTab({
      tools: [toolWithFields],
    });

    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
    expect(
      screen.getByText("Select an app from the list to get started"),
    ).toBeInTheDocument();
  });

  it("should preserve submitted params while opening app", async () => {
    const toolWithFields: Tool = {
      name: "paramsApp",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://params" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    let resolveCall: ((result: CompatibilityCallToolResult) => void) | null =
      null;
    const mockCallTool = jest.fn(
      () =>
        new Promise<CompatibilityCallToolResult>((resolve) => {
          resolveCall = resolve;
        }),
    );

    renderAppsTab({
      tools: [toolWithFields],
      callTool: mockCallTool,
    });

    fireEvent.click(screen.getByText("paramsApp"));
    fireEvent.change(screen.getByLabelText("query"), {
      target: { value: "first value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    fireEvent.change(screen.getByLabelText("query"), {
      target: { value: "second value" },
    });

    expect(resolveCall).toBeTruthy();
    await act(async () => {
      resolveCall?.({
        content: [{ type: "text", text: "done" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("app-renderer")).toBeInTheDocument();
    });

    const toolInput = JSON.parse(
      screen.getByTestId("tool-input").textContent || "{}",
    );
    expect(toolInput.query).toBe("first value");
  });

  it("should keep input view when opening fails and recover button state", async () => {
    const toolWithFields: Tool = {
      name: "failingApp",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://failing" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    const mockCallTool = jest.fn(
      async () =>
        await Promise.reject<CompatibilityCallToolResult>(
          new Error("tool failed"),
        ),
    );

    renderAppsTab({
      tools: [toolWithFields],
      callTool: mockCallTool,
    });

    fireEvent.click(screen.getByText("failingApp"));
    fireEvent.click(screen.getByRole("button", { name: /open app/i }));

    await waitFor(() => {
      expect(mockCallTool).toHaveBeenCalledWith("failingApp", {
        query: undefined,
      });
    });

    await waitFor(() => {
      const openAppButton = screen.getByRole("button", { name: /open app/i });
      expect(openAppButton).toBeEnabled();
    });

    expect(screen.getByText("App Input")).toBeInTheDocument();
    expect(screen.queryByTestId("app-renderer")).not.toBeInTheDocument();
  });

  it("should ignore stale results from older app launches", async () => {
    const appA: Tool = {
      name: "appA",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: { ui: { resourceUri: "ui://app-a" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };
    const appB: Tool = {
      name: "appB",
      inputSchema: {
        type: "object",
        properties: {},
      },
      _meta: { ui: { resourceUri: "ui://app-b" } },
    } as Tool & { _meta?: { ui?: { resourceUri?: string } } };

    const pendingCalls: {
      name: string;
      resolve: (result: CompatibilityCallToolResult) => void;
    }[] = [];
    const mockCallTool = jest.fn(
      (name: string) =>
        new Promise<CompatibilityCallToolResult>((resolve) => {
          pendingCalls.push({ name, resolve });
        }),
    );

    renderAppsTab({
      tools: [appA, appB],
      callTool: mockCallTool,
    });

    fireEvent.click(screen.getByText("appA"));
    fireEvent.click(screen.getByText("appB"));

    const appBCall = pendingCalls.find((call) => call.name === "appB");
    const appACall = pendingCalls.find((call) => call.name === "appA");
    expect(appBCall).toBeTruthy();
    expect(appACall).toBeTruthy();

    await act(async () => {
      appBCall?.resolve({
        content: [{ type: "text", text: "result from appB" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Tool: appB")).toBeInTheDocument();
      expect(screen.getByTestId("tool-result")).toHaveTextContent("appB");
    });

    await act(async () => {
      appACall?.resolve({
        content: [{ type: "text", text: "result from appA" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Tool: appB")).toBeInTheDocument();
      expect(screen.getByTestId("tool-result")).toHaveTextContent("appB");
      expect(screen.getByTestId("tool-result")).not.toHaveTextContent("appA");
    });
  });
});
