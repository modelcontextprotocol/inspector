/**
 * Converts JSON Schema to ink-form format
 */

import type { FormStructure, FormSection, FormField } from "ink-form";

/** Minimal JSON Schema property shape used when building tool parameter forms */
interface JsonSchemaProperty {
  type?: string;
  title?: string;
  enum?: unknown[];
  /** Non-standard legacy support: titles for enum values */
  enumNames?: string[];
  items?: { enum?: unknown[]; enumNames?: string[] };
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

/**
 * Build ink-form select options from enum values, using their non-standard
 * `enumNames` titles as labels when present and length-matched. Falls back to
 * the stringified value as the label otherwise, since a wrong-length zip would
 * mislabel options — worse than showing raw values.
 */
function toSelectOptions(
  values: unknown[],
  names: string[] | undefined,
): { label: string; value: string }[] {
  const useNames = names !== undefined && names.length === values.length;
  return values.map((val, index) => ({
    label: useNames ? names[index] : String(val),
    value: String(val),
  }));
}

/** Minimal JSON Schema object shape (properties + required) */
interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Converts a JSON Schema to ink-form structure
 */
export function schemaToForm(
  schema: JsonSchemaObject | null | undefined,
  toolName: string,
): FormStructure {
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
    const property = prop as JsonSchemaProperty;
    const baseField = {
      name: key,
      label: property.title || key,
      required: required.includes(key),
    };

    let field: FormField;

    // Handle enum -> select. Detect the array-of-enums case on `items.enum`
    // alone (matching the web SchemaForm guard) — a standard array-of-enums
    // schema carries no top-level `enum`, so gating on it would drop the field
    // to a plain string input.
    if (property.type === "array" && property.items?.enum) {
      // ink-form has no multiselect, so we render a single select.
      field = {
        type: "select",
        ...baseField,
        options: toSelectOptions(property.items.enum, property.items.enumNames),
      } as FormField;
    } else if (property.enum) {
      // Single select
      field = {
        type: "select",
        ...baseField,
        options: toSelectOptions(property.enum, property.enumNames),
      } as FormField;
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

    // Set initial value from default (ink-form FormField allows initialValue for some types)
    if (property.default !== undefined) {
      (field as FormField & { initialValue?: unknown }).initialValue =
        property.default;
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
