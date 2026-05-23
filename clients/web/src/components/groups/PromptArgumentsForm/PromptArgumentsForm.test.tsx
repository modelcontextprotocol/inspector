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
        // Required arg filled — otherwise the button is disabled.
        argumentValues={{ text: "Hello" }}
        onArgumentChange={vi.fn()}
        onGetPrompt={onGetPrompt}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Get Prompt" }));
    expect(onGetPrompt).toHaveBeenCalledTimes(1);
  });

  it("disables Get Prompt until every required argument has a value", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <StatefulForm prompt={promptWithArgs} onGetPrompt={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Get Prompt" });
    expect(button).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Enter text..."), "hi");
    expect(button).not.toBeDisabled();
  });

  it("allows submission when only optional arguments are blank", () => {
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{ text: "Hello" }}
        onArgumentChange={vi.fn()}
        onGetPrompt={vi.fn()}
      />,
    );
    // targetLanguage is required: false, so leaving it blank should
    // not disable submission.
    expect(
      screen.getByRole("button", { name: "Get Prompt" }),
    ).not.toBeDisabled();
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
    it("fires a completion immediately on focus before any keystroke", async () => {
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

      await user.click(screen.getByRole("textbox", { name: /^text/ }));
      // No debounce on focus — the call fires synchronously off the
      // focus handler. A microtask is enough for the response to settle.
      await new Promise((r) => setTimeout(r, 0));
      expect(onCompleteArgument).toHaveBeenCalledWith("text", "", {
        targetLanguage: "",
      });
      expect(await screen.findByText("alpha")).toBeInTheDocument();
    });

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
      // The last call carries the typed value and the context for the
      // other (still empty) sibling.
      expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "al", {
        targetLanguage: "",
      });
      expect(await screen.findByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("alphabet")).toBeInTheDocument();
    });

    it("sends every sibling argument in context, including the unset ones", async () => {
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
      // The completing arg ("text") is excluded from context; every
      // other declared argument rides along — even ones still empty.
      expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "h", {
        targetLanguage: "es",
      });
    });

    it("captures sibling values at fire time, not at schedule time", async () => {
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
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Type into "text" — this schedules a debounced completion call.
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "h");
      // Before the 300ms debounce fires, update the sibling. The
      // text-arg fire that lands at t=300 must see the latest sibling
      // value, not the empty one captured at schedule time.
      await user.type(
        screen.getByRole("textbox", { name: /targetLanguage/ }),
        "es",
      );
      await new Promise((r) => setTimeout(r, 400));

      // The most recent call for "text" carries the up-to-date
      // sibling value, even though it was scheduled before "es" was
      // typed. (There's also a focus-fire call when the second input
      // gained focus — separate stream, not asserted here.)
      const textCalls = onCompleteArgument.mock.calls.filter(
        ([n]) => n === "text",
      );
      expect(textCalls.at(-1)).toEqual(["text", "h", { targetLanguage: "es" }]);
    });

    it("clears stale dropdown options the instant a new keystroke arrives", async () => {
      const user = userEvent.setup();
      const deferred: Array<{
        value: string;
        resolve: (values: string[]) => void;
      }> = [];
      const onCompleteArgument = vi.fn(
        (_argName: string, value: string) =>
          new Promise<string[]>((resolve) => {
            deferred.push({ value, resolve });
          }),
      );

      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Focus → first call (value=""). Resolve so the dropdown has
      // something to show.
      await user.click(screen.getByRole("textbox", { name: /^text/ }));
      await new Promise((r) => setTimeout(r, 0));
      expect(deferred.length).toBe(1);
      deferred[0].resolve(["alpha", "alphabet"]);
      expect(await screen.findByText("alpha")).toBeInTheDocument();

      // Type a new character — the keystroke handler must drop the
      // stale options immediately so the dropdown doesn't show
      // "alpha" / "alphabet" while the next request is in flight
      // (300ms debounce + network latency).
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "z");
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("alphabet")).not.toBeInTheDocument();
    });

    it("aborts an in-flight request when a faster keystroke arrives", async () => {
      const user = userEvent.setup();
      const calls: Array<{
        value: string;
        resolve: (values: string[]) => void;
      }> = [];
      const onCompleteArgument = vi.fn(
        (_argName: string, value: string) =>
          new Promise<string[]>((resolve) => {
            calls.push({ value, resolve });
          }),
      );

      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Focus fires the first call (value=""). Type "h" → second call
      // after debounce. Type "i" → third call after debounce.
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "h");
      await new Promise((r) => setTimeout(r, 350));
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "i");
      await new Promise((r) => setTimeout(r, 350));

      // Resolve the late "h" response — it should be dropped because
      // the form aborted that controller when the "hi" request started.
      const hi = calls.find((c) => c.value === "hi");
      const h = calls.find((c) => c.value === "h");
      expect(hi).toBeDefined();
      expect(h).toBeDefined();
      h?.resolve(["from-stale-h"]);
      hi?.resolve(["from-fresh-hi"]);
      await new Promise((r) => setTimeout(r, 0));

      // The dropdown shows the fresh response, not the stale one.
      expect(await screen.findByText("from-fresh-hi")).toBeInTheDocument();
      expect(screen.queryByText("from-stale-h")).not.toBeInTheDocument();
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
      // Focus the input first, then type — neither should trigger a call.
      await user.click(screen.getByPlaceholderText("Enter text..."));
      await user.type(screen.getByPlaceholderText("Enter text..."), "ab");
      await new Promise((r) => setTimeout(r, 400));
      expect(onCompleteArgument).not.toHaveBeenCalled();
    });
  });
});
