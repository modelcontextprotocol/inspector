import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptsScreen } from "./PromptsScreen";

const prompts: Prompt[] = [
  { name: "summarize", description: "Summarize text" },
  { name: "translate", description: "Translate text" },
];

const baseProps = {
  prompts,
  listChanged: false,
  onRefreshList: vi.fn(),
  onGetPrompt: vi.fn(),
};

describe("PromptsScreen", () => {
  it("renders the empty state when no prompt is selected", () => {
    renderWithMantine(<PromptsScreen {...baseProps} />);
    expect(
      screen.getByText("Select a prompt to view details"),
    ).toBeInTheDocument();
  });

  it("shows prompt arguments when a prompt is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PromptsScreen {...baseProps} />);
    await user.click(screen.getByText("summarize"));
    expect(
      screen.getByRole("button", { name: "Get Prompt" }),
    ).toBeInTheDocument();
  });

  it("shows pending state", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen {...baseProps} getPromptState={{ status: "pending" }} />,
    );
    await user.click(screen.getByText("summarize"));
    expect(screen.getByText("Loading prompt...")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{ status: "error", error: "Bad prompt" }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    expect(screen.getByText("Prompt Error")).toBeInTheDocument();
    expect(screen.getByText("Bad prompt")).toBeInTheDocument();
  });

  it("renders fallback error when error message is missing", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen {...baseProps} getPromptState={{ status: "error" }} />,
    );
    await user.click(screen.getByText("summarize"));
    expect(screen.getByText("Failed to get prompt")).toBeInTheDocument();
  });

  it("shows messages when result is provided", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{
          status: "ok",
          result: {
            messages: [{ role: "user", content: { type: "text", text: "hi" } }],
          },
        }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  it("updates argument values and calls onGetPrompt", async () => {
    const user = userEvent.setup();
    const onGetPrompt = vi.fn();
    const promptsWithArgs: Prompt[] = [
      {
        name: "ask",
        arguments: [{ name: "topic", required: true }],
      },
    ];
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        prompts={promptsWithArgs}
        onGetPrompt={onGetPrompt}
      />,
    );
    await user.click(screen.getByText("ask"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "math");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(onGetPrompt).toHaveBeenCalledWith("ask", { topic: "math" });
  });

  it("resets argument values when switching prompts", async () => {
    const user = userEvent.setup();
    const promptsWithArgs: Prompt[] = [
      { name: "alpha", arguments: [{ name: "x" }] },
      { name: "beta", arguments: [{ name: "y" }] },
    ];
    renderWithMantine(
      <PromptsScreen {...baseProps} prompts={promptsWithArgs} />,
    );
    await user.click(screen.getByText("alpha"));
    await user.type(screen.getByPlaceholderText("Enter x..."), "value");
    await user.click(screen.getByText("beta"));
    expect(screen.getByPlaceholderText("Enter y...")).toHaveValue("");
  });
});
