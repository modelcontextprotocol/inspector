import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptControls } from "./PromptControls";

const samplePrompts: Prompt[] = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
  },
  { name: "analyze", description: "Analyze sentiment and tone of the text" },
  { name: "code-review", description: "Review code for issues" },
  { name: "refactor" },
];

const baseProps = {
  prompts: samplePrompts,
  listChanged: false,
  onRefreshList: vi.fn(),
  onSelectPrompt: vi.fn(),
};

describe("PromptControls", () => {
  it("renders the title and search input", () => {
    renderWithMantine(<PromptControls {...baseProps} />);
    expect(screen.getByText("Prompts")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Search prompts..."),
    ).toBeInTheDocument();
  });

  it("renders all prompts by default", () => {
    renderWithMantine(<PromptControls {...baseProps} />);
    expect(screen.getByText("summarize")).toBeInTheDocument();
    expect(screen.getByText("translate")).toBeInTheDocument();
    expect(screen.getByText("analyze")).toBeInTheDocument();
    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(screen.getByText("refactor")).toBeInTheDocument();
  });

  it("filters prompts by name when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PromptControls {...baseProps} />);
    await user.type(screen.getByPlaceholderText("Search prompts..."), "trans");
    expect(screen.getByText("translate")).toBeInTheDocument();
    expect(screen.queryByText("summarize")).not.toBeInTheDocument();
    expect(screen.queryByText("refactor")).not.toBeInTheDocument();
  });

  it("filters prompts by description when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<PromptControls {...baseProps} />);
    await user.type(
      screen.getByPlaceholderText("Search prompts..."),
      "sentiment",
    );
    expect(screen.getByText("analyze")).toBeInTheDocument();
    expect(screen.queryByText("summarize")).not.toBeInTheDocument();
  });

  it("filters prompts by title when present", async () => {
    const user = userEvent.setup();
    const promptsWithTitle: Prompt[] = [
      { name: "p1", title: "Alpha Title" },
      { name: "p2", title: "Beta Title" },
    ];
    renderWithMantine(
      <PromptControls {...baseProps} prompts={promptsWithTitle} />,
    );
    await user.type(screen.getByPlaceholderText("Search prompts..."), "alpha");
    expect(screen.getByText("Alpha Title")).toBeInTheDocument();
    expect(screen.queryByText("Beta Title")).not.toBeInTheDocument();
  });

  it("invokes onSelectPrompt when an unselected prompt is clicked", async () => {
    const user = userEvent.setup();
    const onSelectPrompt = vi.fn();
    renderWithMantine(
      <PromptControls {...baseProps} onSelectPrompt={onSelectPrompt} />,
    );
    await user.click(screen.getByText("translate"));
    expect(onSelectPrompt).toHaveBeenCalledWith("translate");
  });

  it("does not invoke onSelectPrompt when the already-selected prompt is clicked", async () => {
    const user = userEvent.setup();
    const onSelectPrompt = vi.fn();
    renderWithMantine(
      <PromptControls
        {...baseProps}
        selectedName="translate"
        onSelectPrompt={onSelectPrompt}
      />,
    );
    await user.click(screen.getByText("translate"));
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });

  it("does not show the list-changed indicator when listChanged is false", () => {
    renderWithMantine(<PromptControls {...baseProps} />);
    expect(screen.queryByText("List updated")).not.toBeInTheDocument();
  });

  it("shows the list-changed indicator when listChanged is true and invokes onRefreshList", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <PromptControls
        {...baseProps}
        listChanged
        onRefreshList={onRefreshList}
      />,
    );
    expect(screen.getByText("List updated")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("renders empty list when no prompts", () => {
    renderWithMantine(<PromptControls {...baseProps} prompts={[]} />);
    expect(screen.getByText("Prompts")).toBeInTheDocument();
    expect(screen.queryByText("translate")).not.toBeInTheDocument();
  });
});
