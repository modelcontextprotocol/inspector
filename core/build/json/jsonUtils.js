/**
 * Convert a string parameter value to the appropriate JSON type based on schema
 * @param value String value to convert
 * @param schema Schema type information
 * @returns Converted JSON value
 */
export function convertParameterValue(value, schema) {
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
            return JSON.parse(value);
        }
        catch (error) {
            return value;
        }
    }
    return value;
}
/**
 * Convert string parameters to JSON values based on tool schema
 * @param tool Tool definition with input schema
 * @param params String parameters to convert
 * @returns Converted parameters as JSON values
 */
export function convertToolParameters(tool, params) {
    const result = {};
    const properties = tool.inputSchema?.properties || {};
    for (const [key, value] of Object.entries(params)) {
        const paramSchema = properties[key];
        if (paramSchema) {
            result[key] = convertParameterValue(value, paramSchema);
        }
        else {
            // If no schema is found for this parameter, keep it as string
            result[key] = value;
        }
    }
    return result;
}
/**
 * Convert prompt arguments (JsonValue) to strings for prompt API
 * @param args Prompt arguments as JsonValue
 * @returns String arguments for prompt API
 */
export function convertPromptArguments(args) {
    const stringArgs = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string") {
            stringArgs[key] = value;
        }
        else if (value === null || value === undefined) {
            stringArgs[key] = String(value);
        }
        else {
            stringArgs[key] = JSON.stringify(value);
        }
    }
    return stringArgs;
}
//# sourceMappingURL=jsonUtils.js.map