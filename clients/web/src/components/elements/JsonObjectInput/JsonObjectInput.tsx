import { useState } from "react";
import type { StrictJsonObject } from "@inspector/core/json/jsonUtils.js";
import { useValueChange } from "../../../hooks/useValueChange";
import { parseJsonObjectDraft } from "../../../utils/jsonObjectDraft";
import { JsonEditor } from "../JsonEditor/JsonEditor";

/** Two-space canonical form — the same shape the catalog file is written in. */
function serialize(value: StrictJsonObject): string {
  return JSON.stringify(value, null, 2);
}

export interface JsonObjectInputProps {
  value: StrictJsonObject;
  onChange: (value: StrictJsonObject) => void;
  label?: string;
  description?: string;
  /** See {@link JsonEditor}'s prop of the same name — Ace names its own input. */
  ariaLabel: string;
  /** Rows shown before the editor grows; it autosizes between these bounds. */
  minLines?: number;
  maxLines?: number;
}

/**
 * A JSON-object editor: the user types JSON, the parent receives the parsed
 * object.
 *
 * This is the editor for payloads whose *values* may be any JSON, which is why
 * it exists beside the key/value row editors used for headers and env. `_meta`
 * is the case that forced it (#1910) — nothing in the MCP spec restricts a
 * `_meta` value to a string, so a `{ key, value }` row editor cannot express
 * what the protocol allows.
 *
 * The editing surface is {@link JsonEditor}, shared with every other JSON
 * surface in the client (#2151). What lives here is the *contract*: an object
 * in, an object out, and a decision about what an unparseable draft means.
 *
 * The text the user is typing is the source of truth for what is *displayed*;
 * the parent only ever sees a parsed object. That split is what makes the box
 * typeable: driving it off the parent's value and stringifying on every render
 * re-escapes half-typed text once per keystroke, which is the #1928 symptom.
 * `SchemaJsonField` in `SchemaForm.tsx` carries the same split for the same
 * reason — see the long comment there.
 *
 * While the text is invalid the parent is **not** told, so the last valid
 * object stands. The alternative — emitting `{}` — would silently discard a
 * user's configured metadata the moment they typed a stray character, and this
 * form has no Save button to gate instead: `onChange` writes straight through.
 * The state is not silent, though: Ace flags the position in the gutter, and
 * the wrapper repeats the reason underneath.
 */
export function JsonObjectInput({
  value,
  onChange,
  label,
  description,
  ariaLabel,
  minLines,
  maxLines,
}: JsonObjectInputProps) {
  const [draft, setDraft] = useState(() => serialize(value));
  // The canonical JSON of the last value this component emitted.
  //
  // The re-sync below has to tell an *external* change apart from the parent
  // echoing back what we just sent it, and the draft alone cannot: while the
  // text is invalid it parses to nothing, so every parent change would look
  // external and overwrite what is being typed.
  const [echoed, setEchoed] = useState(() => serialize(value));

  const handleChange = (text: string) => {
    setDraft(text);
    const result = parseJsonObjectDraft(text);
    if (!result.ok) return;
    setEchoed(serialize(result.value));
    onChange(result.value);
  };

  const parsed = parseJsonObjectDraft(draft);

  // Re-sync only on a value this component did not produce, so an external
  // reset (switching servers, a reloaded catalog) reaches the editor while an
  // in-progress edit is left alone. Compared through canonical JSON because the
  // parent hands back a fresh object each time.
  useValueChange(serialize(value), (next) => {
    if (next === echoed) return;
    setDraft(next);
    // `echoed` has to advance to the value now on screen, not just to what this
    // component last emitted. Leaving it behind makes an external A → B → A
    // sequence stick on B: the second A matches the stale `echoed` from before
    // B arrived and is dismissed as our own echo.
    setEchoed(next);
  });

  return (
    <JsonEditor
      value={draft}
      onChange={handleChange}
      label={label}
      description={description}
      ariaLabel={ariaLabel}
      error={parsed.ok ? undefined : parsed.error}
      minLines={minLines}
      maxLines={maxLines}
    />
  );
}
