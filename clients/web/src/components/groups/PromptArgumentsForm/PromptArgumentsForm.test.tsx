import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptArgumentsForm } from "./PromptArgumentsForm";

const promptNoArgs: Prompt = {
  name: "summarize",
  description: "Summarize the given text into key points",
};

const promptWithArgs: Prompt = {
  name: "translate",
  title: "Translate Text",
  description: "Translate text from one language to another",
  arguments: [
    { name: "text", required: true, description: "The text to translate" },
    {
      name: "targetLanguage",
      required: false,
      description: "The language to translate into",
    },
  ],
};

const promptNoDescription: Prompt = {
  name: "code-review",
  arguments: [
    { name: "code", required: true, description: "The code to review" },
  ],
};

describe("PromptArgumentsForm", () => {
  it("renders the prompt name when title is missing", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptNoArgs}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText("summarize")).toBeInTheDocument();
    expect(
      screen.getByText("Summarize the given text into key points"),
    ).toBeInTheDocument();
  });

  it("prefers the prompt title over the name", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText("Translate Text")).toBeInTheDocument();
  });

  it("does not render Arguments section when prompt has no arguments", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptNoArgs}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
  });

  it("renders argument inputs and the Arguments title when arguments are present", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByLabelText(/text/)).toBeInTheDocument();
    expect(screen.getByLabelText(/targetLanguage/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Enter targetLanguage..."),
    ).toBeInTheDocument();
  });

  it("renders pre-filled argument values", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{ text: "Hello", targetLanguage: "Spanish" }}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Spanish")).toBeInTheDocument();
  });

  it("invokes onArgumentChange when typing in an argument input", async () => {
    const user = userEvent.setup();
    const onArgumentChange = vi.fn();
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{}}
        onArgumentChange={onArgumentChange}
        onGetPrompt={vi.fn()}
      />,
    );
    await user.type(screen.getByPlaceholderText("Enter text..."), "h");
    expect(onArgumentChange).toHaveBeenCalledWith("text", "h");
  });

  it("invokes onGetPrompt when Get Prompt is clicked", async () => {
    const user = userEvent.setup();
    const onGetPrompt = vi.fn();
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={onGetPrompt}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(onGetPrompt).toHaveBeenCalledTimes(1);
  });

  it("renders without description when none is provided", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptNoDescription}
        argumentValues={{}}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(screen.getByText("Arguments")).toBeInTheDocument();
  });
});
