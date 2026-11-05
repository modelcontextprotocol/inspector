/**
 * The Ink renderer for the multi-select field `schemaToForm` emits for an
 * array-of-choices property (#2904).
 *
 * ink-form has no multi-select, so it is added as a custom field manager:
 * every `<Form>` that can receive such a field passes
 * {@link FORM_FIELD_MANAGERS} as `customManagers`. While the field is being
 * edited ink-form stops moving focus on the arrows and leaves Enter (save) and
 * Esc (cancel) to its own field renderer, so this component only owns the
 * cursor (Up/Down) and the toggle (Space). The shape and the pure helpers live
 * in `utils/multiSelectField.ts`.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type {
  FormField,
  FormFieldManager,
  FormFieldValueRendererProps,
  SpecificFormFieldRendererProps,
} from "ink-form";
import {
  MULTISELECT_FIELD_TYPE,
  boundsHint,
  selectionLabel,
  toggleChoice,
  windowStart,
  type FormFieldMultiSelect,
} from "../utils/multiSelectField.js";

/** Rows shown at once; a longer list scrolls with the cursor. */
export const VISIBLE_OPTIONS = 8;

/** Props the input needs; a subset of what ink-form hands a field renderer. */
interface MultiSelectInputProps {
  field: FormFieldMultiSelect;
  value?: string[];
  onChange: (value: string[]) => void;
}

export function MultiSelectInput({
  field,
  value,
  onChange,
}: MultiSelectInputProps) {
  const [cursor, setCursor] = useState(0);
  const selected = value ?? [];
  const count = field.options.length;

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
    } else if (key.downArrow) {
      setCursor((current) => Math.min(count - 1, current + 1));
    } else if (input === " ") {
      const option = field.options[cursor];
      if (option) onChange(toggleChoice(selected, option.value, field.options));
    }
  });

  const start = windowStart(cursor, count, VISIBLE_OPTIONS);
  const hint = boundsHint(field.minItems, field.maxItems);
  return (
    <Box width="100%" borderStyle="round" flexDirection="column">
      {field.options
        .slice(start, start + VISIBLE_OPTIONS)
        .map((option, offset) => {
          const active = start + offset === cursor;
          const checked = selected.includes(option.value);
          return (
            <Text key={option.value} color={active ? "blue" : undefined}>
              {active ? "❯ " : "  "}
              {checked ? "[x] " : "[ ] "}
              {option.label ?? option.value}
            </Text>
          );
        })}
      {count > VISIBLE_OPTIONS && (
        <Text dimColor>
          {start + 1}-{start + VISIBLE_OPTIONS} of {count}
        </Text>
      )}
      <Text dimColor>
        Up/Down to move, Space to toggle ({selected.length} selected)
        {hint ? `. ${hint}` : ""}
      </Text>
    </Box>
  );
}

/** Whether ink-form handed this manager the field kind it is registered for. */
export function isMultiSelectField(
  field: FormField,
): field is FormFieldMultiSelect {
  return field.type === MULTISELECT_FIELD_TYPE;
}

/** A field value as a selection, or `undefined` when it is not one. */
function asSelection(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : undefined;
}

/**
 * The manager, typed over ink-form's whole `FormField` union because that is
 * what `customManagers` accepts — a manager typed for this one field is not
 * assignable to it, since its renderers would accept only their own field.
 * ink-form picks a manager by `type`, so the guard always holds; it is what
 * narrows the field without a cast, and any other field renders nothing.
 */
export const multiSelectFieldManager: FormFieldManager<FormField> = {
  type: MULTISELECT_FIELD_TYPE,
  renderField: (props: SpecificFormFieldRendererProps<FormField>) =>
    isMultiSelectField(props.field) ? (
      <MultiSelectInput
        field={props.field}
        value={asSelection(props.value)}
        onChange={props.onChange}
      />
    ) : null,
  renderValue: (props: FormFieldValueRendererProps<FormField>) =>
    isMultiSelectField(props.field) ? (
      <>{selectionLabel(props.field.options, asSelection(props.value))}</>
    ) : null,
};

/** The custom managers every TUI `<Form>` built by `schemaToForm` needs. */
export const FORM_FIELD_MANAGERS: FormFieldManager<FormField>[] = [
  multiSelectFieldManager,
];
