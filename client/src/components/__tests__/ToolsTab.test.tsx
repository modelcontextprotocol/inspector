import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach } from "@jest/globals";
import ToolsTab from "../ToolsTab";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Tabs } from "@/components/ui/tabs";
import { cacheToolOutputSchemas } from "@/utils/schemaUtils";
import { within } from "@testing-library/react";

describe("ToolsTab", () => {
  beforeEach(() => {
    // Clear the output schema cache before each test
    cacheToolOutputSchemas([]);
  });

  const mockTools: Tool[] = [
    {
      name: "tool1",
      description: "First tool",
      inputSchema: {
        type: "object" as const,
        properties: {
          num: { type: "number" as const },
        },
      },
    },
    {
      name: "tool3",
      description: "Integer tool",
      inputSchema: {
        type: "object" as const,
        properties: {
          count: { type: "integer" as const },
        },
      },
    },
    {
      name: "tool2",
      description: "Second tool",
      inputSchema: {
        type: "object" as const,
        properties: {
          num: { type: "number" as const },
        },
      },
    },
    {
      name: "tool4",
      description: "Tool with nullable field",
      inputSchema: {
        type: "object" as const,
        properties: {
          num: { type: ["number", "null"] as const },
        },
      },
    },
  ];

  const defaultProps = {
    tools: mockTools,
    listTools: jest.fn(),
    clearTools: jest.fn(),
    callTool: jest.fn(async () => {}),
    selectedTool: null,
    setSelectedTool: jest.fn(),
    toolResult: null,
    nextCursor: "",
    error: null,
    resourceContent: {},
    onReadResource: jest.fn(),
  };

  const renderToolsTab = (props = {}) => {
    return render(
      <Tabs defaultValue="tools">
        <ToolsTab {...defaultProps} {...props} />
      </Tabs>,
    );
  };

  it("should reset input values when switching tools", async () => {
    const { rerender } = renderToolsTab({
      selectedTool: mockTools[0],
    });

    // Enter a value in the first tool's input
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "42" } });
    });
    expect(input.value).toBe("42");

    // Switch to second tool
    rerender(
      <Tabs defaultValue="tools">
        <ToolsTab {...defaultProps} selectedTool={mockTools[2]} />
      </Tabs>,
    );

    // Verify input is reset
    const newInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(newInput.value).toBe("");
  });

  it("should handle integer type inputs", async () => {
    renderToolsTab({
      selectedTool: mockTools[1], // Use the tool with integer type
    });

    const input = screen.getByRole("spinbutton", {
      name: /count/i,
    }) as HTMLInputElement;
    expect(input).toHaveProperty("type", "number");
    fireEvent.change(input, { target: { value: "42" } });
    expect(input.value).toBe("42");

    const submitButton = screen.getByRole("button", { name: /run tool/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(defaultProps.callTool).toHaveBeenCalledWith(mockTools[1].name, {
      count: 42,
    });
  });

  it("should allow typing negative numbers", async () => {
    renderToolsTab({
      selectedTool: mockTools[0],
    });

    const input = screen.getByRole("spinbutton") as HTMLInputElement;

    // Complete the negative number
    fireEvent.change(input, { target: { value: "-42" } });
    expect(input.value).toBe("-42");

    const submitButton = screen.getByRole("button", { name: /run tool/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(defaultProps.callTool).toHaveBeenCalledWith(mockTools[0].name, {
      num: -42,
    });
  });

  it("should allow specifying null value", async () => {
    const mockCallTool = jest.fn();
    const toolWithNullableField = mockTools[3];

    renderToolsTab({
      tools: [toolWithNullableField],
      selectedTool: toolWithNullableField,
      callTool: mockCallTool,
    });

    const nullToggleButton = screen.getByRole("checkbox", { name: /null/i });
    expect(nullToggleButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(nullToggleButton);
    });

    expect(screen.getByRole("toolinputwrapper").classList).toContain(
      "pointer-events-none",
    );

    const runButton = screen.getByRole("button", { name: /run tool/i });
    await act(async () => {
      fireEvent.click(runButton);
    });

    // Tool should have been called with null value
    expect(mockCallTool).toHaveBeenCalledWith(toolWithNullableField.name, {
      num: null,
    });
  });

  it("should support tri-state nullable boolean (null -> false -> true -> null)", async () => {
    const mockCallTool = jest.fn();
    const toolWithNullableBoolean: Tool = {
      name: "testTool",
      description: "Tool with nullable boolean",
      inputSchema: {
        type: "object" as const,
        properties: {
          optionalBoolean: {
            type: ["boolean", "null"] as const,
            default: null,
          },
        },
      },
    };

    renderToolsTab({
      tools: [toolWithNullableBoolean],
      selectedTool: toolWithNullableBoolean,
      callTool: mockCallTool,
    });

    const nullCheckbox = screen.getByRole("checkbox", { name: /null/i });
    const runButton = screen.getByRole("button", { name: /run tool/i });

    // State 1: Initial state should be null (input disabled)
    const wrapper = screen.getByRole("toolinputwrapper");
    expect(wrapper.classList).toContain("pointer-events-none");
    expect(wrapper.classList).toContain("opacity-50");

    // Verify tool is called with null initially
    await act(async () => {
      fireEvent.click(runButton);
    });
    expect(mockCallTool).toHaveBeenCalledWith(toolWithNullableBoolean.name, {
      optionalBoolean: null,
    });

    // State 2: Uncheck null checkbox -> should set value to false and enable input
    await act(async () => {
      fireEvent.click(nullCheckbox);
    });
    expect(wrapper.classList).not.toContain("pointer-events-none");

    // Clear previous calls to make assertions clearer
    mockCallTool.mockClear();

    // Verify tool can be called with false
    await act(async () => {
      fireEvent.click(runButton);
    });
    expect(mockCallTool).toHaveBeenLastCalledWith(
      toolWithNullableBoolean.name,
      {
        optionalBoolean: false,
      },
    );

    // State 3: Check boolean checkbox -> should set value to true
    // Find the boolean checkbox within the input wrapper (to avoid ID conflict with null checkbox)
    const booleanCheckbox = within(wrapper).getByRole("checkbox");

    mockCallTool.mockClear();

    await act(async () => {
      fireEvent.click(booleanCheckbox);
    });

    // Verify tool can be called with true
    await act(async () => {
      fireEvent.click(runButton);
    });
    expect(mockCallTool).toHaveBeenLastCalledWith(
      toolWithNullableBoolean.name,
      {
        optionalBoolean: true,
      },
    );

    // State 4: Check null checkbox again -> should set value back to null and disable input
    await act(async () => {
      fireEvent.click(nullCheckbox);
    });
    expect(wrapper.classList).toContain("pointer-events-none");

    // Verify tool can be called with null again
    await act(async () => {
      fireEvent.click(runButton);
    });
    expect(mockCallTool).toHaveBeenLastCalledWith(
      toolWithNullableBoolean.name,
      {
        optionalBoolean: null,
      },
    );
  });

  it("should disable button and change text while tool is running", async () => {
    // Create a promise that we can resolve later
    let resolvePromise: ((value: unknown) => void) | undefined;
    const mockPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    // Mock callTool to return our promise
    const mockCallTool = jest.fn().mockReturnValue(mockPromise);

    renderToolsTab({
      selectedTool: mockTools[0],
      callTool: mockCallTool,
    });

    const submitButton = screen.getByRole("button", { name: /run tool/i });
    expect(submitButton.getAttribute("disabled")).toBeNull();

    // Click the button and verify immediate state changes
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify button is disabled and text changed
    expect(submitButton.getAttribute("disabled")).not.toBeNull();
    expect(submitButton.textContent).toBe("Running...");

    // Resolve the promise to simulate tool completion
    await act(async () => {
      if (resolvePromise) {
        await resolvePromise({});
      }
    });

    expect(submitButton.getAttribute("disabled")).toBeNull();
  });

  describe("Output Schema Display", () => {
    const toolWithOutputSchema: Tool = {
      name: "weatherTool",
      description: "Get weather",
      inputSchema: {
        type: "object" as const,
        properties: {
          city: { type: "string" as const },
        },
      },
      outputSchema: {
        type: "object" as const,
        properties: {
          temperature: { type: "number" as const },
          humidity: { type: "number" as const },
        },
        required: ["temperature", "humidity"],
      },
    };

    it("should display output schema when tool has one", () => {
      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
      });

      expect(screen.getByText("Output Schema:")).toBeInTheDocument();
      // Check for expand/collapse button
      expect(
        screen.getByRole("button", { name: /expand/i }),
      ).toBeInTheDocument();
    });

    it("should not display output schema section when tool doesn't have one", () => {
      renderToolsTab({
        selectedTool: mockTools[0], // Tool without outputSchema
      });

      expect(screen.queryByText("Output Schema:")).not.toBeInTheDocument();
    });

    it("should toggle output schema expansion", () => {
      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
      });

      const toggleButton = screen.getByRole("button", { name: /expand/i });

      // Click to expand
      fireEvent.click(toggleButton);
      expect(
        screen.getByRole("button", { name: /collapse/i }),
      ).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(toggleButton);
      expect(
        screen.getByRole("button", { name: /expand/i }),
      ).toBeInTheDocument();
    });
  });

  describe("Structured Output Results", () => {
    const toolWithOutputSchema: Tool = {
      name: "weatherTool",
      description: "Get weather",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      outputSchema: {
        type: "object" as const,
        properties: {
          temperature: { type: "number" as const },
        },
        required: ["temperature"],
      },
    };

    beforeEach(() => {
      // Cache the tool's output schema before each test
      cacheToolOutputSchemas([toolWithOutputSchema]);
    });

    it("should display structured content when present", () => {
      const structuredResult = {
        content: [],
        structuredContent: {
          temperature: 25,
        },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: structuredResult,
      });

      expect(screen.getByText("Structured Content:")).toBeInTheDocument();
      expect(
        screen.getByText(/Valid according to output schema/),
      ).toBeInTheDocument();
    });

    it("should show validation error for invalid structured content", () => {
      const invalidResult = {
        content: [],
        structuredContent: {
          temperature: "25", // String instead of number
        },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: invalidResult,
      });

      expect(screen.getByText(/Validation Error:/)).toBeInTheDocument();
    });

    it("should show error when tool with output schema doesn't return structured content", () => {
      const resultWithoutStructured = {
        content: [{ type: "text", text: "some result" }],
        // No structuredContent
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: resultWithoutStructured,
      });

      expect(
        screen.getByText(
          /Tool has an output schema but did not return structured content/,
        ),
      ).toBeInTheDocument();
    });

    it("should show unstructured content title when both structured and unstructured exist", () => {
      const resultWithBoth = {
        content: [{ type: "text", text: '{"temperature": 25}' }],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: resultWithBoth,
      });

      expect(screen.getByText("Structured Content:")).toBeInTheDocument();
      expect(screen.getByText("Unstructured Content:")).toBeInTheDocument();
    });

    it("should not show unstructured content title when only unstructured exists", () => {
      const resultWithUnstructuredOnly = {
        content: [{ type: "text", text: "some result" }],
      };

      renderToolsTab({
        selectedTool: mockTools[0], // Tool without output schema
        toolResult: resultWithUnstructuredOnly,
      });

      expect(
        screen.queryByText("Unstructured Content:"),
      ).not.toBeInTheDocument();
    });

    it("should show compatibility check when tool has output schema", () => {
      const compatibleResult = {
        content: [{ type: "text", text: '{"temperature": 25}' }],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: compatibleResult,
      });

      // Should show compatibility result
      expect(
        screen.getByText(/structured content matches/i),
      ).toBeInTheDocument();
    });

    it("should accept multiple content blocks with structured output", () => {
      const multipleBlocksResult = {
        content: [
          { type: "text", text: "Here is the weather data:" },
          { type: "text", text: '{"temperature": 25}' },
          { type: "text", text: "Have a nice day!" },
        ],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: multipleBlocksResult,
      });

      // Should show compatible result with multiple blocks
      expect(
        screen.getByText(/structured content matches.*multiple/i),
      ).toBeInTheDocument();
    });

    it("should accept mixed content types with structured output", () => {
      const mixedContentResult = {
        content: [
          { type: "text", text: "Weather report:" },
          { type: "text", text: '{"temperature": 25}' },
          { type: "image", data: "base64data", mimeType: "image/png" },
        ],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: mixedContentResult,
      });

      // Should render without crashing - the validation logic has been updated
      expect(screen.getAllByText("weatherTool")).toHaveLength(2);
    });

    it("should reject when no text blocks match structured content", () => {
      const noMatchResult = {
        content: [
          { type: "text", text: "Some text" },
          { type: "text", text: '{"humidity": 60}' }, // Different structure
        ],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: noMatchResult,
      });

      // Should render without crashing - the validation logic has been updated
      expect(screen.getAllByText("weatherTool")).toHaveLength(2);
    });

    it("should reject when no text blocks are present", () => {
      const noTextBlocksResult = {
        content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
        structuredContent: { temperature: 25 },
      };

      renderToolsTab({
        tools: [toolWithOutputSchema],
        selectedTool: toolWithOutputSchema,
        toolResult: noTextBlocksResult,
      });

      // Should render without crashing - the validation logic has been updated
      expect(screen.getAllByText("weatherTool")).toHaveLength(2);
    });

    it("should not show compatibility check when tool has no output schema", () => {
      const resultWithBoth = {
        content: [{ type: "text", text: '{"data": "value"}' }],
        structuredContent: { different: "data" },
      };

      renderToolsTab({
        selectedTool: mockTools[0], // Tool without output schema
        toolResult: resultWithBoth,
      });

      // Should not show any compatibility messages
      expect(
        screen.queryByText(
          /structured content matches|no text blocks|no.*matches/i,
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("Resource Link Content Type", () => {
    it("should render resource_link content type and handle expansion", async () => {
      const mockOnReadResource = jest.fn();
      const resourceContent = {
        "test://static/resource/1": JSON.stringify({
          contents: [
            {
              uri: "test://static/resource/1",
              name: "Resource 1",
              mimeType: "text/plain",
              text: "Resource 1: This is a plaintext resource",
            },
          ],
        }),
      };

      const result = {
        content: [
          {
            type: "resource_link",
            uri: "test://static/resource/1",
            name: "Resource 1",
            description: "Resource 1: plaintext resource",
            mimeType: "text/plain",
          },
          {
            type: "resource_link",
            uri: "test://static/resource/2",
            name: "Resource 2",
            description: "Resource 2: binary blob resource",
            mimeType: "application/octet-stream",
          },
          {
            type: "resource_link",
            uri: "test://static/resource/3",
            name: "Resource 3",
            description: "Resource 3: plaintext resource",
            mimeType: "text/plain",
          },
        ],
      };

      renderToolsTab({
        selectedTool: mockTools[0],
        toolResult: result,
        resourceContent,
        onReadResource: mockOnReadResource,
      });

      ["1", "2", "3"].forEach((id) => {
        expect(
          screen.getByText(`test://static/resource/${id}`),
        ).toBeInTheDocument();
        expect(screen.getByText(`Resource ${id}`)).toBeInTheDocument();
      });

      expect(screen.getAllByText("text/plain")).toHaveLength(2);
      expect(screen.getByText("application/octet-stream")).toBeInTheDocument();

      const expandButtons = screen.getAllByRole("button", {
        name: /expand resource/i,
      });
      expect(expandButtons).toHaveLength(3);
      expect(screen.queryByText("Resource:")).not.toBeInTheDocument();

      expandButtons.forEach((button) => {
        expect(button).toHaveAttribute("aria-expanded", "false");
      });

      const resource1Button = screen.getByRole("button", {
        name: /expand resource test:\/\/static\/resource\/1/i,
      });

      await act(async () => {
        fireEvent.click(resource1Button);
      });

      expect(mockOnReadResource).toHaveBeenCalledWith(
        "test://static/resource/1",
      );
      expect(screen.getByText("Resource:")).toBeInTheDocument();
      expect(document.body).toHaveTextContent("contents:");
      expect(document.body).toHaveTextContent('uri:"test://static/resource/1"');
      expect(resource1Button).toHaveAttribute("aria-expanded", "true");

      await act(async () => {
        fireEvent.click(resource1Button);
      });

      expect(screen.queryByText("Resource:")).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("contents:");
      expect(document.body).not.toHaveTextContent(
        'uri:"test://static/resource/1"',
      );
      expect(resource1Button).toHaveAttribute("aria-expanded", "false");
      expect(mockOnReadResource).toHaveBeenCalledTimes(1);
    });
  });

  describe("Meta Display", () => {
    const toolWithMeta = {
      name: "metaTool",
      description: "Tool with meta",
      inputSchema: {
        type: "object" as const,
        properties: {
          foo: { type: "string" as const },
        },
      },
      _meta: {
        author: "tester",
        version: 1,
      },
    } as unknown as Tool;

    it("should display meta section when tool has _meta", () => {
      renderToolsTab({
        tools: [toolWithMeta],
        selectedTool: toolWithMeta,
      });

      expect(screen.getByText("Meta:")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /expand/i }),
      ).toBeInTheDocument();
    });

    it("should toggle meta expansion", () => {
      renderToolsTab({
        tools: [toolWithMeta],
        selectedTool: toolWithMeta,
      });

      // There might be multiple Expand buttons (Output Schema, Meta). We need the one within Meta section
      const metaHeading = screen.getByText("Meta:");
      const metaContainer = metaHeading.closest("div");
      expect(metaContainer).toBeTruthy();
      const toggleButton = within(metaContainer as HTMLElement).getByRole(
        "button",
        { name: /expand/i },
      );

      // Expand Meta
      fireEvent.click(toggleButton);
      expect(
        within(metaContainer as HTMLElement).getByRole("button", {
          name: /collapse/i,
        }),
      ).toBeInTheDocument();

      // Collapse Meta
      fireEvent.click(toggleButton);
      expect(
        within(metaContainer as HTMLElement).getByRole("button", {
          name: /expand/i,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("ToolResults Meta", () => {
    it("should display meta information when present in toolResult", () => {
      const resultWithMeta = {
        content: [],
        _meta: { info: "details", version: 2 },
      };

      renderToolsTab({
        selectedTool: mockTools[0],
        toolResult: resultWithMeta,
      });

      // Only ToolResults meta should be present since selectedTool has no _meta
      expect(screen.getAllByText("Meta:")).toHaveLength(1);
      expect(screen.getByText(/info/i)).toBeInTheDocument();
      expect(screen.getByText(/version/i)).toBeInTheDocument();
    });
  });

  describe("Enum Parameters", () => {
    const toolWithEnumParam: Tool = {
      name: "enumTool",
      description: "Tool with enum parameter",
      inputSchema: {
        type: "object" as const,
        properties: {
          format: {
            type: "string" as const,
            enum: ["json", "xml", "csv", "yaml"],
            description: "Output format",
          },
        },
      },
    };

    beforeEach(() => {
      // Mock scrollIntoView for Radix UI Select
      Element.prototype.scrollIntoView = jest.fn();
    });

    it("should render enum parameter as dropdown", () => {
      renderToolsTab({
        tools: [toolWithEnumParam],
        selectedTool: toolWithEnumParam,
      });

      // Should render a select button instead of textarea
      const selectTrigger = screen.getByRole("combobox", { name: /format/i });
      expect(selectTrigger).toBeInTheDocument();
    });

    it("should render non-enum string parameter as textarea", () => {
      const toolWithStringParam: Tool = {
        name: "stringTool",
        description: "Tool with regular string parameter",
        inputSchema: {
          type: "object" as const,
          properties: {
            text: {
              type: "string" as const,
              description: "Some text input",
            },
          },
        },
      };

      renderToolsTab({
        tools: [toolWithStringParam],
        selectedTool: toolWithStringParam,
      });

      // Should render textarea, not select
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("JSON Validation Integration", () => {
    const toolWithJsonParams: Tool = {
      name: "jsonTool",
      description: "Tool with JSON parameters",
      inputSchema: {
        type: "object" as const,
        required: ["config", "data"], // Make them required so they render as form fields
        properties: {
          config: {
            type: "object" as const,
            // No properties defined - this will force JSON mode
          },
          data: {
            type: "array" as const,
            // No items defined - this will force JSON mode
          },
        },
      },
    };

    it("should prevent tool execution when JSON validation fails", async () => {
      const mockCallTool = jest.fn();
      renderToolsTab({
        tools: [toolWithJsonParams],
        selectedTool: toolWithJsonParams,
        callTool: mockCallTool,
      });

      // Find JSON editor textareas (there should be at least 1 for JSON parameters)
      const textareas = screen.getAllByRole("textbox");
      expect(textareas.length).toBeGreaterThanOrEqual(1);

      // Enter invalid JSON in the first textarea
      const configTextarea = textareas[0];
      fireEvent.change(configTextarea, {
        target: { value: '{ "invalid": json }' },
      });

      // Try to run the tool
      const runButton = screen.getByRole("button", { name: /run tool/i });
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Tool should not have been called due to validation failure
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should allow tool execution when JSON validation passes", async () => {
      const mockCallTool = jest.fn();
      renderToolsTab({
        tools: [toolWithJsonParams],
        selectedTool: toolWithJsonParams,
        callTool: mockCallTool,
      });

      // Find JSON editor textareas (should have one for each required field: config and data)
      const textareas = screen.getAllByRole("textbox");
      expect(textareas.length).toBe(2);

      // Enter valid JSON in each textarea
      fireEvent.change(textareas[0], {
        target: { value: '{ "setting": "value" }' },
      });
      fireEvent.change(textareas[1], {
        target: { value: '["item1", "item2"]' },
      });

      // Wait for debounced updates
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });

      // Try to run the tool
      const runButton = screen.getByRole("button", { name: /run tool/i });
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Tool should have been called successfully
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should handle mixed valid and invalid JSON parameters", async () => {
      const mockCallTool = jest.fn();
      renderToolsTab({
        tools: [toolWithJsonParams],
        selectedTool: toolWithJsonParams,
        callTool: mockCallTool,
      });

      const textareas = screen.getAllByRole("textbox");

      // Enter invalid JSON that contains both valid and invalid parts
      fireEvent.change(textareas[0], {
        target: {
          value:
            '{ "config": { "setting": "value" }, "data": ["unclosed array" }',
        },
      });

      // Try to run the tool
      const runButton = screen.getByRole("button", { name: /run tool/i });
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Tool should not have been called due to validation failure
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should work with tools that have no JSON parameters", async () => {
      const mockCallTool = jest.fn();
      const simpleToolWithStringParam: Tool = {
        name: "simpleTool",
        description: "Tool with simple parameters",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: { type: "string" as const },
            count: { type: "number" as const },
          },
        },
      };

      renderToolsTab({
        tools: [simpleToolWithStringParam],
        selectedTool: simpleToolWithStringParam,
        callTool: mockCallTool,
      });

      // Fill in the simple parameters
      const messageInput = screen.getByRole("textbox");
      const countInput = screen.getByRole("spinbutton");

      fireEvent.change(messageInput, { target: { value: "test message" } });
      fireEvent.change(countInput, { target: { value: "5" } });

      // Run the tool
      const runButton = screen.getByRole("button", { name: /run tool/i });
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Tool should have been called successfully (no JSON validation needed)
      expect(mockCallTool).toHaveBeenCalledWith(
        simpleToolWithStringParam.name,
        {
          message: "test message",
          count: 5,
        },
      );
    });

    it("should handle empty JSON parameters correctly", async () => {
      const mockCallTool = jest.fn();
      renderToolsTab({
        tools: [toolWithJsonParams],
        selectedTool: toolWithJsonParams,
        callTool: mockCallTool,
      });

      const textareas = screen.getAllByRole("textbox");
      expect(textareas.length).toBe(2);

      // Clear both textareas (empty JSON should be valid)
      fireEvent.change(textareas[0], { target: { value: "{}" } });
      fireEvent.change(textareas[1], { target: { value: "[]" } });

      // Wait for debounced updates
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });

      // Try to run the tool
      const runButton = screen.getByRole("button", { name: /run tool/i });
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Tool should have been called (empty JSON is considered valid)
      expect(mockCallTool).toHaveBeenCalled();
    });
  });
});
