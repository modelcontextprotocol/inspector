/**
 * Converts JSON Schema to ink-form format
 */

import type { FormStructure, FormSection, FormField } from "ink-form";

/**
 * Converts a JSON Schema to ink-form structure
 */
export function schemaToForm(schema: any, toolName: string): FormStructure {
  const fields: FormField[] = [];

  if (!schema || !schema.properties) {
    return {
      title: `Test Tool: ${toolName}`,
      sections: [{ title: "Parameters", fields: [] }],
    };
  }

  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const [key, prop] of Object.entries(properties)) {
    const property = prop as any;
    const baseField = {
      name: key,
      label: property.title || key,
      required: required.includes(key),
    };

    let field: FormField;

    // Handle enum -> select
    if (property.enum) {
      if (property.type === "array" && property.items?.enum) {
        // For array of enums, we'll use select but handle it differently
        // Note: ink-form doesn't have multiselect, so we'll use select
        field = {
          type: "select",
          ...baseField,
          options: property.items.enum.map((val: any) => ({
            label: String(val),
            value: String(val),
          })),
        } as FormField;
      } else {
        // Single select
        field = {
          type: "select",
          ...baseField,
          options: property.enum.map((val: any) => ({
            label: String(val),
            value: String(val),
          })),
        } as FormField;
      }
    } else {
      // Map JSON Schema types to ink-form types
      switch (property.type) {
        case "string":
          field = {
            type: "string",
            ...baseField,
          } as FormField;
          break;
        case "integer":
          field = {
            type: "integer",
            ...baseField,
            ...(property.minimum !== undefined && { min: property.minimum }),
            ...(property.maximum !== undefined && { max: property.maximum }),
          } as FormField;
          break;
        case "number":
          field = {
            type: "float",
            ...baseField,
            ...(property.minimum !== undefined && { min: property.minimum }),
            ...(property.maximum !== undefined && { max: property.maximum }),
          } as FormField;
          break;
        case "boolean":
          field = {
            type: "boolean",
            ...baseField,
          } as FormField;
          break;
        default:
          // Default to string for unknown types
          field = {
            type: "string",
            ...baseField,
          } as FormField;
      }
    }

    // Set initial value from default
    if (property.default !== undefined) {
      (field as any).initialValue = property.default;
    }

    fields.push(field);
  }

  const sections: FormSection[] = [
    {
      title: "Parameters",
      fields,
    },
  ];

  return {
    title: `Test Tool: ${toolName}`,
    sections,
  };
}
