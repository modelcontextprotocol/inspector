import type { JsonSchemaType } from "./jsonUtils";

/**
 * Cleans parameters by removing undefined, null, and empty string values for optional fields
 * while preserving all values for required fields.
 *
 * @param params - The parameters object to clean
 * @param schema - The JSON schema defining which fields are required
 * @returns Cleaned parameters object with optional empty fields omitted
 */
export function cleanParams(
  params: Record<string, unknown>,
  schema: JsonSchemaType,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  const required = schema.required || [];

  for (const [key, value] of Object.entries(params)) {
    const isFieldRequired = required.includes(key);

    if (isFieldRequired) {
      // Required fields: always include, even if empty string or falsy
      cleaned[key] = value;
    } else {
      // Optional fields: only include if they have meaningful values
      if (value !== undefined && value !== "" && value !== null) {
        cleaned[key] = value;
      }
      // Empty strings, undefined, null for optional fields → omit completely
    }
  }

  return cleaned;
}

/**
 * Checks if a field should be set to undefined when cleared
 * @param isRequired - Whether the field is required
 * @param value - The current value
 * @returns Whether to set the field to undefined
 */
export function shouldSetToUndefined(
  isRequired: boolean,
  value: string,
): boolean {
  return !isRequired && value === "";
}
