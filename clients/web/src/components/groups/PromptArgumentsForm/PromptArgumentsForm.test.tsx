import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/client";
import {
  renderWithMantine,
  screen,
  waitFor,
  fireEvent,
  act,
} from "../../../test/renderWithMantine";
import { PromptArgumentsForm } from "./PromptArgumentsForm";

// Completion requests are debounced (COMPLETION_DEBOUNCE_MS = 300ms). Rather
// than sleeping past that window on the wall clock — which races the debounce
// timer under instrumented/concurrent load (#1596) — every completion test
// below uses `userEvent.setup({ delay: null })` (no per-keystroke real-timer
// scheduling) and waits on the *real* rendered outcome via `findBy`/`waitFor`.
// Those poll until the debounce fires and the response settles, so they
// resolve as soon as the work is done and never depend on machine speed. A
// scoped 3s timeout covers the debounce + async settle under heavy load.
const SETTLE = { timeout: 3000 } as const;

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
    const user = userEvent.setup({ delay: null });
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

  it("clears an argument via its Clear button (onArgumentChange with empty value)", async () => {
    const user = userEvent.setup({ delay: null });
    const onArgumentChange = vi.fn();
    renderWithMantine(
      <PromptArgumentsForm
        prompt={promptWithArgs}
        argumentValues={{ text: "Hello" }}
        onArgumentChange={onArgumentChange}
        onGetPrompt={vi.fn()}
      />,
    );
    // Non-autocomplete branch (completions unsupported) renders a TextInput
    // with a Clear button whenever the value is non-empty.
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onArgumentChange).toHaveBeenCalledWith("text", "");
  });

  it("invokes onGetPrompt when Get Prompt is clicked", async () => {
    const user = userEvent.setup({ delay: null });
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
    const user = userEvent.setup({ delay: null });
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
      const user = userEvent.setup({ delay: null });
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
      // No debounce on focus — the call fires synchronously off the focus
      // handler; wait on the rendered option rather than a fixed sleep.
      expect(await screen.findByText("alpha")).toBeInTheDocument();
      expect(onCompleteArgument).toHaveBeenCalledWith("text", "", {
        targetLanguage: "",
      });
    });

    it("calls onCompleteArgument (debounced) and surfaces values when supported", async () => {
      const user = userEvent.setup({ delay: null });
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
      // Wait for the debounced response to render, then assert the last call
      // carries the typed value and the (still empty) sibling context.
      expect(
        await screen.findByText("alpha", undefined, SETTLE),
      ).toBeInTheDocument();
      expect(screen.getByText("alphabet")).toBeInTheDocument();
      expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "al", {
        targetLanguage: "",
      });
    });

    it("sends every sibling argument in context, including the unset ones", async () => {
      const user = userEvent.setup({ delay: null });
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
      // The completing arg ("text") is excluded from context; every other
      // declared argument rides along — even ones still empty. Poll until the
      // debounced "text" call lands rather than sleeping past the window.
      await waitFor(
        () =>
          expect(onCompleteArgument).toHaveBeenLastCalledWith("text", "h", {
            targetLanguage: "es",
          }),
        SETTLE,
      );
    });

    it("captures sibling values at fire time, not at schedule time", async () => {
      const user = userEvent.setup({ delay: null });
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
      // Before the 300ms debounce fires, update the sibling. Because typing is
      // synchronous (delay: null), the sibling holds its value well before the
      // debounce window elapses. The text-arg fire must read the sibling at
      // *fire* time, not the empty value captured at schedule time.
      await user.type(
        screen.getByRole("textbox", { name: /targetLanguage/ }),
        "es",
      );

      // Poll until the debounced "text" call fires, then assert it captured a
      // non-empty sibling (read at fire time, not the empty value present when
      // the call was scheduled). With delay:null the sibling is fully typed
      // ("es") before the debounce fires; the /^es?$/ regex stays tolerant.
      await waitFor(() => {
        const textCalls = onCompleteArgument.mock.calls.filter(
          ([n]) => n === "text",
        );
        const lastTextCall = textCalls.at(-1);
        expect(lastTextCall?.[1]).toBe("h");
        expect(lastTextCall?.[2].targetLanguage).toMatch(/^es?$/);
      }, SETTLE);
    });

    it("clears stale dropdown options the instant a new keystroke arrives", async () => {
      const user = userEvent.setup({ delay: null });
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
      await waitFor(() => expect(deferred.length).toBe(1));
      deferred[0].resolve(["alpha", "alphabet"]);
      expect(await screen.findByText("alpha")).toBeInTheDocument();

      // Type a new character — the keystroke handler must drop the stale
      // options synchronously so the dropdown doesn't show "alpha" /
      // "alphabet" while the next request is in flight (300ms debounce +
      // network latency).
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "z");
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("alphabet")).not.toBeInTheDocument();
    });

    it("aborts an in-flight request when a faster keystroke arrives", async () => {
      const user = userEvent.setup({ delay: null });
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

      // Focus fires the first call (value=""). Type "h" → second call after
      // the debounce; wait for it to actually be in flight before typing more.
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "h");
      await waitFor(
        () => expect(calls.some((c) => c.value === "h")).toBe(true),
        SETTLE,
      );
      await user.type(screen.getByRole("textbox", { name: /^text/ }), "i");
      await waitFor(
        () => expect(calls.some((c) => c.value === "hi")).toBe(true),
        SETTLE,
      );

      // Resolve the late "h" response — it should be dropped because
      // the form aborted that controller when the "hi" request started.
      const hi = calls.find((c) => c.value === "hi");
      const h = calls.find((c) => c.value === "h");
      h?.resolve(["from-stale-h"]);
      hi?.resolve(["from-fresh-hi"]);

      // The dropdown shows the fresh response, not the stale one.
      expect(await screen.findByText("from-fresh-hi")).toBeInTheDocument();
      expect(screen.queryByText("from-stale-h")).not.toBeInTheDocument();
    });

    it("surfaces an empty dropdown when the completion request rejects", async () => {
      const user = userEvent.setup({ delay: null });
      // The first (focus) call resolves with options; the debounced
      // keystroke call rejects. The rejection (not aborted) must clear the
      // dropdown to [] rather than leave the stale options showing.
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValueOnce(["alpha", "alphabet"])
        .mockRejectedValueOnce(new Error("completion failed"));

      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      const input = screen.getByRole("textbox", { name: /^text/ });
      await user.click(input);
      expect(await screen.findByText("alpha")).toBeInTheDocument();

      // Type a char → the stale options drop synchronously, and the debounced
      // call then rejects, leaving the dropdown empty. Wait for the second
      // (rejecting) call to fire so the catch → reset-to-[] path runs.
      await user.type(input, "z");
      await waitFor(
        () => expect(onCompleteArgument).toHaveBeenCalledTimes(2),
        SETTLE,
      );
      await waitFor(() => {
        expect(screen.queryByText("alpha")).not.toBeInTheDocument();
        expect(screen.queryByText("alphabet")).not.toBeInTheDocument();
      });
    });

    it("cancels a pending debounce timer when the input is re-focused", async () => {
      // This is the one completion test that must let the 300ms debounce
      // window fully elapse to be meaningful — asserting at t≈0 (as the
      // sibling negative tests do) would pass whether or not handleFocus's
      // clearTimeout actually cancels the pending timer. Fake timers make that
      // window deterministic: we advance the clock directly. The interaction
      // is driven with fireEvent rather than userEvent, because userEvent's
      // async internals deadlock under vitest fake timers with this
      // Mantine/happy-dom stack. This test is load-bearing: if the
      // clearTimeout in handleFocus were removed, the debounce would fire
      // during the advance and the final assertion would fail (verified).
      vi.useFakeTimers();
      try {
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

        const textInput = screen.getByRole("textbox", { name: /^text/ });
        const siblingInput = screen.getByRole("textbox", {
          name: /targetLanguage/,
        });

        // Type into text → schedules the 300ms debounce timer for "text".
        fireEvent.focus(textInput);
        fireEvent.change(textInput, { target: { value: "h" } });
        // Move focus to the sibling and back — the re-focus makes
        // handleFocus("text") see the pending debounce timer and clear it.
        fireEvent.focus(siblingInput);
        fireEvent.focus(textInput);

        // Drop the focus-fire calls made above; only a *debounce* fire after
        // this point would indicate the cancellation failed.
        onCompleteArgument.mockClear();

        // Elapse well past the debounce window. The cancelled timer must not
        // fire a stale keystroke completion.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });

        const textCalls = onCompleteArgument.mock.calls.filter(
          ([n]) => n === "text",
        );
        expect(textCalls.length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not call onCompleteArgument when completions are unsupported", async () => {
      const user = userEvent.setup({ delay: null });
      const onCompleteArgument = vi.fn();
      renderWithMantine(
        <StatefulForm
          prompt={promptWithArgs}
          onGetPrompt={vi.fn()}
          completionsSupported={false}
          onCompleteArgument={onCompleteArgument}
        />,
      );
      // Focus the input first, then type — neither path is wired to
      // completions, so no request is ever scheduled or fired.
      await user.click(screen.getByPlaceholderText("Enter text..."));
      await user.type(screen.getByPlaceholderText("Enter text..."), "ab");
      expect(onCompleteArgument).not.toHaveBeenCalled();
    });
  });
});
