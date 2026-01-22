/**
 * Converts prompt arguments to ink-form format
 */

import type { FormStructure, FormSection, FormField } from "ink-form";

/**
 * Converts prompt arguments array to ink-form structure
 */
export function promptArgsToForm(
  promptArguments: any[],
  promptName: string,
): FormStructure {
  const fields: FormField[] = [];

  if (!promptArguments || promptArguments.length === 0) {
    return {
      title: `Get Prompt: ${promptName}`,
      sections: [{ title: "Parameters", fields: [] }],
    };
  }

  for (const arg of promptArguments) {
    const field: FormField = {
      name: arg.name,
      label: arg.name,
      type: "string", // Prompt arguments are always strings
      required: arg.required !== false, // Default to required unless explicitly false
      description: arg.description,
    };

    fields.push(field);
  }

  const sections: FormSection[] = [
    {
      title: "Prompt Arguments",
      fields,
    },
  ];

  return {
    title: `Get Prompt: ${promptName}`,
    sections,
  };
}
