import type { JsonValue, JsonSchemaType, JsonObject } from "./jsonUtils";

/**
 * Generates a default value based on a JSON schema type
 * @param schema The JSON schema definition
 * @returns A default value matching the schema type, or null for non-required fields
 */
export function generateDefaultValue(schema: JsonSchemaType): JsonValue {
  if ("default" in schema) {
    return schema.default;
  }

  if (!schema.required) {
    if (schema.type === "array") return [];
    if (schema.type === "object") return {};
    return null;
  }

  switch (schema.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      if (!schema.properties) return {};

      const obj: JsonObject = {};
      Object.entries(schema.properties)
        .filter(([, prop]) => prop.required)
        .forEach(([key, prop]) => {
          const value = generateDefaultValue(prop);
          obj[key] = value;
        });
      return obj;
    }
    default:
      return null;
  }
}

/**
 * Formats a field key into a human-readable label
 * @param key The field key to format
 * @returns A formatted label string
 */
export function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1") // Insert space before capital letters
    .replace(/_/g, " ") // Replace underscores with spaces
    .replace(/^\w/, (c) => c.toUpperCase()); // Capitalize first letter
}
