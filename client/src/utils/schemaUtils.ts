import type { JsonValue, JsonSchemaType, JsonObject } from "./jsonUtils";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import type { Tool, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

const ajv = new Ajv();

// Cache for compiled validators
const toolOutputValidators = new Map<string, ValidateFunction>();

/**
 * Compiles and caches output schema validators for a list of tools
 * Following the same pattern as SDK's Client.cacheToolOutputSchemas
 * @param tools Array of tools that may have output schemas
 */
export function cacheToolOutputSchemas(tools: Tool[]): void {
  toolOutputValidators.clear();
  for (const tool of tools) {
    if (tool.outputSchema) {
      try {
        const validator = ajv.compile(tool.outputSchema);
        toolOutputValidators.set(tool.name, validator);
      } catch (error) {
        console.warn(
          `Failed to compile output schema for tool ${tool.name}:`,
          error,
        );
      }
    }
  }
}

/**
 * Gets the cached output schema validator for a tool
 * Following the same pattern as SDK's Client.getToolOutputValidator
 * @param toolName Name of the tool
 * @returns The compiled validator function, or undefined if not found
 */
export function getToolOutputValidator(
  toolName: string,
): ValidateFunction | undefined {
  return toolOutputValidators.get(toolName);
}

/**
 * Validates structured content against a tool's output schema
 * Returns validation result with detailed error messages
 * @param toolName Name of the tool
 * @param structuredContent The structured content to validate
 * @returns An object with isValid boolean and optional error message
 */
export function validateToolOutput(
  toolName: string,
  structuredContent: unknown,
): { isValid: boolean; error?: string } {
  const validator = getToolOutputValidator(toolName);
  if (!validator) {
    return { isValid: true }; // No validator means no schema to validate against
  }

  const isValid = validator(structuredContent);
  if (!isValid) {
    return {
      isValid: false,
      error: ajv.errorsText(validator.errors),
    };
  }

  return { isValid: true };
}

/**
 * Checks if a tool has an output schema
 * @param toolName Name of the tool
 * @returns true if the tool has an output schema
 */
export function hasOutputSchema(toolName: string): boolean {
  return toolOutputValidators.has(toolName);
}

/**
 * Generates a default value based on a JSON schema type
 * @param schema The JSON schema definition
 * @param propertyName Optional property name for checking if it's required in parent schema
 * @param parentSchema Optional parent schema to check required array
 * @returns A default value matching the schema type
 */
export function generateDefaultValue(
  schema: JsonSchemaType,
  propertyName?: string,
  parentSchema?: JsonSchemaType,
): JsonValue {
  if ("default" in schema && schema.default !== undefined) {
    return schema.default;
  }

  // Check if this property is required in the parent schema
  const isRequired =
    propertyName && parentSchema
      ? isPropertyRequired(propertyName, parentSchema)
      : false;
  const isRootSchema = propertyName === undefined && parentSchema === undefined;

  switch (schema.type) {
    case "string":
      return isRequired ? "" : undefined;
    case "number":
    case "integer":
      return isRequired ? 0 : undefined;
    case "boolean":
      return isRequired ? false : undefined;
    case "array":
      return isRequired ? [] : undefined;
    case "object": {
      if (!schema.properties) {
        return isRequired || isRootSchema ? {} : undefined;
      }

      const obj: JsonObject = {};
      // Include required properties OR optional properties that declare a default
      Object.entries(schema.properties).forEach(([key, prop]) => {
        const hasExplicitDefault =
          "default" in prop && (prop as JsonSchemaType).default !== undefined;
        if (isPropertyRequired(key, schema) || hasExplicitDefault) {
          const value = generateDefaultValue(prop, key, schema);
          if (value !== undefined) {
            obj[key] = value;
          }
        }
      });

      if (Object.keys(obj).length === 0) {
        return isRequired || isRootSchema ? {} : undefined;
      }
      return obj;
    }
    case "null":
      return null;
    default:
      return undefined;
  }
}

/**
 * Helper function to check if a property is required in a schema
 * @param propertyName The name of the property to check
 * @param schema The parent schema containing the required array
 * @returns true if the property is required, false otherwise
 */
export function isPropertyRequired(
  propertyName: string,
  schema: JsonSchemaType,
): boolean {
  return schema.required?.includes(propertyName) ?? false;
}

/**
 * Resolves $ref references in JSON schema
 * @param schema The schema that may contain $ref
 * @param rootSchema The root schema to resolve references against
 * @returns The resolved schema without $ref
 */
export function resolveRef(
  schema: JsonSchemaType,
  rootSchema: JsonSchemaType,
): JsonSchemaType {
  if (!("$ref" in schema) || !schema.$ref) {
    return schema;
  }

  const ref = schema.$ref;

  // Handle simple #/properties/name references
  if (ref.startsWith("#/")) {
    const path = ref.substring(2).split("/");
    let current: unknown = rootSchema;

    for (const segment of path) {
      if (
        current &&
        typeof current === "object" &&
        current !== null &&
        segment in current
      ) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        // If reference cannot be resolved, return the original schema
        console.warn(`Could not resolve $ref: ${ref}`);
        return schema;
      }
    }

    return current as JsonSchemaType;
  }

  // For other types of references, return the original schema
  console.warn(`Unsupported $ref format: ${ref}`);
  return schema;
}

/**
 * Normalizes union types (like string|null from FastMCP) to simple types for form rendering
 * @param schema The JSON schema to normalize
 * @returns A normalized schema or the original schema
 */
export function normalizeUnionType(schema: JsonSchemaType): JsonSchemaType {
  // Handle anyOf with exactly string and null (FastMCP pattern)
  if (
    schema.anyOf &&
    schema.anyOf.length === 2 &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "string") &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "null")
  ) {
    return { ...schema, type: "string", anyOf: undefined, nullable: true };
  }

  // Handle anyOf with exactly boolean and null (FastMCP pattern)
  if (
    schema.anyOf &&
    schema.anyOf.length === 2 &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "boolean") &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "null")
  ) {
    return { ...schema, type: "boolean", anyOf: undefined, nullable: true };
  }

  // Handle anyOf with exactly number and null (FastMCP pattern)
  if (
    schema.anyOf &&
    schema.anyOf.length === 2 &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "number") &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "null")
  ) {
    return { ...schema, type: "number", anyOf: undefined, nullable: true };
  }

  // Handle anyOf with exactly integer and null (FastMCP pattern)
  if (
    schema.anyOf &&
    schema.anyOf.length === 2 &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "integer") &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "null")
  ) {
    return { ...schema, type: "integer", anyOf: undefined, nullable: true };
  }

  // Handle anyOf with exactly array and null (FastMCP pattern)
  if (
    schema.anyOf &&
    schema.anyOf.length === 2 &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "array") &&
    schema.anyOf.some((t) => (t as JsonSchemaType).type === "null")
  ) {
    return { ...schema, type: "array", anyOf: undefined, nullable: true };
  }

  // Handle array type with exactly string and null
  if (
    Array.isArray(schema.type) &&
    schema.type.length === 2 &&
    schema.type.includes("string") &&
    schema.type.includes("null")
  ) {
    return { ...schema, type: "string", nullable: true };
  }

  // Handle array type with exactly boolean and null
  if (
    Array.isArray(schema.type) &&
    schema.type.length === 2 &&
    schema.type.includes("boolean") &&
    schema.type.includes("null")
  ) {
    return { ...schema, type: "boolean", nullable: true };
  }

  // Handle array type with exactly number and null
  if (
    Array.isArray(schema.type) &&
    schema.type.length === 2 &&
    schema.type.includes("number") &&
    schema.type.includes("null")
  ) {
    return { ...schema, type: "number", nullable: true };
  }

  // Handle array type with exactly integer and null
  if (
    Array.isArray(schema.type) &&
    schema.type.length === 2 &&
    schema.type.includes("integer") &&
    schema.type.includes("null")
  ) {
    return { ...schema, type: "integer", nullable: true };
  }

  return schema;
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
 * Resolves `$ref` references in a JSON-RPC "elicitation/create" message's `requestedSchema` field
 * @param message The JSON-RPC message that may contain $ref references
 * @returns A new message with resolved $ref references, or the original message if no resolution is needed
 */
export function resolveRefsInMessage(message: JSONRPCMessage): JSONRPCMessage {
  if (!isJSONRPCRequest(message) || !message.params?.requestedSchema) {
    return message;
  }

  const requestedSchema = message.params.requestedSchema as JsonSchemaType;

  if (!requestedSchema?.properties) {
    return message;
  }

  const resolvedMessage = {
    ...message,
    params: {
      ...message.params,
      requestedSchema: {
        ...requestedSchema,
        properties: Object.fromEntries(
          Object.entries(requestedSchema.properties).map(
            ([key, propSchema]) => {
              const resolved = resolveRef(propSchema, requestedSchema);
              const normalized = normalizeUnionType(resolved);
              return [key, normalized];
            },
          ),
        ),
      },
    },
  };

  return resolvedMessage;
}
