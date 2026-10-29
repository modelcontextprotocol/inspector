/**
 * Tests for the provider the CLI hands the SDK `Client`
 * (cli/src/utils/regexFreeSchemaValidator.ts): server-supplied regexes are
 * never evaluated, everything else is still validated by the SDK's own
 * validator, and the skipped patterns are reported.
 */
import { describe, it, expect, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RegexFreeJsonSchemaValidator } from "../src/utils/regexFreeSchemaValidator.js";

const NOTE = "1 regex pattern(s) in this schema were not evaluated";

function redosSchema(): JsonSchemaType {
  return {
    type: "object",
    properties: {
      data: { type: "string", pattern: "^(a+)+$", minLength: 3 },
      kind: { type: "string", enum: ["x", "y"] },
    },
    required: ["data", "kind"],
  } as JsonSchemaType;
}

describe("RegexFreeJsonSchemaValidator", () => {
  it("does not evaluate a catastrophic pattern, and reports that", () => {
    const onNote = vi.fn();
    const validate = new RegexFreeJsonSchemaValidator(onNote).getValidator(
      redosSchema(),
    );
    const result = validate({ data: `${"a".repeat(10_000)}!`, kind: "x" });
    expect(result.valid).toBe(true);
    expect(onNote).toHaveBeenCalledWith(NOTE);
  });

  it("still validates the other constraints, with the note on the error", () => {
    const validate = new RegexFreeJsonSchemaValidator(vi.fn()).getValidator(
      redosSchema(),
    );
    const tooShort = validate({ data: "a", kind: "x" });
    expect(tooShort.valid).toBe(false);
    expect(tooShort.errorMessage).toBe(
      `data/data must NOT have fewer than 3 characters (${NOTE})`,
    );
    expect(validate({ data: "aaa", kind: "z" }).errorMessage).toContain(
      "must be equal to one of the allowed values",
    );
    expect(validate({ data: "aaa" }).errorMessage).toContain(
      "must have required property 'kind'",
    );
    expect(validate({ data: 1, kind: "x" }).errorMessage).toContain(
      "must be string",
    );
  });

  it("leaves the schema object untouched", () => {
    const schema = redosSchema();
    const snapshot = JSON.parse(JSON.stringify(schema));
    new RegexFreeJsonSchemaValidator(vi.fn()).getValidator(schema);
    expect(schema).toEqual(snapshot);
  });

  it("is the SDK validator, unwrapped, for a schema without regexes", () => {
    const onNote = vi.fn();
    const schema = { type: "number" } as JsonSchemaType;
    const ours = new RegexFreeJsonSchemaValidator(onNote).getValidator(schema);
    const sdk = new AjvJsonSchemaValidator().getValidator(schema);
    expect(ours("x")).toEqual(sdk("x"));
    expect(ours(1)).toEqual(sdk(1));
    expect(onNote).not.toHaveBeenCalled();
  });

  it("keeps Client.callTool from hanging on a near-match result", async () => {
    // A low-level Server, so nothing on the server side validates the output.
    const server = new Server(
      { name: "redos", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "redos",
          inputSchema: { type: "object" },
          outputSchema: redosSchema() as { type: "object" },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [],
      structuredContent: { data: `${"a".repeat(10_000)}!`, kind: "x" },
    }));
    const onNote = vi.fn();
    const client = new Client(
      { name: "test", version: "1.0.0" },
      { jsonSchemaValidator: new RegexFreeJsonSchemaValidator(onNote) },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.listTools();
      const result = await client.callTool({ name: "redos" });
      expect(result.structuredContent).toEqual({
        data: `${"a".repeat(10_000)}!`,
        kind: "x",
      });
      expect(onNote).toHaveBeenCalledWith(NOTE);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
