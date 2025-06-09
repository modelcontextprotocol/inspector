import { Tool } from "@anthropic-ai/sdk/resources/messages/messages.mjs";

// Helper function to recursively sanitize schema objects
const sanitizeSchema = (schema: unknown): unknown => {
  if (!schema || typeof schema !== "object") return schema;

  // Handle array
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchema(item));
  }

  // Now we know it's an object
  const schemaObj = schema as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schemaObj)) {
    if (
      key === "properties" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // Handle properties object
      const propertiesObj = value as Record<string, unknown>;
      const sanitizedProps: Record<string, unknown> = {};
      const keyMapping: Record<string, string> = {};

      for (const [propKey, propValue] of Object.entries(propertiesObj)) {
        const sanitizedKey = propKey.replace(/[^a-zA-Z0-9_-]/g, "_");
        keyMapping[propKey] = sanitizedKey;
        sanitizedProps[sanitizedKey] = sanitizeSchema(propValue);
      }

      sanitized[key] = sanitizedProps;

      // Update required fields if they exist
      if ("required" in schemaObj && Array.isArray(schemaObj.required)) {
        sanitized.required = (schemaObj.required as string[]).map(
          (req: string) => keyMapping[req] || req,
        );
      }
    } else {
      sanitized[key] = sanitizeSchema(value);
    }
  }

  return sanitized;
};

export const mappedTools = (tools: Tool[]) => {
  return tools.map((tool: Tool) => {
    // Deep copy and sanitize the schema
    let inputSchema;
    if (tool.input_schema) {
      inputSchema = JSON.parse(JSON.stringify(tool.input_schema));
    } else {
      // If no input schema, create a basic object schema
      inputSchema = {
        type: "object",
        properties: {},
        required: [],
      };
    }

    // Ensure the schema has a type field
    if (!inputSchema.type) {
      inputSchema.type = "object";
    }

    // Ensure properties exists for object types
    if (inputSchema.type === "object" && !inputSchema.properties) {
      inputSchema.properties = {};
    }

    const sanitizedSchema = sanitizeSchema(inputSchema);

    return {
      name: tool.name,
      description: tool.description,
      input_schema: sanitizedSchema,
    } as Tool;
  });
};
