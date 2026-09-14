import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Input, Paper, useComputedColorScheme } from "@mantine/core";
import type { Ace } from "ace-builds";
import AceEditor from "react-ace";
import ace from "ace-builds/src-noconflict/ace";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/theme-github_dark";
// `?url` so Vite emits the worker as its own asset and hands back a real URL.
// Without it Ace fetches `worker-json.js` from a path that does not exist in a
// bundled app, silently loses its annotations, and logs a fetch error.
import jsonWorkerUrl from "ace-builds/src-noconflict/worker-json.js?url";

// Module scope: registering the worker URL is global to Ace and idempotent, so
// it must not be repeated per mount.
ace.config.setModuleUrl("ace/mode/json_worker", jsonWorkerUrl);

/**
 * The editor's frame.
 *
 * Ace paints its own background edge to edge with nothing around it, so an
 * editor dropped into a panel reads as a discoloured patch rather than as a
 * field — most visibly on the Tools tab, where "Edit as JSON" replaces a column
 * of bordered inputs with one borderless slab. The border gives it the same
 * edge every Mantine input beside it has.
 *
 * `variant="contained"` supplies the `overflow: hidden` that makes the rounded
 * corners actually clip Ace's square background; without it the corners are
 * painted over and the radius is invisible.
 */
const EditorFrame = Paper.withProps({
  variant: "contained",
  withBorder: true,
  radius: "sm",
});

export interface JsonEditorProps {
  /**
   * The text the editor displays. This is a **text** contract, not a JSON one:
   * the editor never parses, so a caller holding a value keeps its own draft
   * text and decides for itself what an unparseable draft means.
   */
  value: string;
  /**
   * Settled text after an edit. Omitted for a read-only editor.
   *
   * Called once per edit, not once per Ace change event — see the coalescing
   * note on `handleChange`.
   */
  onChange?: (text: string) => void;
  /**
   * Display only: no caret, no editing, and no JSON worker (its annotations
   * describe a document the user cannot fix). Implied when `onChange` is
   * omitted.
   */
  readOnly?: boolean;
  /**
   * Accessible name for the editor's text input. Ace labels its hidden
   * textarea "Cursor at row N" by default, which is a position readout rather
   * than a name — so this is what makes the control identifiable to a screen
   * reader, and what `getByLabelText` finds in a test.
   */
  ariaLabel: string;
  label?: ReactNode;
  description?: ReactNode;
  /** Rendered by the wrapper and referenced from the editor's `aria-describedby`. */
  error?: ReactNode;
  withAsterisk?: boolean;
  /**
   * Non-editable *and* visibly inert, for a form whose whole surface is
   * disabled. Ace has no disabled state of its own, so this is read-only plus
   * a dimmed wrapper.
   */
  disabled?: boolean;
  /** Rows shown before the editor grows; it autosizes between these bounds. */
  minLines?: number;
  maxLines?: number;
}

/**
 * The Ace-backed JSON editor every JSON-typing and JSON-displaying surface in
 * the web client renders (#2151).
 *
 * Ace rather than a plain textarea because hand-writing JSON in a bare box is
 * the actual pain: Ace closes a brace when you open one, folds a nested
 * payload, numbers its lines, and — via its JSON worker — marks the offending
 * line in the gutter instead of reporting one message for the whole document.
 * Read-only it keeps the folding and the line numbers, which is what a large
 * response payload gains over a preformatted block.
 *
 * Deliberately **text in, text out**. The two editing contracts above it want
 * different things from an unparseable draft — `JsonObjectInput` keeps the last
 * valid object and says nothing to its parent, `SchemaJsonField` reports
 * `undefined` and blocks submission — and neither can be expressed by a
 * component that decides what a draft means. So parsing, and the draft/value
 * split that goes with it, belongs to each caller; only the editing surface is
 * shared.
 */
export function JsonEditor({
  value,
  onChange,
  readOnly,
  ariaLabel,
  label,
  description,
  error,
  withAsterisk,
  disabled = false,
  minLines = 6,
  maxLines = 24,
}: JsonEditorProps) {
  // `getInitialValueInEffect: false` so the first render already has the real
  // scheme; otherwise the editor mounts light and repaints, which is visible.
  const colorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: false,
  });

  // Text from the most recent change event in the current tick, and whether a
  // flush is already queued to consume it. Two refs rather than one nullable
  // one so the flush reads a plain `string` — folding them together would add
  // a null check that nothing can ever satisfy. See `handleChange`.
  const pendingTextRef = useRef("");
  const flushScheduledRef = useRef(false);
  // Read through a ref so the coalescing flush always calls the current
  // handler, without the handler's identity being part of any dependency list.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  /**
   * Coalesce the change events Ace fires within one edit, and act on the last.
   *
   * A replace — select-all-and-retype, or a paste over a selection — is a
   * *remove* followed by an *insert*, and Ace fires a change event for each.
   * Acting on the first would report the momentarily-empty document as the
   * user's answer: for `JsonObjectInput` that is `{}`, which overwrites the
   * metadata they had just selected; for a raw-JSON form it is a cleared
   * arguments object. If the replacement text then failed to parse, that empty
   * value is what they would be left with.
   *
   * A microtask is enough because both events are dispatched synchronously
   * inside the same edit, so the flush sees only the settled text.
   */
  const handleChange = (text: string) => {
    pendingTextRef.current = text;
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      onChangeRef.current?.(pendingTextRef.current);
    });
  };

  const wrapperId = useId();
  const editorRef = useRef<Ace.Editor | null>(null);
  const isReadOnly = readOnly === true || disabled || onChange === undefined;
  const hasError = error !== undefined && error !== null && error !== false;

  // `Input.Wrapper` labels and describes a Mantine input through context. Ace
  // is not one — it renders its own DOM — so the wrapper's label and error node
  // exist but point at nothing, leaving the control unassociated with the error
  // a screen reader needs and its visible label inert on click.
  //
  // A genuine external-system sync, so an effect rather than `useValueChange`:
  // it writes to a DOM node React does not own. Giving the textarea the
  // wrapper's own id is what makes the `<label for>` focus the editor; the
  // error wiring follows Mantine's `${id}-error` naming.
  useEffect(() => {
    const editor = editorRef.current;
    const element = editor?.textInput.getElement();
    /* v8 ignore next -- the ref is set in `onLoad`, which react-ace calls
       synchronously on mount, so this effect always sees an element. */
    if (!editor || !element) return;
    element.id = wrapperId;

    // Re-apply the accessible name, not just set it once at mount.
    //
    // `setOptions` does update Ace's *option* when `ariaLabel` changes, but Ace
    // only recomputes the textarea's `aria-label` from it inside
    // `TextInput.setAriaLabel()`, which it calls when the cursor moves. So a
    // name that changes while the editor stays mounted — a tool refreshed in
    // place under a new field title, which `SchemaJsonField` passes straight
    // through — leaves the visible label and the accessible name disagreeing
    // until the user happens to click into the box.
    //
    // `onLoad` still does this too: an effect runs after paint, and this is the
    // control's only name, so mount should not present a frame without it.
    editor.setOption("textInputAriaLabel", ariaLabel);
    editor.textInput.setAriaLabel();

    // Both the description and the error are rendered by the wrapper and both
    // describe this control, so both ids belong here — a supplied description
    // is otherwise never announced, and it must not be dropped just because the
    // draft went invalid. Mantine renders each only when its prop is set, so
    // referencing an absent one would point at nothing.
    const describedBy = [
      description === undefined ? null : `${wrapperId}-description`,
      hasError ? `${wrapperId}-error` : null,
    ].filter((id) => id !== null);

    if (describedBy.length > 0) {
      element.setAttribute("aria-describedby", describedBy.join(" "));
    } else {
      element.removeAttribute("aria-describedby");
    }

    if (hasError) {
      element.setAttribute("aria-invalid", "true");
    } else {
      element.removeAttribute("aria-invalid");
    }

    // `disabled` and `readOnly` are different states here, and only one of them
    // leaves the tab order.
    //
    // A **read-only** editor is a rendering of a payload the user may need to
    // read past the bottom of, so it stays focusable — the same reason the
    // preformatted block it replaced carries `tabIndex={0}` (WCAG SC 2.1.1).
    //
    // A **disabled** one is a control the rest of the form has switched off. Ace
    // has no disabled state, so without this its hidden textarea keeps
    // `tabindex="0"` and a keyboard user tabs into a field every other control
    // beside it has dropped out of the order — landing somewhere that looks
    // editable and silently swallows what they type. Assistive tech is told
    // nothing either, since dimming is a purely visual signal.
    if (disabled) {
      element.setAttribute("aria-disabled", "true");
      element.tabIndex = -1;
    } else {
      element.removeAttribute("aria-disabled");
      element.tabIndex = 0;
    }
  }, [wrapperId, hasError, description, disabled, ariaLabel]);

  return (
    <Input.Wrapper
      id={wrapperId}
      label={label}
      description={description}
      error={error}
      withAsterisk={withAsterisk}
      // Ace has no disabled state, so the only signal a pointer user gets is
      // that the surface is dimmed — the same affordance a disabled Mantine
      // input carries.
      opacity={disabled ? 0.6 : undefined}
      w="100%"
    >
      <EditorFrame>
        <AceEditor
          mode="json"
          theme={colorScheme === "dark" ? "github_dark" : "github"}
          // react-ace uses `name` as the editor container's DOM id, so a fixed
          // value would collide the moment two of these render — and it must also
          // differ from the id given to the textarea below, which is the one the
          // wrapper's `<label for>` points at.
          name={`${wrapperId}-editor`}
          // A class, not a style: Ace renders its own DOM and paints a caret even
          // when read-only, which reads as an editable field whose keystrokes are
          // being swallowed. Hiding it needs a selector into that DOM, which is
          // the same reason the gutter override in App.css exists.
          //
          // `""` rather than `undefined` for the off case: react-ace's
          // `componentDidUpdate` reads `prevProps.className.trim()` whenever the
          // class changes, with no guard — so going *to* a class from `undefined`
          // throws, and going *from* one to `undefined` writes the literal class
          // name "undefined" onto the element. Both are reachable here, because
          // read-only is derived state: a tool form disables itself while a call
          // is in flight, which flips this on an editor already mounted.
          className={isReadOnly ? "json-editor-readonly" : ""}
          value={value}
          onChange={handleChange}
          readOnly={isReadOnly}
          width="100%"
          minLines={minLines}
          maxLines={maxLines}
          tabSize={2}
          showPrintMargin={false}
          // A read-only editor is a rendering of someone else's payload, so it
          // carries none of the caret furniture an editable one does.
          highlightActiveLine={!isReadOnly}
          editorProps={{ $blockScrolling: Infinity }}
          onLoad={(editor) => {
            editorRef.current = editor;
            // `textInputAriaLabel` alone is not enough: Ace composes the hidden
            // textarea's label as "<label>, Cursor at row N" inside
            // `TextInput.setAriaLabel`, and only recomputes it when the cursor
            // moves — so an option applied at mount does not reach the DOM until
            // the user clicks into the editor. Until then the control's only
            // accessible name is the position readout, which names nothing.
            // Setting it here and recomputing once is what makes the editor
            // identifiable from first paint.
            editor.setOption("textInputAriaLabel", ariaLabel);
            editor.textInput.setAriaLabel();
          }}
          setOptions={{
            // The JSON worker is what puts a marker on the offending line rather
            // than one message for the whole document. Pointless on a read-only
            // document — the reader cannot act on what it flags — and actively
            // misleading where the text is a *fragment* rendered for display.
            useWorker: !isReadOnly,
            // Closes a brace/bracket/quote when you open one, and skips over the
            // closing one you then type. On by default; named because it is half
            // of why this component exists.
            behavioursEnabled: true,
            // Roving-tabindex arrow-key navigation plus an Esc-to-exit-trap, so
            // the editor does not swallow Tab for keyboard users.
            enableKeyboardAccessibility: true,
            textInputAriaLabel: ariaLabel,
            showFoldWidgets: true,
            displayIndentGuides: true,
            useSoftTabs: true,
            scrollPastEnd: false,
            highlightGutterLine: !isReadOnly,
          }}
        />
      </EditorFrame>
    </Input.Wrapper>
  );
}
