import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { aceLabel, getAceText, setAceText } from "../../../test/aceEditor";
import { JsonEditor } from "./JsonEditor";

const LABEL = "Payload JSON";

/** Controlled on text, which is the contract every consumer uses. */
function Harness({
  initial,
  onChange,
}: {
  initial: string;
  onChange?: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <JsonEditor
      ariaLabel={LABEL}
      value={text}
      onChange={(next) => {
        setText(next);
        onChange?.(next);
      }}
    />
  );
}

describe("JsonEditor", () => {
  it("names the editor for assistive tech", () => {
    renderWithMantine(<Harness initial="" />);
    // Ace composes "<label>, Cursor at row N", so the match is by substring —
    // the position readout is Ace's, the name is ours.
    expect(screen.getByLabelText(aceLabel(LABEL))).toBeInTheDocument();
  });

  // Ace recomputes the textarea's `aria-label` from its option only when the
  // cursor moves, so a name that changes while the editor stays mounted — a
  // tool refreshed in place under a new field title — would leave the visible
  // label and the accessible name disagreeing until the user clicked into it.
  it("re-applies the accessible name when it changes in place", () => {
    const { rerender } = renderWithMantine(
      <JsonEditor ariaLabel="Series JSON" value="" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(aceLabel("Series JSON"))).toBeInTheDocument();

    rerender(
      <JsonEditor ariaLabel="Data points JSON" value="" onChange={vi.fn()} />,
    );
    expect(
      screen.getByLabelText(aceLabel("Data points JSON")),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(aceLabel("Series JSON"))).toBeNull();
  });

  it("shows the text it is given, verbatim", () => {
    // Braces, not a bare JSX string: a JSX string attribute does not process
    // escapes, so `'…\n…'` written inline would be a literal backslash-n.
    renderWithMantine(<Harness initial={'{\n  "a": 1\n}'} />);
    expect(getAceText()).toBe('{\n  "a": 1\n}');
  });

  it("reports the settled text of an edit", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial="" onChange={onChange} />);
    await setAceText('{"a":1}');
    expect(onChange).toHaveBeenLastCalledWith('{"a":1}');
  });

  // Ace fires a *remove* then an *insert* for a replace. Reporting the first
  // would tell the consumer the document is empty, which for `JsonObjectInput`
  // means `{}` — the user's saved metadata, wiped a keystroke before the
  // replacement lands.
  it("reports a replace once, not as an empty document first", async () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness initial='{"keep":1}' onChange={onChange} />);
    await setAceText('{"next":2}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('{"next":2}');
  });

  it("uses Ace's dark theme under a dark color scheme", () => {
    renderWithMantine(<Harness initial="" />, { colorScheme: "dark" });
    // `ace-github-dark`, hyphenated — Ace's cssClass, not the module name
    // (`theme-github_dark`). The App.css gutter-contrast override keys off this
    // same class, so getting it wrong silently drops the fix in dark mode.
    expect(document.querySelector(".ace-github-dark")).not.toBeNull();
    expect(document.querySelector(".ace-github")).toBeNull();
  });

  it("uses Ace's light theme under a light color scheme", () => {
    renderWithMantine(<Harness initial="" />, { colorScheme: "light" });
    expect(document.querySelector(".ace-github")).not.toBeNull();
    expect(document.querySelector(".ace-github_dark")).toBeNull();
  });

  describe("wrapper wiring", () => {
    it("associates the label, description and error with the editor", () => {
      renderWithMantine(
        <JsonEditor
          ariaLabel={LABEL}
          value=""
          onChange={vi.fn()}
          label="Metadata"
          description="Sent with every request."
          error="Not valid JSON"
        />,
      );
      const input = screen.getByLabelText(aceLabel(LABEL));
      expect(input).toHaveAttribute("aria-invalid", "true");
      const describedBy = input.getAttribute("aria-describedby")?.split(" ");
      expect(describedBy).toHaveLength(2);
      // Both nodes exist and are the ones named — a description that is never
      // announced, or an error pointing at nothing, is the failure mode here.
      for (const id of describedBy ?? []) {
        expect(document.getElementById(id)).toBeInTheDocument();
      }
      expect(screen.getByText("Not valid JSON")).toBeInTheDocument();
    });

    it("drops the error wiring once the text is valid again", () => {
      const { rerender } = renderWithMantine(
        <JsonEditor
          ariaLabel={LABEL}
          value=""
          onChange={vi.fn()}
          error="Not valid JSON"
        />,
      );
      rerender(<JsonEditor ariaLabel={LABEL} value="" onChange={vi.fn()} />);
      const input = screen.getByLabelText(aceLabel(LABEL));
      expect(input).not.toHaveAttribute("aria-invalid");
      expect(input).not.toHaveAttribute("aria-describedby");
    });
  });

  describe("read-only", () => {
    it("is read-only when no change handler is supplied", () => {
      renderWithMantine(<JsonEditor ariaLabel={LABEL} value='{"a":1}' />);
      expect(getAceText()).toBe('{"a":1}');
      expect(document.querySelector(".json-editor-readonly")).not.toBeNull();
    });

    it("is read-only when asked, even with a handler", () => {
      renderWithMantine(
        <JsonEditor
          ariaLabel={LABEL}
          value='{"a":1}'
          onChange={vi.fn()}
          readOnly
        />,
      );
      expect(document.querySelector(".json-editor-readonly")).not.toBeNull();
    });

    // Ace has no disabled state, so its hidden textarea keeps `tabindex="0"`
    // unless something takes it out — leaving a keyboard user able to tab into
    // a field the rest of the form has switched off, with nothing announced.
    it("leaves the tab order and says so when disabled", () => {
      const { rerender } = renderWithMantine(
        <JsonEditor ariaLabel={LABEL} value='{"a":1}' onChange={vi.fn()} />,
      );
      const input = screen.getByLabelText(aceLabel(LABEL));
      expect(input).toHaveAttribute("tabindex", "0");
      expect(input).not.toHaveAttribute("aria-disabled");

      rerender(
        <JsonEditor
          ariaLabel={LABEL}
          value='{"a":1}'
          onChange={vi.fn()}
          disabled
        />,
      );
      expect(input).toHaveAttribute("tabindex", "-1");
      expect(input).toHaveAttribute("aria-disabled", "true");

      // …and both are restored when the form re-enables.
      rerender(
        <JsonEditor ariaLabel={LABEL} value='{"a":1}' onChange={vi.fn()} />,
      );
      expect(input).toHaveAttribute("tabindex", "0");
      expect(input).not.toHaveAttribute("aria-disabled");
    });

    // Read-only is not disabled: a payload the user may need to scroll past the
    // bottom of has to be reachable by keyboard (WCAG SC 2.1.1), which is why
    // the preformatted block this replaced carried `tabIndex={0}`.
    it("stays focusable when merely read-only", () => {
      renderWithMantine(<JsonEditor ariaLabel={LABEL} value='{"a":1}' />);
      const input = screen.getByLabelText(aceLabel(LABEL));
      expect(input).toHaveAttribute("tabindex", "0");
      expect(input).not.toHaveAttribute("aria-disabled");
    });

    it("is read-only and dimmed when disabled", () => {
      const { container } = renderWithMantine(
        <JsonEditor
          ariaLabel={LABEL}
          value='{"a":1}'
          onChange={vi.fn()}
          disabled
        />,
      );
      expect(document.querySelector(".json-editor-readonly")).not.toBeNull();
      // The only affordance a pointer user gets, since Ace has no disabled
      // state of its own.
      expect(container.querySelector('[style*="opacity: 0.6"]')).not.toBeNull();
    });

    // Read-only is derived state, so both transitions happen to an editor that
    // is already mounted — and react-ace's `componentDidUpdate` reads
    // `prevProps.className.trim()` with no guard when the class changes. An
    // `undefined` on either side of that swap throws, or writes the literal
    // class name "undefined" onto the element.
    it("becomes editable when a handler arrives", () => {
      const { rerender } = renderWithMantine(
        <JsonEditor ariaLabel={LABEL} value='{"a":1}' />,
      );
      expect(document.querySelector(".json-editor-readonly")).not.toBeNull();
      rerender(
        <JsonEditor ariaLabel={LABEL} value='{"a":1}' onChange={vi.fn()} />,
      );
      expect(document.querySelector(".json-editor-readonly")).toBeNull();
      expect(document.querySelector(".undefined")).toBeNull();
    });

    // The direction a tool form takes when a call goes in flight: the panel
    // disables the whole form, so an editable editor becomes read-only in
    // place. This threw before the class was made unconditionally a string.
    it("becomes read-only when the form is disabled mid-edit", () => {
      const { rerender } = renderWithMantine(
        <JsonEditor ariaLabel={LABEL} value='{"a":1}' onChange={vi.fn()} />,
      );
      expect(document.querySelector(".json-editor-readonly")).toBeNull();
      rerender(
        <JsonEditor
          ariaLabel={LABEL}
          value='{"a":1}'
          onChange={vi.fn()}
          disabled
        />,
      );
      expect(document.querySelector(".json-editor-readonly")).not.toBeNull();
    });
  });
});
