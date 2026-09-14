import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import type { StrictJsonObject } from "@inspector/core/json/jsonUtils.js";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { aceLabel, getAceText, setAceText } from "../../../test/aceEditor";
import { JsonObjectInput } from "./JsonObjectInput";

const LABEL = "Payload JSON";

/** Controlled harness: the component never owns the value, only the draft. */
function Harness({
  initial,
  onChange,
}: {
  initial: StrictJsonObject;
  onChange?: (v: StrictJsonObject) => void;
}) {
  const [value, setValue] = useState<StrictJsonObject>(initial);
  return (
    <>
      <JsonObjectInput
        ariaLabel={LABEL}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <output data-testid="emitted">{JSON.stringify(value)}</output>
    </>
  );
}

describe("JsonObjectInput", () => {
  it("names the editor for assistive tech", () => {
    renderWithMantine(<Harness initial={{}} />);
    // Ace composes "<label>, Cursor at row N", so the match is by substring —
    // the position readout is Ace's, the name is ours.
    expect(screen.getByLabelText(aceLabel(LABEL))).toBeInTheDocument();
  });

  it("uses Ace's dark theme under a dark color scheme", () => {
    // The editor picks its Ace theme from the computed scheme rather than
    // inheriting Mantine tokens, so the dark branch is only exercised by
    // actually rendering dark.
    renderWithMantine(<Harness initial={{}} />, { colorScheme: "dark" });
    // `ace-github-dark`, hyphenated — Ace's cssClass, not the module name
    // (`theme-github_dark`). The App.css gutter-contrast override keys off this
    // same class, so getting it wrong silently drops the fix in dark mode.
    expect(document.querySelector(".ace-github-dark")).not.toBeNull();
    expect(document.querySelector(".ace-github")).toBeNull();
  });

  it("uses Ace's light theme under a light color scheme", () => {
    renderWithMantine(<Harness initial={{}} />, { colorScheme: "light" });
    expect(document.querySelector(".ace-github")).not.toBeNull();
    expect(document.querySelector(".ace-github_dark")).toBeNull();
  });

  it("opens with the value serialized two-space, nesting intact", () => {
    renderWithMantine(<Harness initial={{ a: { b: [1, 2] } }} />);
    expect(getAceText()).toBe(
      '{\n  "a": {\n    "b": [\n      1,\n      2\n    ]\n  }\n}',
    );
  });

  it("emits the parsed object — a structured value stays structured", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial={{}} onChange={onChange} />);
    await setAceText('{"trace":{"id":"x"},"n":3}');
    expect(onChange).toHaveBeenLastCalledWith({ trace: { id: "x" }, n: 3 });
  });

  // Also the regression test for the paired-event bug `handleChange` coalesces:
  // `setValue` is a remove followed by an insert, and acting on the remove
  // emitted `{}` and wiped `keep` before the insert had landed.
  it("shows the text as typed while it is invalid and does not emit", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial={{ keep: "me" }} onChange={onChange} />);
    await setAceText('{"a":');
    // Displayed verbatim — not re-escaped back through JSON.stringify.
    expect(getAceText()).toBe('{"a":');
    expect(
      screen.getByText("Not valid JSON — changes are not applied"),
    ).toBeInTheDocument();
    // Nothing emitted, so the caller still holds the last valid object.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("emitted").textContent).toBe('{"keep":"me"}');
  });

  it("flags valid JSON that is not an object without emitting", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial={{ keep: "me" }} onChange={onChange} />);
    await setAceText("[1]");
    expect(screen.getByText(/Must be a JSON object/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats a cleared editor as the empty object", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial={{ a: 1 }} onChange={onChange} />);
    await setAceText("");
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(screen.queryByText(/Not valid JSON/)).toBeNull();
  });

  it("re-syncs when the parent's value diverges from the draft", async () => {
    // An external reset (switching servers, a reloaded catalog) must reach the
    // editor; an in-progress edit must not be overwritten by what it emitted.
    function Externally() {
      const [value, setValue] = useState<StrictJsonObject>({ a: 1 });
      return (
        <>
          <JsonObjectInput
            ariaLabel={LABEL}
            value={value}
            onChange={setValue}
          />
          <button onClick={() => setValue({ b: 2 })}>reset</button>
        </>
      );
    }
    renderWithMantine(<Externally />);
    await act(async () => {
      screen.getByRole("button", { name: "reset" }).click();
    });
    expect(JSON.parse(getAceText())).toEqual({ b: 2 });
  });

  it("applies an external value it showed before (A → B → A)", async () => {
    // Regression: `echoed` used to hold only what this component last emitted,
    // so returning to a previously-shown value matched the stale entry and was
    // dismissed as our own echo, stranding the editor on B.
    function Externally({ value }: { value: StrictJsonObject }) {
      return (
        <JsonObjectInput ariaLabel={LABEL} value={value} onChange={() => {}} />
      );
    }
    const { rerender } = renderWithMantine(<Externally value={{ a: 1 }} />);
    expect(JSON.parse(getAceText())).toEqual({ a: 1 });

    rerender(<Externally value={{ b: 2 }} />);
    expect(JSON.parse(getAceText())).toEqual({ b: 2 });

    // Back to the first value — a distinct object, same content.
    rerender(<Externally value={{ a: 1 }} />);
    expect(JSON.parse(getAceText())).toEqual({ a: 1 });
  });

  describe("wiring to the Input.Wrapper label and error", () => {
    /** Ace's hidden textarea — the element the wrapper has to point at. */
    function textarea(): HTMLTextAreaElement {
      const el = document.querySelector<HTMLTextAreaElement>(
        "textarea.ace_text-input",
      );
      if (!el) throw new Error("Ace text input not mounted");
      return el;
    }

    it("gives two instances distinct DOM ids", () => {
      // react-ace uses `name` as the container id; a fixed value would put
      // duplicate ids in the document as soon as a second editor renders.
      renderWithMantine(
        <>
          <JsonObjectInput ariaLabel="First" value={{}} onChange={() => {}} />
          <JsonObjectInput ariaLabel="Second" value={{}} onChange={() => {}} />
        </>,
      );
      const containerIds = Array.from(
        document.querySelectorAll(".ace_editor"),
      ).map((n) => n.id);
      const inputIds = Array.from(
        document.querySelectorAll("textarea.ace_text-input"),
      ).map((n) => n.id);
      expect(containerIds).toHaveLength(2);
      expect(new Set([...containerIds, ...inputIds]).size).toBe(4);
      expect(containerIds.concat(inputIds).every((id) => id !== "")).toBe(true);
    });

    it("lets the visible label focus the editor", () => {
      renderWithMantine(
        <JsonObjectInput
          label="Request metadata"
          ariaLabel={LABEL}
          value={{}}
          onChange={() => {}}
        />,
      );
      // `Input.Wrapper` renders `<label for={id}>`; the editor is only
      // reachable from it if Ace's textarea carries that same id.
      const label = screen.getByText("Request metadata");
      expect(label.getAttribute("for")).toBe(textarea().id);
      expect(textarea().id).not.toBe("");
    });

    it("marks the editor invalid and points it at the error text", async () => {
      renderWithMantine(<Harness initial={{}} />);
      expect(textarea().getAttribute("aria-invalid")).toBeNull();

      await setAceText("[1]");
      expect(textarea().getAttribute("aria-invalid")).toBe("true");
      const describedBy = textarea().getAttribute("aria-describedby");
      expect(describedBy).not.toBeNull();
      // The id must resolve to the message actually on screen.
      expect(document.getElementById(describedBy!)?.textContent).toMatch(
        /Must be a JSON object/,
      );
    });

    it("announces a supplied description, and keeps it when the draft breaks", async () => {
      function WithDescription() {
        const [value, setValue] = useState<StrictJsonObject>({});
        return (
          <JsonObjectInput
            ariaLabel={LABEL}
            description="Sent with every request"
            value={value}
            onChange={setValue}
          />
        );
      }
      renderWithMantine(<WithDescription />);

      const described = () =>
        (textarea().getAttribute("aria-describedby") ?? "")
          .split(" ")
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent);

      // Valid draft: described by the description alone.
      expect(described()).toEqual(["Sent with every request"]);

      // Invalid draft: the error joins it rather than replacing it — the
      // description is still true, and dropping it would silently un-describe
      // the control at the moment it needs explaining most.
      await setAceText("[1]");
      expect(described()).toHaveLength(2);
      expect(described()[0]).toBe("Sent with every request");
      expect(described()[1]).toMatch(/Must be a JSON object/);
    });

    it("clears the invalid marking once the text parses again", async () => {
      renderWithMantine(<Harness initial={{}} />);
      await setAceText("[1]");
      expect(textarea().getAttribute("aria-invalid")).toBe("true");
      await setAceText('{"a":1}');
      expect(textarea().getAttribute("aria-invalid")).toBeNull();
      expect(textarea().getAttribute("aria-describedby")).toBeNull();
    });
  });

  it("leaves an in-progress edit alone when the parent echoes it back", async () => {
    renderWithMantine(<Harness initial={{}} />);
    // The parent re-renders with the object this text parsed to; the draft must
    // not be reformatted out from under the cursor.
    await setAceText('{"a":1}');
    expect(getAceText()).toBe('{"a":1}');
  });
});
