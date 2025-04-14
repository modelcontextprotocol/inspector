import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import ToolsTab from "../ToolsTab";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Tabs } from "@/components/ui/tabs";

describe("ToolsTab", () => {
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
});
