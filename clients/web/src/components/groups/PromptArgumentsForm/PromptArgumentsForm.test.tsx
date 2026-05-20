import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptArgumentsForm } from "./PromptArgumentsForm";

/**
 * Wrapper that owns `argumentValues` state so completion tests can
 * type multi-character input naturally — the production parent
 * (PromptsScreen) is what holds this state, and the form is controlled
 * via its onArgumentChange callback.
 */
function StatefulForm(
  props: Omit<
    React.ComponentProps<typeof PromptArgumentsForm>,
    "argumentValues" | "onArgumentChange"
  > & { initialValues?: Record<string, string> },
) {
  const { initialValues, ...rest } = props;
  const [values, setValues] = useState<Record<string, string>>(
    initialValues ?? {},
  );
  return (
    <PromptArgumentsForm
      {...rest}
      argumentValues={values}
      onArgumentChange={(name, value) =>
        setValues((prev) => ({ ...prev, [name]: value }))
      }
    />
  );
}

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

  describe("completions", () => {
    it("calls onCompleteArgument (debounced) and surfaces values when supported", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue(["alpha", "alphabet"]);

      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      await user.type(screen.getByRole("textbox", { name: /^text/ }), "al");
      await new Promise((r) => setTimeout(r, 400));
      expect(onCompleteArgument).toHaveBeenCalled();
      expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "al", {});
      expect(await screen.findByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("alphabet")).toBeInTheDocument();
    });

    it("passes sibling argument values as completion context", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue([]);

      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          initialValues={{ targetLanguage: "es" }}
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      await user.type(screen.getByRole("textbox", { name: /^text/ }), "h");
      await new Promise((r) => setTimeout(r, 400));
      // The completing arg ("text") is excluded from context; siblings ride along.
      expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "h", {
        targetLanguage: "es",
      });
    });

    it("does not call onCompleteArgument when completions are unsupported", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi.fn();
      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported={false}
          onCompleteArgument={onCompleteArgument}
        />,
      );
      await user.type(screen.getByPlaceholderText("Enter text..."), "ab");
      await new Promise((r) => setTimeout(r, 400));
      expect(onCompleteArgument).not.toHaveBeenCalled();
    });
  });
});
