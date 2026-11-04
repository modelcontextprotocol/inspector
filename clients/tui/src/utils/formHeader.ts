/**
 * The form a test modal hands to `ink-form`, minus its title (#2827).
 *
 * Each test modal (tool, prompt, resource template) prints the form's title in
 * its own header, because it has to stay visible in the loading and results
 * states too — and `ink-form` prints the same `form.title` again in its own
 * header box, so the open form showed "Test Tool: <name>" twice. The modal's
 * header is the one that survives every state, so the copy given to the form
 * drops it. `title` is optional in `ink-form`'s `FormStructure`; without one
 * its header keeps the navigation hint and the section tabs.
 */

import type { FormStructure } from "ink-form";

export function untitledForm(form: FormStructure): FormStructure {
  return { ...form, title: undefined };
}
