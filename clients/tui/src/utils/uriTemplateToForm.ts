/**
 * Converts URI Template to ink-form format for resource templates
 */

import type { FormStructure, FormSection, FormField } from "ink-form";
import { templateVariableNames } from "@inspector/core/uri/uriTemplate.js";

/**
 * Converts a URI Template to ink-form structure
 */
export function uriTemplateToForm(
  uriTemplate: string,
  templateName: string,
): FormStructure {
  // Shared with the web panel's field list (#1919), so the two clients offer
  // the same inputs for a given template — including the variables inside
  // non-simple expressions, and one field (not two) for a repeated name. It
  // does not throw: a malformed template yields no names, so the form is empty.
  const fields: FormField[] = templateVariableNames(uriTemplate).map(
    (variableName) => ({
      name: variableName,
      label: variableName,
      type: "string",
      required: false, // URI template variables are typically optional
    }),
  );

  const sections: FormSection[] = [
    {
      title: "Template Variables",
      fields,
    },
  ];

  return {
    title: `Read Resource: ${templateName}`,
    sections,
  };
}
