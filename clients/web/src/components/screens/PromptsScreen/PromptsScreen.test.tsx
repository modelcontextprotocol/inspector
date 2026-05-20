import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptsScreen } from "./PromptsScreen";

const promptsWithArgs: Prompt[] = [
  {
    name: "summarize",
    description: "Summarize text",
    arguments: [{ name: "topic", required: true }],
  },
  {
    name: "translate",
    description: "Translate text",
    arguments: [{ name: "text", required: true }],
  },
];

const noArgPrompts: Prompt[] = [
  { name: "ping", description: "No-arg ping" },
  { name: "pong", description: "Also no-arg" },
];

const baseProps = {
  prompts: promptsWithArgs,
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

  it("shows the argument form when a prompt with arguments is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PromptsScreen {...baseProps} />);
    await user.click(screen.getByText("summarize"));
    expect(
      screen.getByRole("button", { name: "Get Prompt" }),
    ).toBeInTheDocument();
  });

  it("auto-fetches when a no-argument prompt is selected", async () => {
    const user = userEvent.setup();
    const onGetPrompt = vi.fn();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        prompts={noArgPrompts}
        onGetPrompt={onGetPrompt}
      />,
    );
    await user.click(screen.getByText("ping"));
    expect(onGetPrompt).toHaveBeenCalledWith("ping", {});
    // The form pane is not rendered for no-argument prompts.
    expect(
      screen.queryByRole("button", { name: "Get Prompt" }),
    ).not.toBeInTheDocument();
  });

  it("does not re-fire auto-fetch on subsequent renders", async () => {
    const user = userEvent.setup();
    const onGetPrompt = vi.fn();
    const { rerender } = renderWithMantine(
      <PromptsScreen
        {...baseProps}
        prompts={noArgPrompts}
        onGetPrompt={onGetPrompt}
      />,
    );
    await user.click(screen.getByText("ping"));
    expect(onGetPrompt).toHaveBeenCalledTimes(1);
    // Parent re-renders with a fresh pending state — the fetch must not
    // re-fire just because props changed.
    rerender(
      <PromptsScreen
        {...baseProps}
        prompts={noArgPrompts}
        onGetPrompt={onGetPrompt}
        getPromptState={{ status: "pending", promptName: "ping" }}
      />,
    );
    expect(onGetPrompt).toHaveBeenCalledTimes(1);
  });

  it("hides the argument form once the user clicks Get Prompt", async () => {
    const user = userEvent.setup();
    const onGetPrompt = vi.fn();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        onGetPrompt={onGetPrompt}
        getPromptState={{
          status: "ok",
          promptName: "summarize",
          result: {
            messages: [{ role: "user", content: { type: "text", text: "hi" } }],
          },
        }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "math");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(onGetPrompt).toHaveBeenCalledWith("summarize", { topic: "math" });
    // After submit, the form is gone and the messages panel is shown.
    expect(
      screen.queryByRole("button", { name: "Get Prompt" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });

  it("shows pending state once the user has submitted", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{ status: "pending", promptName: "summarize" }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "x");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(screen.getByText("Loading prompt...")).toBeInTheDocument();
  });

  it("shows error state once the user has submitted", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{
          status: "error",
          promptName: "summarize",
          error: "Bad prompt",
        }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "x");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(screen.getByText("Prompt Error")).toBeInTheDocument();
    expect(screen.getByText("Bad prompt")).toBeInTheDocument();
  });

  it("falls back to a default error message when none is provided", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{ status: "error", promptName: "summarize" }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "x");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(screen.getByText("Failed to get prompt")).toBeInTheDocument();
  });

  it("ignores a stale getPromptState whose name does not match the selection", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        // Stale result for a prompt the user is no longer viewing.
        getPromptState={{
          status: "ok",
          promptName: "translate",
          result: {
            messages: [{ role: "user", content: { type: "text", text: "x" } }],
          },
        }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    // Form for the freshly-selected prompt, not the stale "translate" result.
    expect(
      screen.getByRole("button", { name: "Get Prompt" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Messages")).not.toBeInTheDocument();
  });

  it("resets argument values when switching prompts", async () => {
    const user = userEvent.setup();
    const arglessTwoStep: Prompt[] = [
      { name: "alpha", arguments: [{ name: "x" }] },
      { name: "beta", arguments: [{ name: "y" }] },
    ];
    renderWithMantine(
      <PromptsScreen {...baseProps} prompts={arglessTwoStep} />,
    );
    await user.click(screen.getByText("alpha"));
    await user.type(screen.getByPlaceholderText("Enter x..."), "value");
    await user.click(screen.getByText("beta"));
    expect(screen.getByPlaceholderText("Enter y...")).toHaveValue("");
  });

  it("closing the preview for an arg-bearing prompt brings the form back", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        getPromptState={{
          status: "ok",
          promptName: "summarize",
          result: {
            messages: [{ role: "user", content: { type: "text", text: "hi" } }],
          },
        }}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByPlaceholderText("Enter topic..."), "math");
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    // Preview is showing now — close it.
    await user.click(screen.getByRole("button", { name: "Close messages" }));
    expect(
      screen.getByRole("button", { name: "Get Prompt" }),
    ).toBeInTheDocument();
    // Argument value is preserved so the user can edit + re-submit.
    expect(screen.getByPlaceholderText("Enter topic...")).toHaveValue("math");
  });

  it("closing the preview for a no-arg prompt drops the selection", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        prompts={noArgPrompts}
        getPromptState={{
          status: "ok",
          promptName: "ping",
          result: {
            messages: [{ role: "user", content: { type: "text", text: "hi" } }],
          },
        }}
      />,
    );
    await user.click(screen.getByText("ping"));
    await user.click(screen.getByRole("button", { name: "Close messages" }));
    // No form to fall back to → empty state.
    expect(
      screen.getByText("Select a prompt to view details"),
    ).toBeInTheDocument();
  });

  it("threads onCompleteArgument with a ref/prompt envelope", async () => {
    const user = userEvent.setup();
    const onCompleteArgument = vi
      .fn<
        (
          ref:
            | { type: "ref/resource"; uri: string }
            | { type: "ref/prompt"; name: string },
          argName: string,
          value: string,
          context: Record<string, string>,
        ) => Promise<string[]>
      >()
      .mockResolvedValue([]);
    renderWithMantine(
      <PromptsScreen
        {...baseProps}
        completionsSupported
        onCompleteArgument={onCompleteArgument}
      />,
    );
    await user.click(screen.getByText("summarize"));
    await user.type(screen.getByRole("textbox", { name: /topic/ }), "ab");
    await new Promise((r) => setTimeout(r, 400));
    expect(onCompleteArgument).toHaveBeenCalled();
    expect(onCompleteArgument.mock.calls[0][0]).toEqual({
      type: "ref/prompt",
      name: "summarize",
    });
  });
});
