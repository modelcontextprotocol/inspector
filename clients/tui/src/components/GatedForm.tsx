/**
 * An `ink-form` `<Form>` that can be switched off without losing its draft
 * (#2967).
 *
 * The tool, resource, prompt and roots modals stay mounted underneath a
 * pending sampling/elicitation request (#2829), and gate their own `useInput`
 * while it is open. `ink-form` offers no such gate: every field, the section
 * tabs and the arrow-key focus moves are `useInput` / `useFocus` hooks of its
 * own with no `isActive` reachable from outside, and Ink's focus manager is
 * shared with the overlay's form. So a key typed into the overlay also moved
 * focus and edited values in the form underneath it.
 *
 * Ink cannot mask stdin for a subtree, so "inert" here means "not mounted":
 * while `active` is false the `<Form>` is not rendered at all, and none of its
 * handlers or focusables exist. The draft survives because the form runs in
 * `ink-form`'s **controlled** mode with its value held here, in a component
 * that stays mounted across the toggle. The value is seeded from each field's
 * `initialValue`, which is what the uncontrolled form did on mount, so a
 * submit carries the same defaults it always did.
 *
 * What does not survive is `ink-form`'s own view state — which section tab and
 * which field had focus, and an edit still open in a field (not yet committed
 * with Enter), which is discarded the way Esc discards it. Committed values,
 * which are everything a submit sends, are kept exactly.
 */
import React, { useState } from "react";
import { Text } from "ink";
import { Form, type FormProps, type FormStructure } from "ink-form";

interface GatedFormProps {
  form: FormStructure;
  /** False while another overlay owns the keyboard; the form is unmounted. */
  active: boolean;
  onSubmit: (value: object) => void;
  customManagers?: FormProps["customManagers"];
}

/**
 * Each field's declared `initialValue`, keyed by field name across sections.
 * Built with `Object.fromEntries` so a field named `__proto__` becomes an own
 * property, as ink-form's own computed-key seeding made it, rather than
 * hitting the prototype setter.
 */
export function initialFormValues(
  form: FormStructure,
): Record<string, unknown> {
  return Object.fromEntries(
    form.sections.flatMap((section) =>
      section.fields
        .filter((field) => field.initialValue !== undefined)
        .map((field) => [field.name, field.initialValue]),
    ),
  );
}

export function GatedForm({
  form,
  active,
  onSubmit,
  customManagers,
}: GatedFormProps) {
  // Seeded once: the modals rebuild `form` every render, but its fields (and
  // so their defaults) are fixed for the lifetime of the modal.
  const [draft, setDraft] = useState<object>(() => initialFormValues(form));

  if (!active) {
    return <Text dimColor>Paused while a server request is open</Text>;
  }
  return (
    <Form
      form={form}
      customManagers={customManagers}
      value={draft}
      onChange={setDraft}
      onSubmit={onSubmit}
    />
  );
}
