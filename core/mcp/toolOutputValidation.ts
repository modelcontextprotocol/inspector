import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type {
  JsonSchemaType,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";

/**
 * Validate a delivered tool result's `structuredContent` against the tool's
 * declared `outputSchema`, mirroring the SDK client's strict check but WITHOUT
 * throwing. Returns a human-readable error message when a strict client would
 * reject the payload, or `undefined` when it's valid (or there's nothing to
 * check).
 *
 * Used by {@link InspectorClient.callTool}'s `skipOutputValidation` path: MCP
 * Apps forward the result verbatim to the running view, so the host must not
 * reject it — but it should still surface the mismatch as a non-fatal advisory.
 *
 * @param provider A JSON Schema validator provider (the SDK's Ajv provider).
 * @param tool The tool that was called (carries the declared outputSchema).
 * @param result The delivered CallToolResult.
 */
export function validateToolOutput(
  provider: jsonSchemaValidator,
  tool: Tool,
  result: CallToolResult,
): string | undefined {
  if (!tool.outputSchema) return undefined;
  const structured = result.structuredContent;
  if (structured == null) {
    // Strict clients reject "has outputSchema but no structuredContent" unless
    // the result is itself an error.
    return result.isError
      ? undefined
      : `Tool "${tool.name}" declares an output schema but returned no structured content`;
  }
  try {
    const validate = provider.getValidator(
      tool.outputSchema as unknown as JsonSchemaType,
    );
    const validation = validate(structured);
    return validation.valid ? undefined : validation.errorMessage;
  } catch {
    // A malformed schema (validator compilation failure) shouldn't block the
    // call or produce a misleading warning.
    return undefined;
  }
}
