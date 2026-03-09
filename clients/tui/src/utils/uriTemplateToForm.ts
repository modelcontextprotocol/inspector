/**
 * Converts URI Template to ink-form format for resource templates
 */

import type { FormStructure, FormSection, FormField } from "ink-form";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

/**
 * Converts a URI Template to ink-form structure
 */
export function uriTemplateToForm(
  uriTemplate: string,
  templateName: string,
): FormStructure {
  const fields: FormField[] = [];

  try {
    const template = new UriTemplate(uriTemplate);
    const variableNames = template.variableNames || [];

    for (const variableName of variableNames) {
      const field: FormField = {
        name: variableName,
        label: variableName,
        type: "string",
        required: false, // URI template variables are typically optional
      };

      fields.push(field);
    }
  } catch (error) {
    // If parsing fails, return empty form
    console.error("Failed to parse URI template:", error);
  }

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
