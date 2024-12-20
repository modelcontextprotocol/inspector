import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptsTab from "../../components/PromptsTab";
import type { Prompt } from "../../components/PromptsTab";
import { Tabs } from "@/components/ui/tabs";

describe("PromptsTab", () => {
  const mockPrompts: Prompt[] = [
    {
      name: "test-prompt-1",
      description: "Test prompt 1 description",
      arguments: [
        { name: "arg1", description: "Argument 1", required: true },
        { name: "arg2", description: "Argument 2" },
      ],
    },
    {
      name: "test-prompt-2",
      description: "Test prompt 2 description",
    },
  ];

  const defaultProps = {
    prompts: mockPrompts,
    listPrompts: vi.fn(),
    clearPrompts: vi.fn(),
    getPrompt: vi.fn(),
    selectedPrompt: null,
    setSelectedPrompt: vi.fn(),
    promptContent: "",
    nextCursor: null,
    error: null,
  };

  const renderWithTabs = (component: React.ReactElement) => {
    return render(<Tabs defaultValue="prompts">{component}</Tabs>);
  };

  it("renders list of prompts", () => {
    renderWithTabs(<PromptsTab {...defaultProps} />);
    expect(screen.getByText("test-prompt-1")).toBeInTheDocument();
    expect(screen.getByText("test-prompt-2")).toBeInTheDocument();
  });

  it("shows prompt details when selected", () => {
    const props = {
      ...defaultProps,
      selectedPrompt: mockPrompts[0],
    };
    renderWithTabs(<PromptsTab {...props} />);
    expect(
      screen.getByText("Test prompt 1 description", {
        selector: "p.text-sm.text-gray-600",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("arg1")).toBeInTheDocument();
    expect(screen.getByText("arg2")).toBeInTheDocument();
  });

  it("handles argument input", () => {
    const getPrompt = vi.fn();
    const props = {
      ...defaultProps,
      selectedPrompt: mockPrompts[0],
      getPrompt,
    };
    renderWithTabs(<PromptsTab {...props} />);

    const arg1Input = screen.getByPlaceholderText("Enter arg1");
    fireEvent.change(arg1Input, { target: { value: "test value" } });

    const getPromptButton = screen.getByText("Get Prompt");
    fireEvent.click(getPromptButton);

    expect(getPrompt).toHaveBeenCalledWith("test-prompt-1", {
      arg1: "test value",
    });
  });

  it("shows error message when error prop is provided", () => {
    const props = {
      ...defaultProps,
      error: "Test error message",
    };
    renderWithTabs(<PromptsTab {...props} />);
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("shows prompt content when provided", () => {
    const props = {
      ...defaultProps,
      selectedPrompt: mockPrompts[0],
      promptContent: "Test prompt content",
    };
    renderWithTabs(<PromptsTab {...props} />);
    expect(screen.getByText("Test prompt content")).toBeInTheDocument();
  });
});
