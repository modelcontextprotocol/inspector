import { JsonValue, JsonSchemaType } from "../components/DynamicJsonForm";
import { JsonObject } from "./jsonPathUtils";

/**
 * Generates a default value based on a JSON schema type
 * @param schema The JSON schema definition
 * @returns A default value matching the schema type
 */
export function generateDefaultValue(schema: JsonSchemaType): JsonValue {
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
      const obj: JsonObject = {};
      if (schema.properties) {
        Object.entries(schema.properties).forEach(([key, prop]) => {
          obj[key] = generateDefaultValue(prop);
        });
      }
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

/**
 * Validates if a value conforms to a JSON schema
 * @param value The value to validate
 * @param schema The JSON schema to validate against
 * @returns True if valid, false otherwise
 */
export function validateValueAgainstSchema(
  value: JsonValue, 
  schema: JsonSchemaType
): boolean {
  // Basic type validation
  switch (schema.type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}
