/**
 * Tests for cli/src/utils/stripSchemaPatterns.ts (a copy of the web client's
 * helper), checked against the SDK's own Ajv-based validator — the one the
 * CLI hands the `Client` — so each transform is shown to compile there and
 * never to reject a value the original schema accepts.
 */
import { describe, it, expect } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { stripSchemaPatterns } from "../src/utils/stripSchemaPatterns.js";

const REDOS = "^(a+)+$";
const NEAR_MATCH = `${"a".repeat(10_000)}!`;

function strip(schema: unknown) {
  const result = stripSchemaPatterns(schema);
  const validate = new AjvJsonSchemaValidator().getValidator(
    result.schema as JsonSchemaType,
  );
  return { ...result, valid: (input: unknown) => validate(input).valid };
}

describe("stripSchemaPatterns (cli)", () => {
  it("removes a pattern but not a property NAMED pattern", () => {
    const { schema, stripped, valid } = strip({
      type: "object",
      properties: {
        pattern: { type: "string", pattern: REDOS },
      },
    });
    expect(stripped).toBe(1);
    expect(schema).toEqual({
      type: "object",
      properties: { pattern: { type: "string" } },
    });
    expect(valid({ pattern: NEAR_MATCH })).toBe(true);
    expect(valid({ pattern: 1 })).toBe(false);
  });

  it("removes a $ref to a non-schema location", () => {
    const { stripped, skipped, valid } = strip({
      type: "object",
      properties: { data: { $ref: "#/default" } },
      default: { type: "string", pattern: REDOS },
    });
    expect(stripped).toBe(0);
    expect(skipped).toBe(1);
    expect(valid({ data: NEAR_MATCH })).toBe(true);
  });

  it("keeps additionalProperties beside an empty patternProperties", () => {
    const original = {
      type: "object",
      patternProperties: {},
      additionalProperties: false,
    };
    const { schema, stripped, skipped, valid } = strip(original);
    expect(schema).toEqual(original);
    expect(stripped + skipped).toBe(0);
    expect(valid({ extra: 1 })).toBe(false);
  });

  it("rewrites a $ref into a removed patternProperties", () => {
    const { schema, stripped, skipped, valid } = strip({
      type: "object",
      properties: { data: { $ref: "#/patternProperties/^x-" } },
      patternProperties: { "^x-": { type: "string", pattern: REDOS } },
      additionalProperties: false,
    });
    expect(stripped).toBe(2);
    expect(skipped).toBe(1);
    expect(JSON.stringify(schema)).not.toMatch(/"pattern":"/);
    expect(valid({ data: NEAR_MATCH, "x-a": 1 })).toBe(true);
    expect(valid({ data: 1 })).toBe(false);
  });

  it("drops not / oneOf / if that a removed pattern could flip", () => {
    expect(
      strip({ type: "string", not: { pattern: "^x$" } }).valid("abc"),
    ).toBe(true);
    expect(
      strip({
        type: "string",
        oneOf: [{ pattern: "^a" }, { minLength: 3 }],
      }).valid("bcd"),
    ).toBe(true);
    const conditional = strip({
      type: "string",
      maxLength: 4,
      if: { pattern: "^a" },
      then: { minLength: 3 },
      else: { maxLength: 2 },
    });
    expect(conditional.skipped).toBe(1);
    expect(conditional.valid("b")).toBe(true);
    expect(conditional.valid("bbbbb")).toBe(false);
  });
});
