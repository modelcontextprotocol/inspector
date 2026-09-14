import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { StrictJsonObject } from "@inspector/core/json/jsonUtils.js";
import { JsonObjectInput } from "./JsonObjectInput";

const LABEL = "Request metadata JSON";

/**
 * The component is controlled, so every story drives it through a small
 * stateful wrapper — otherwise the editor would not accept a keystroke and the
 * play functions could not exercise the draft behavior at all.
 *
 * These stories run in real Chromium, which is what makes them the *only*
 * place Ace's keyboard behavior can be tested: the unit suite runs in
 * happy-dom, where Ace's hidden-textarea input path does not work at all.
 */
function ControlledJsonObjectInput({ initial }: { initial: StrictJsonObject }) {
  const [value, setValue] = useState<StrictJsonObject>(initial);
  return (
    <JsonObjectInput
      label="Request metadata"
      ariaLabel={LABEL}
      value={value}
      onChange={setValue}
    />
  );
}

const meta: Meta<typeof ControlledJsonObjectInput> = {
  title: "Elements/JsonObjectInput",
  component: ControlledJsonObjectInput,
};

export default meta;
type Story = StoryObj<typeof ControlledJsonObjectInput>;

/** The live editor instance, which Ace hangs off its container as `env.editor`. */
function aceEditor(canvasElement: HTMLElement): {
  focus(): void;
  selectAll(): void;
  getValue(): string;
  session: { getAnnotations(): { row: number; type: string }[] };
} {
  const container = canvasElement.querySelector(".ace_editor");
  const editor = (
    container as
      | (HTMLElement & {
          env?: {
            editor?: {
              focus(): void;
              selectAll(): void;
              getValue(): string;
              session: { getAnnotations(): { row: number; type: string }[] };
            };
          };
        })
      | null
  )?.env?.editor;
  if (!editor) throw new Error("Ace editor not mounted");
  return editor;
}

/**
 * Focus the editor and empty it, so the next keystrokes are the whole document
 * and the typing itself — the thing under test — is left to `userEvent`.
 *
 * Emptied rather than merely selected: typing an opening brace or quote with a
 * selection makes Ace **wrap** the selection instead of replacing it, so typing
 * `{` over a selected `{}` yields `{{}}` and the assertion stops being about
 * auto-closing at all.
 *
 * Focus and select go through Ace's API on purpose. `userEvent.click` does not
 * focus the editor — Ace's input is a 1px offscreen textarea, so the click
 * lands nowhere and the keystrokes reach the body instead. And select-all is
 * not `Control+A` everywhere (Ace binds `Cmd-A` on mac), so pressing it would
 * make these stories pass or fail by host OS.
 */
async function focusAndClear(canvasElement: HTMLElement): Promise<void> {
  const editor = aceEditor(canvasElement);
  editor.focus();
  editor.selectAll();
  await userEvent.keyboard("{Backspace}");
}

/** Ace renders each token in its own element, so read the document, not text. */
function editorText(canvasElement: HTMLElement): string {
  return aceEditor(canvasElement).getValue();
}

/** A structured payload renders as formatted JSON, nesting intact. */
export const Populated: Story = {
  args: {
    initial: {
      tenant: "acme",
      trace: { id: "abc123", sampled: true },
      features: ["apps", "tasks"],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(JSON.parse(editorText(canvasElement))).toEqual({
      tenant: "acme",
      trace: { id: "abc123", sampled: true },
      features: ["apps", "tasks"],
    });
  },
};

/** An empty payload opens as `{}` and carries no error. */
export const Empty: Story = {
  args: { initial: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(editorText(canvasElement)).toBe("{}");
    await expect(canvas.queryByText(/Not valid JSON/)).toBeNull();
  },
};

/**
 * Opening a brace closes it — one of the two reasons this is an editor rather
 * than a textarea, and the thing that makes hand-writing a nested `_meta`
 * payload bearable.
 *
 * Deliberately one keystroke: Ace also auto-pairs quotes and skips over a
 * closing character you type yourself, so a longer sequence asserts the sum of
 * several behaviours and stops being a readable statement about this one.
 */
export const ClosesBracesWhileTyping: Story = {
  args: { initial: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await focusAndClear(canvasElement);
    // `{{` is userEvent's escape for a literal `{`.
    await userEvent.keyboard("{{");
    // Ace does not close it on the keystroke — an opening brace at the end of a
    // line is often the start of a block the user is about to fill in.
    await expect(editorText(canvasElement)).toBe("{");
    // Enter is what completes the pair, leaving the cursor indented between
    // them. This is the behaviour that makes writing nested `_meta` by hand
    // bearable, and the reason this is an editor rather than a textarea.
    await userEvent.keyboard("{Enter}");
    await expect(editorText(canvasElement)).toBe("{\n  \n}");
    // The result parses, so nothing is flagged.
    await expect(canvas.queryByText(/Not valid JSON/)).toBeNull();
  },
};

/**
 * Half-typed text is displayed as typed and flagged, rather than being
 * re-escaped back into the box each keystroke (the #1928 failure this draft
 * split exists to avoid).
 */
export const InvalidDraft: Story = {
  args: { initial: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await focusAndClear(canvasElement);
    // Genuinely half-typed — the state a user is in partway through writing an
    // entry, rather than a contrived bad string.
    await userEvent.keyboard('{{"a":');
    // Shown exactly as typed. The old textarea re-escaped its own contents on
    // every keystroke here, which is what made it unusable (#1928).
    await expect(editorText(canvasElement)).toBe('{"a":');
    await expect(await canvas.findByText(/Not valid JSON/)).toBeVisible();
  },
};

/**
 * Valid JSON that is not an object is rejected with its own message, distinct
 * from unparseable text.
 *
 * A bare number rather than an array: brackets are auto-paired too, so typing
 * one would test the pairing as much as the rejection.
 */
export const NotAnObject: Story = {
  args: { initial: {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await focusAndClear(canvasElement);
    await userEvent.keyboard("42");
    await expect(editorText(canvasElement)).toBe("42");
    await expect(
      await canvas.findByText(/Must be a JSON object/),
    ).toBeVisible();
  },
};

/**
 * The JSON worker marks the offending line in the gutter — the reason this
 * component registers `worker-json` through `ace.config.setModuleUrl` with a
 * Vite `?url` asset.
 *
 * Asserted because nothing else covers it: the worker runs out-of-process, so
 * if its URL registration breaks, Ace fails to start it and silently falls back
 * to no annotations. Every other test here — including the wrapper's own
 * "Not valid JSON" message, which comes from our parser, not from Ace — would
 * still pass while the gutter diagnostics quietly disappeared.
 */
export const AnnotatesTheOffendingLine: Story = {
  args: { initial: {} },
  play: async ({ canvasElement }) => {
    await focusAndClear(canvasElement);
    // A trailing comma on line 2: valid-looking until the closing brace, so the
    // worker has to locate it rather than just reject the document.
    await userEvent.keyboard('{{"a": 1,{Enter}}');
    await waitFor(
      async () => {
        const annotations = aceEditor(canvasElement).session.getAnnotations();
        await expect(annotations.length).toBeGreaterThan(0);
        await expect(annotations.some((a) => a.type === "error")).toBe(true);
      },
      // The worker is asynchronous, starts out of process and debounces its
      // result, so this needs a real wait rather than a tick — and a budget
      // that survives a loaded machine, where 5000ms did not (#2292). It also
      // has to stay under the storybook project's `testTimeout`, or the test is
      // killed before the wait can report what it saw.
      { timeout: 10000 },
    );
  },
};
