/**
 * Tests for the bounded-time JSON Schema provider
 * (core/mcp/linearPatternValidator.ts) InspectorClient uses for
 * server-supplied schemas.
 *
 * It must behave as the SDK's Ajv provider does on ordinary schemas — same
 * verdicts, same error text — while evaluating a catastrophic `pattern`
 * without backtracking, and it must report a pattern it could not evaluate as
 * a failure rather than a pass.
 */
import { describe, it, expect } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type {
  CallToolResult,
  JsonSchemaType,
  Tool,
} from "@modelcontextprotocol/client";
import {
  LinearPatternJsonSchemaValidator,
  PATTERN_EVALUATION_BUDGET,
} from "@inspector/core/mcp/linearPatternValidator";
import { validateToolOutput } from "@inspector/core/mcp/toolOutputValidation";

function check(schema: JsonSchemaType, value: unknown) {
  return new LinearPatternJsonSchemaValidator().getValidator(schema)(value);
}

describe("LinearPatternJsonSchemaValidator — parity with the SDK provider", () => {
  const sdk = new AjvJsonSchemaValidator();
  const schema: JsonSchemaType = {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^[a-z]{3}-\\d+$" },
      email: { type: "string", format: "email" },
      count: { type: "number" },
    },
    required: ["id", "count"],
    additionalProperties: false,
  };

  it.each([
    [{ id: "abc-1", count: 1 }],
    [{ id: "abc-1", count: 1, email: "a@b.io" }],
    [{ id: "ab-1", count: 1 }],
    [{ id: "abc-1", count: "1" }],
    [{ id: "abc-1", count: 1, email: "not-an-email" }],
    [{ id: "abc-1" }],
    [{ id: "abc-1", count: 1, extra: true }],
  ])("agrees on %j", (value) => {
    const ours = check(schema, value);
    const theirs = sdk.getValidator(schema)(value);
    expect(ours).toEqual(theirs);
  });

  it("returns the validated value as data", () => {
    expect(check({ type: "string" }, "x")).toEqual({
      valid: true,
      data: "x",
      errorMessage: undefined,
    });
  });

  it("dispatches on the declared dialect", () => {
    const draft7: JsonSchemaType = {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: { n: { type: "number" } },
      type: "object",
      properties: { n: { $ref: "#/definitions/n" } },
    };
    expect(check(draft7, { n: 1 }).valid).toBe(true);
    expect(check(draft7, { n: "x" }).valid).toBe(false);

    const draft2019: JsonSchemaType = {
      $schema: "https://json-schema.org/draft/2019-09/schema",
      type: "string",
      pattern: "^a+$",
    };
    expect(check(draft2019, "aaa").valid).toBe(true);
    expect(check(draft2019, "b").valid).toBe(false);

    const draft2020: JsonSchemaType = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "array",
      prefixItems: [{ type: "number" }],
    };
    expect(check(draft2020, [1]).valid).toBe(true);
    expect(check(draft2020, ["x"]).valid).toBe(false);
  });

  it("rejects an unsupported dialect at compile time, as the SDK does", () => {
    expect(() =>
      check({ $schema: "https://example.com/my-dialect" }, {}),
    ).toThrow(/unsupported dialect/);
  });

  it("reuses a compiled schema by $id instead of re-registering it", () => {
    const provider = new LinearPatternJsonSchemaValidator();
    const schema: JsonSchemaType = { $id: "urn:test:one", type: "number" };
    expect(provider.getValidator(schema)(1).valid).toBe(true);
    expect(provider.getValidator(schema)("x").valid).toBe(false);
  });

  it("fails compilation for an invalid pattern", () => {
    expect(() => check({ type: "string", pattern: "(a" }, "a")).toThrow();
  });
});

describe("LinearPatternJsonSchemaValidator — bounded pattern evaluation", () => {
  const redos: JsonSchemaType = {
    type: "object",
    properties: { data: { type: "string", pattern: "^(a+)+$" } },
  };

  it("evaluates a catastrophic pattern against a near-match and reports the mismatch", () => {
    // ~2^5000 steps on the native engine; one linear pass here.
    const result = check(redos, { data: `${"a".repeat(5_000)}!` });
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe('data/data must match pattern "^(a+)+$"');
  });

  it("still accepts a value the catastrophic pattern matches", () => {
    expect(check(redos, { data: "a".repeat(5_000) }).valid).toBe(true);
  });

  it("applies patternProperties through the same engine", () => {
    const schema: JsonSchemaType = {
      type: "object",
      patternProperties: { "^(x+)+-": { type: "number" } },
      additionalProperties: false,
    };
    expect(check(schema, { "xx-a": 1 }).valid).toBe(true);
    expect(check(schema, { "xx-a": "1" }).valid).toBe(false);
    expect(check(schema, { [`${"x".repeat(3_000)}!`]: 1 }).valid).toBe(false);
  });

  it("reports a pattern it cannot evaluate as unverified, never as valid", () => {
    const schema: JsonSchemaType = {
      type: "string",
      pattern: "^(?=a)a+$",
    };
    // "aaa" would match natively; the lookahead cannot be evaluated here.
    const result = check(schema, "aaa");
    expect(result.valid).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.errorMessage).toBe(
      'pattern "^(?=a)a+$" was not evaluated (lookaround or group modifier), so the value could not be verified against the schema',
    );
  });

  it("reports real errors alongside an unevaluated pattern", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: {
        a: { type: "string", pattern: "(x)\\1" },
        b: { type: "number" },
      },
    };
    const result = check(schema, { a: "xx", b: "nope" });
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBe(
      'data/b must be number; pattern "(x)\\1" was not evaluated (backreference), so the value could not be verified against the schema',
    );
  });

  it("quotes a long unevaluated pattern truncated", () => {
    const pattern = `(?=a)${"b".repeat(200)}`;
    const result = check({ type: "string", pattern }, "a");
    expect(result.errorMessage).toContain(`${pattern.slice(0, 120)}…`);
  });

  it("caps total pattern work per validation and says which pattern went unchecked", () => {
    const provider = new LinearPatternJsonSchemaValidator();
    const validate = provider.getValidator({
      type: "array",
      items: { type: "string", pattern: "^a+$" },
    });
    // Each string alone fits; together they exceed the per-validation budget.
    const long = "a".repeat(Math.ceil(PATTERN_EVALUATION_BUDGET / 20));
    const flood = validate(Array.from({ length: 30 }, () => long));
    expect(flood.valid).toBe(false);
    expect(flood.errorMessage).toMatch(
      /^pattern "\^a\+\$" was not evaluated \(checking a \d+-character value would exceed the evaluation budget\)/,
    );

    // The budget is per validation: the next one starts afresh.
    expect(validate(["aaa"]).valid).toBe(true);
  });
});

describe("validateToolOutput with the bounded provider", () => {
  const tool: Tool = {
    name: "redos",
    inputSchema: { type: "object" },
    outputSchema: {
      type: "object",
      properties: { data: { type: "string", pattern: "^(a+)+$" } },
    },
  };
  const result = (data: string): CallToolResult => ({
    content: [],
    structuredContent: { data },
  });

  it("surfaces the mismatch for a near-match payload instead of hanging", () => {
    const provider = new LinearPatternJsonSchemaValidator();
    expect(
      validateToolOutput(provider, tool, result(`${"a".repeat(10_000)}!`)),
    ).toBe('data/data must match pattern "^(a+)+$"');
    expect(
      validateToolOutput(provider, tool, result("a".repeat(10_000))),
    ).toBeUndefined();
  });
});
