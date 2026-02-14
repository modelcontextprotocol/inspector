import type { Tool } from "@modelcontextprotocol/sdk/types.js";
/**
 * JSON value type used across the inspector project
 */
export type JsonValue = string | number | boolean | null | undefined | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Simple schema type for parameter conversion
 */
type ParameterSchema = {
    type?: string;
};
/**
 * Convert a string parameter value to the appropriate JSON type based on schema
 * @param value String value to convert
 * @param schema Schema type information
 * @returns Converted JSON value
 */
export declare function convertParameterValue(value: string, schema: ParameterSchema): JsonValue;
/**
 * Convert string parameters to JSON values based on tool schema
 * @param tool Tool definition with input schema
 * @param params String parameters to convert
 * @returns Converted parameters as JSON values
 */
export declare function convertToolParameters(tool: Tool, params: Record<string, string>): Record<string, JsonValue>;
/**
 * Convert prompt arguments (JsonValue) to strings for prompt API
 * @param args Prompt arguments as JsonValue
 * @returns String arguments for prompt API
 */
export declare function convertPromptArguments(args: Record<string, JsonValue>): Record<string, string>;
export {};
//# sourceMappingURL=jsonUtils.d.ts.map