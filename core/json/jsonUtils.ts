import type { Tool } from "@modelcontextprotocol/client";

/**
 * JSON value type used across the inspector project
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * Widen a typed object to a generic string-keyed record so its keys can be
 * iterated or read/written generically. Many of the project's config/SDK types
 * (`StoredMCPServer`, `MCPServerConfig`, `pino.Logger`, DOM `Window`, …) have no
 * index signature, so a direct `value as Record<string, unknown>` at a call
 * site is a TS2352 error that would otherwise force an `as unknown as` double
 * cast. Taking the argument as the general `object` type makes the single `as`
 * legal — `Record<string, unknown>` is assignable to `object`, so the two types
 * sufficiently overlap — letting this one audited spot own the widening while
 * the double casts stay out of the call sites. Purely a structural view of the
 * same object; no runtime effect.
 */
export function toRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Simple schema type for parameter conversion
 */
type ParameterSchema = {
  type?: string;
};

/**
 * Convert a string parameter value to the appropriate JSON type based on schema
 */
export function convertParameterValue(
  value: string,
  schema: ParameterSchema,
): JsonValue {
  if (!value) {
    return value;
  }

  if (schema.type === "number" || schema.type === "integer") {
    return Number(value);
  }

  if (schema.type === "boolean") {
    return value.toLowerCase() === "true";
  }

  if (schema.type === "object" || schema.type === "array") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Convert string parameters to JSON values based on tool schema
 */
export function convertToolParameters(
  tool: Tool,
  params: Record<string, string>,
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  const properties = tool.inputSchema?.properties || {};

  for (const [key, value] of Object.entries(params)) {
    const paramSchema = properties[key] as ParameterSchema | undefined;

    if (paramSchema) {
      result[key] = convertParameterValue(value, paramSchema);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert prompt arguments (JsonValue) to strings for prompt API
 */
export function convertPromptArguments(
  args: Record<string, JsonValue>,
): Record<string, string> {
  const stringArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      stringArgs[key] = value;
    } else if (value === null || value === undefined) {
      stringArgs[key] = String(value);
    } else {
      stringArgs[key] = JSON.stringify(value);
    }
  }
  return stringArgs;
}
