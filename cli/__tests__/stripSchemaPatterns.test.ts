/**
 * Tests for cli/src/utils/stripSchemaPatterns.ts (a copy of the web client's
 * helper), checked against the SDK's own Ajv-based validator — the one the
 * CLI hands the `Client` — so each transform is shown to compile there and
 * never to reject a value the original schema accepts.
 */
import { describe, it, expect, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import {
  schemaNote,
  stripSchemaPatterns,
} from "../src/utils/stripSchemaPatterns.js";
import { RegexFreeJsonSchemaValidator } from "../src/utils/regexFreeSchemaValidator.js";

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

  it("does not validate a schema whose relocated $ids would collide", () => {
    const schema = {
      properties: {
        x: { $id: "a/", not: { $id: "leaf", type: "string", pattern: "^x" } },
        y: { $id: "b/", not: { $id: "leaf", type: "number", pattern: "^y" } },
      },
    };
    const result = stripSchemaPatterns(schema);
    expect(result.validate).toBe(false);
    const onNote = vi.fn();
    const validate = new RegexFreeJsonSchemaValidator(onNote).getValidator(
      schema as JsonSchemaType,
    );
    expect(validate({ x: "x", y: 1 }).valid).toBe(true);
    expect(onNote).toHaveBeenCalledWith(schemaNote(result));
    expect(schemaNote(result)).toMatch(/was not validated/);
  });

  it("drops a removed $ref's siblings with it", () => {
    const { schema, skipped, valid } = strip({
      properties: { v: { $ref: "#/default", type: "number" } },
      default: { type: "string" },
    });
    expect(skipped).toBe(1);
    expect((schema as { properties: { v: unknown } }).properties.v).toEqual({});
    expect(valid({ v: "s" })).toBe(true);
    expect(valid({ v: 1 })).toBe(true);
  });

  it("never rejects a value the original accepts (corpus)", () => {
    // Safe, linear patterns only, so the original can be evaluated too.
    const corpus: [unknown, unknown[]][] = [
      [{ type: "string", not: { pattern: "^x$" } }, ["abc", "x", 1]],
      [
        { type: "string", oneOf: [{ pattern: "^a" }, { minLength: 3 }] },
        ["bcd", "a", "abc", "b"],
      ],
      [
        {
          type: "string",
          maxLength: 4,
          if: { pattern: "^a" },
          then: { minLength: 3 },
          else: { maxLength: 2 },
        },
        ["b", "abc", "ab", "bbbbb"],
      ],
      [
        {
          type: "object",
          properties: { id: { type: "number" } },
          patternProperties: { "^x-": { type: "string" } },
          additionalProperties: false,
        },
        [{ id: 1, "x-a": "ok" }, { id: 1, z: 1 }, { "x-a": 1 }],
      ],
      [
        {
          type: "object",
          properties: { data: { $ref: "#/patternProperties/^x-" } },
          patternProperties: { "^x-": { type: "string", pattern: "^a" } },
          additionalProperties: false,
        },
        [{ data: "a" }, { data: "b" }, { data: 1 }, { "x-q": "aa" }],
      ],
      [
        {
          properties: { v: { $ref: "#/default", type: "number" } },
          default: { type: "string" },
        },
        [{ v: "s" }, { v: 1 }],
      ],
      [
        { type: "array", contains: { pattern: "^a" }, maxContains: 1 },
        [["a"], ["a", "a"], ["b"]],
      ],
      [
        {
          type: "object",
          patternProperties: { "^a": {} },
          unevaluatedProperties: false,
        },
        [{ a: 1 }, { b: 1 }],
      ],
    ];
    for (const [original, values] of corpus) {
      const before = new AjvJsonSchemaValidator().getValidator(
        original as JsonSchemaType,
      );
      const { validate, valid } = strip(original);
      expect(validate).toBe(true);
      const accepted = values.filter((value) => before(value).valid);
      expect(accepted.filter((value) => !valid(value))).toEqual([]);
    }
  });

  it("grows linearly with schema size", () => {
    const wide = (n: number) => {
      const properties: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        properties[`p${i}`] = { type: "string", pattern: "^x$" };
        properties[`r${i}`] = { $ref: `#/properties/p${i}` };
      }
      return { type: "object", properties, not: { $ref: "#/properties/p0" } };
    };
    // Fastest of three runs, in ms; quadratic work grows 16x for 4x the
    // input and linear 4x, and the generous bounds absorb timer noise.
    const time = (schema: unknown) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        stripSchemaPatterns(schema);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    time(wide(1_000)); // warm up the JIT
    const small = Math.max(time(wide(2_500)), 1);
    const large = time(wide(10_000));
    expect(large).toBeLessThan(1_000);
    expect(large / small).toBeLessThan(10);
    expect(stripSchemaPatterns(wide(10_000)).stripped).toBe(10_000);
  });
});
