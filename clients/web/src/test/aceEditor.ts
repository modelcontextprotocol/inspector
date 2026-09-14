import { act, screen } from "@testing-library/react";
import type { Ace } from "ace-builds";

/**
 * Reach the live Ace editor a component mounted, and drive it.
 *
 * Typing is deliberately **not** simulated. Ace reads keystrokes through a 1px
 * offscreen textarea plus selection and composition state that happy-dom does
 * not implement, so `userEvent.type` reaches the element and produces no edit
 * at all — a test written that way asserts nothing while looking like it
 * asserts a lot. Real keyboard behaviour (auto-closing a brace on Enter, and
 * the draft surviving invalid text) is covered by the `JsonObjectInput`
 * Storybook play functions, which run in Chromium.
 *
 * Ace hangs the instance off its container element as `env.editor`; that is the
 * supported way back to it from the DOM.
 */
export function getAceEditor(container: ParentNode = document): Ace.Editor {
  const node = container.querySelector(".ace_editor");
  const editor = (
    node as (HTMLElement & { env?: { editor?: Ace.Editor } }) | null
  )?.env?.editor;
  if (!editor) throw new Error("Ace editor not mounted");
  return editor;
}

/** The document the editor currently holds. */
export function getAceText(container?: ParentNode): string {
  return getAceEditor(container).getValue();
}

/**
 * Replace the document the way a select-all-and-retype would, and let React
 * flush.
 *
 * Async because `JsonObjectInput` coalesces the paired remove/insert events
 * Ace fires for a replace; an `await act` is what drains that microtask.
 */
export async function setAceText(
  text: string,
  container?: ParentNode,
): Promise<void> {
  await act(async () => {
    // `1` parks the cursor at the end, matching where typing would leave it.
    getAceEditor(container).setValue(text, 1);
  });
}

/**
 * Matcher for an Ace-labelled control.
 *
 * Ace composes its text input's `aria-label` as `"<label>, Cursor at row N"`,
 * so an exact-string `getByLabelText` never matches — the position readout is
 * Ace's, only the prefix is ours.
 */
export function aceLabel(label: string): RegExp {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/**
 * The editor whose accessible name matches `label`, for a screen holding more
 * than one — a form with two JSON fields, or a JSON field beside the
 * raw-arguments editor.
 *
 * Goes via the labelled text input rather than indexing `.ace_editor` nodes,
 * because document order is not something a test should depend on: adding a
 * field above the one under test would silently retarget every assertion.
 */
export function getAceEditorByLabel(label: string | RegExp): Ace.Editor {
  const input = screen.getByLabelText(
    typeof label === "string" ? aceLabel(label) : label,
  );
  const container = input.closest(".ace_editor");
  const editor = (
    container as (HTMLElement & { env?: { editor?: Ace.Editor } }) | null
  )?.env?.editor;
  if (!editor) throw new Error(`No Ace editor labelled ${String(label)}`);
  return editor;
}

/** {@link getAceText} for one of several editors. */
export function getAceTextByLabel(label: string | RegExp): string {
  return getAceEditorByLabel(label).getValue();
}

/** {@link setAceText} for one of several editors. */
export async function setAceTextByLabel(
  label: string | RegExp,
  text: string,
): Promise<void> {
  const editor = getAceEditorByLabel(label);
  await act(async () => {
    editor.setValue(text, 1);
  });
}
