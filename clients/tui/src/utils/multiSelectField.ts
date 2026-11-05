/**
 * The multi-select form field the TUI adds to `ink-form` (#2904).
 *
 * ink-form ships string, number, boolean and single-select fields only, so an
 * array-of-choices property (`{ type: "array", items: { enum: [...] } }`) used
 * to render as a single select and could be answered with one value at most.
 * This module holds the field's shape and the pure helpers its renderer and
 * the submit checks share; the Ink renderer itself is
 * `components/MultiSelectField.tsx`, registered with every `<Form>` that can
 * receive one through `customManagers`.
 */

import type { AbstractFormField } from "ink-form";

/** The `type` ink-form dispatches on to find this field's manager. */
export const MULTISELECT_FIELD_TYPE = "multiselect";

/** One choice, as ink-form's own select declares its options. */
export interface MultiSelectOption {
  label?: string;
  value: string;
}

/**
 * A field whose value is the list of chosen option values, in option order.
 * `minItems` / `maxItems` are the schema's bounds, shown as a hint while
 * editing and enforced at submit by {@link selectionCountErrors}'s callers.
 */
export type FormFieldMultiSelect = AbstractFormField<
  typeof MULTISELECT_FIELD_TYPE,
  string[]
> & {
  options: MultiSelectOption[];
  minItems?: number;
  maxItems?: number;
};

/**
 * Toggle `value` in the selection, returning a new list kept in option order
 * so the submitted array reads the way the schema lists its choices.
 */
export function toggleChoice(
  selected: readonly string[],
  value: string,
  options: readonly MultiSelectOption[],
): string[] {
  const next = new Set(selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return options.map((option) => option.value).filter((each) => next.has(each));
}

/** The bounds as a short instruction, or `undefined` when there are none. */
export function boundsHint(
  minItems: number | undefined,
  maxItems: number | undefined,
): string | undefined {
  if (minItems !== undefined && maxItems !== undefined) {
    return minItems === maxItems
      ? `Choose exactly ${minItems}`
      : `Choose ${minItems} to ${maxItems}`;
  }
  if (minItems !== undefined) return `Choose at least ${minItems}`;
  if (maxItems !== undefined) return `Choose at most ${maxItems}`;
  return undefined;
}

/** The collapsed rendering of a selection: its labels, comma-separated. */
export function selectionLabel(
  options: readonly MultiSelectOption[],
  value: readonly string[] | undefined,
): string {
  if (value === undefined) return "No value";
  if (value.length === 0) return "None selected";
  return value
    .map(
      (each) => options.find((option) => option.value === each)?.label ?? each,
    )
    .join(", ");
}

/**
 * The first row of the visible window over `count` options, so the cursor
 * stays in view when the list is longer than `limit` rows. The window keeps
 * the cursor centred where it can, clamped to the ends of the list.
 */
export function windowStart(
  cursor: number,
  count: number,
  limit: number,
): number {
  if (count <= limit) return 0;
  return Math.min(Math.max(0, cursor - Math.floor(limit / 2)), count - limit);
}
