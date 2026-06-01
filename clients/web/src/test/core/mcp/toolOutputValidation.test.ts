import { describe, it, expect } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { validateToolOutput } from "@inspector/core/mcp/toolOutputValidation";

const provider = new AjvJsonSchemaValidator();

const schemaTool: Tool = {
  name: "get_temp",
  inputSchema: { type: "object" },
  outputSchema: {
    type: "object",
    properties: {
      temperature: { type: "number" },
      unit: { type: "string" },
    },
    required: ["temperature", "unit"],
    additionalProperties: false,
  },
};

const noSchemaTool: Tool = {
  name: "echo",
  inputSchema: { type: "object" },
};

function result(partial: Partial<CallToolResult>): CallToolResult {
  return {
    content: [{ type: "text", text: "ok" }],
    ...partial,
  } as CallToolResult;
}

describe("validateToolOutput", () => {
  it("returns undefined when the tool has no output schema", () => {
    expect(
      validateToolOutput(
        provider,
        noSchemaTool,
        result({ structuredContent: { x: 1 } }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when structuredContent matches the schema", () => {
    expect(
      validateToolOutput(
        provider,
        schemaTool,
        result({ structuredContent: { temperature: 25, unit: "C" } }),
      ),
    ).toBeUndefined();
  });

  it("returns a message when structuredContent has undeclared properties", () => {
    const message = validateToolOutput(
      provider,
      schemaTool,
      result({ structuredContent: { temperature: 25, unit: "C", extra: "x" } }),
    );
    expect(message).toBeTruthy();
    expect(message).toMatch(/additional propert/i);
  });

  it("returns a message when an output-schema tool returns no structuredContent", () => {
    const message = validateToolOutput(provider, schemaTool, result({}));
    expect(message).toBe(
      'Tool "get_temp" declares an output schema but returned no structured content',
    );
  });

  it("returns undefined when an output-schema tool errors without structuredContent", () => {
    expect(
      validateToolOutput(provider, schemaTool, result({ isError: true })),
    ).toBeUndefined();
  });

  it("swallows a schema that cannot be compiled", () => {
    // `required` must be an array — Ajv throws while compiling the validator;
    // the helper swallows it rather than producing a misleading warning.
    const badTool = {
      name: "bad",
      inputSchema: { type: "object" },
      outputSchema: { type: "object", required: "nope" },
    } as unknown as Tool;
    expect(
      validateToolOutput(provider, badTool, result({ structuredContent: {} })),
    ).toBeUndefined();
  });
});
