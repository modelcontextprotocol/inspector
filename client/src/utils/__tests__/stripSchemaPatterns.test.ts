import Ajv from "ajv";
import {
  patternsNotEvaluatedNote,
  stripSchemaPatterns,
} from "../stripSchemaPatterns";

const REDOS = "^(a+)+$";
const NEAR_MATCH = `${"a".repeat(10_000)}!`;

/** Compile with the client's own Ajv, as the app does. */
function compile(schema: unknown) {
  return new Ajv().compile(schema as object);
}

describe("stripSchemaPatterns", () => {
  it("removes every nested pattern without mutating the original", () => {
    const original = {
      type: "object",
      pattern: "^x$",
      properties: {
        a: { type: "string", pattern: REDOS },
        // A property NAMED "pattern" is not a keyword and must survive.
        pattern: { type: "string" },
        list: { type: "array", items: { type: "string", pattern: "^b$" } },
        tuple: { type: "array", items: [{ pattern: "^c$" }] },
      },
      additionalProperties: { pattern: "^d$" },
      allOf: [{ pattern: "^e$" }],
      anyOf: [{ pattern: "^f$" }],
      oneOf: [{ pattern: "^g$" }],
      not: { pattern: "^h$" },
      $defs: { x: { pattern: "^i$" } },
      definitions: { y: { pattern: "^j$" } },
      propertyNames: { pattern: "^k$" },
      dependencies: { a: ["b"], c: { pattern: "^l$" } },
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const { schema, stripped } = stripSchemaPatterns(original);

    expect(stripped).toBe(13);
    expect(JSON.stringify(schema)).not.toMatch(/"pattern":"/);
    expect(
      (schema as { properties: Record<string, unknown> }).properties.pattern,
    ).toEqual({ type: "string" });
    expect(original).toEqual(snapshot);
  });

  it("leaves `pattern` inside data positions alone", () => {
    const original = {
      type: "object",
      properties: { pattern: { type: "string" } },
      const: { pattern: REDOS },
      enum: [{ pattern: REDOS }],
      default: { pattern: REDOS },
    };
    const { schema, stripped, skipped } = stripSchemaPatterns(original);
    expect(schema).toEqual(original);
    expect(stripped).toBe(0);
    expect(skipped).toBe(0);
    expect(compile(schema)({ pattern: REDOS })).toBe(true);
  });

  it("drops patternProperties together with additionalProperties", () => {
    const original = {
      type: "object",
      properties: { id: { type: "number" } },
      patternProperties: { "^x-": { type: "string" }, "^y-": {} },
      additionalProperties: false,
    };
    const { schema, stripped, skipped } = stripSchemaPatterns(original);
    expect(stripped).toBe(2);
    expect(skipped).toBe(1);
    const out = schema as Record<string, unknown>;
    expect(out.patternProperties).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    // A key the server declared via patternProperties is not falsely
    // rejected as "additional"; the declared properties still validate.
    const validate = compile(schema);
    expect(validate({ id: 1, "x-a": "ok" })).toBe(true);
    expect(validate({ id: "1" })).toBe(false);
    expect(original.additionalProperties).toBe(false);
  });

  it("keeps additionalProperties beside an empty patternProperties", () => {
    const original = {
      type: "object",
      properties: { id: { type: "number" } },
      patternProperties: {},
      additionalProperties: false,
    };
    const { schema, stripped, skipped } = stripSchemaPatterns(original);
    expect(schema).toEqual(original);
    expect(stripped).toBe(0);
    expect(skipped).toBe(0);
    expect(compile(schema)({ id: 1, extra: true })).toBe(false);
  });

  describe("$ref", () => {
    it("removes a reference to a location that is not a schema", () => {
      const original = {
        type: "object",
        properties: { data: { $ref: "#/default" } },
        default: { type: "string", pattern: REDOS },
      };
      const { schema, stripped, skipped } = stripSchemaPatterns(original);
      const out = schema as {
        properties: { data: unknown };
        default: unknown;
      };
      expect(out.properties.data).toEqual({});
      expect(out.default).toEqual(original.default); // data, untouched
      expect(stripped).toBe(0);
      expect(skipped).toBe(1);
      expect(compile(schema)({ data: NEAR_MATCH })).toBe(true);
    });

    it("keeps a reference to a sanitized subschema", () => {
      const original = {
        type: "object",
        properties: { data: { $ref: "#/definitions/s" } },
        definitions: { s: { type: "string", pattern: REDOS } },
      };
      const { schema, stripped, skipped } = stripSchemaPatterns(original);
      expect(stripped).toBe(1);
      expect(skipped).toBe(0);
      const validate = compile(schema);
      expect(validate({ data: NEAR_MATCH })).toBe(true);
      expect(validate({ data: 1 })).toBe(false);
    });

    it("rewrites a reference into a removed patternProperties", () => {
      const original = {
        type: "object",
        properties: { data: { $ref: "#/patternProperties/^x-" } },
        patternProperties: { "^x-": { type: "string", pattern: REDOS } },
        additionalProperties: false,
      };
      const { schema, stripped, skipped } = stripSchemaPatterns(original);
      expect(stripped).toBe(2);
      expect(skipped).toBe(1);
      expect(JSON.stringify(schema)).not.toMatch(/"pattern":"/);
      const validate = compile(schema);
      expect(validate({ data: NEAR_MATCH, "x-a": 1 })).toBe(true);
      expect(validate({ data: 1 })).toBe(false); // the declared type holds
    });

    it("rewrites a reference into a removed `not`", () => {
      const original = {
        not: { type: "number", pattern: "^x$" },
        properties: { a: { $ref: "#/not" } },
      };
      const { schema, skipped } = stripSchemaPatterns(original);
      expect(skipped).toBe(1);
      const validate = compile(schema);
      expect(validate({ a: 1 })).toBe(true);
      expect(validate({ a: "s" })).toBe(false);
    });

    it("resolves escaped pointer segments", () => {
      const original = {
        properties: {
          "a/b~c%": { type: "string", pattern: REDOS },
          ref: { $ref: "#/properties/a~1b~0c%25" },
        },
      };
      const { schema, stripped, skipped } = stripSchemaPatterns(original);
      expect(stripped).toBe(1);
      expect(skipped).toBe(0);
      const validate = compile(schema);
      expect(validate({ ref: NEAR_MATCH })).toBe(true);
      expect(validate({ ref: 1 })).toBe(false);
    });

    it("keeps a reference cycle intact", () => {
      const original = {
        $ref: "#/definitions/node",
        definitions: {
          node: {
            type: "object",
            properties: { next: { $ref: "#/definitions/node" } },
          },
        },
      };
      const { schema, stripped, skipped } = stripSchemaPatterns(original);
      expect(stripped).toBe(0);
      expect(skipped).toBe(0);
      const validate = compile(schema);
      expect(validate({ next: { next: {} } })).toBe(true);
      expect(validate({ next: 1 })).toBe(false);
    });

    it("removes references that are remote, plain-name or $id-relative", () => {
      for (const original of [
        { properties: { a: { $ref: "other.json#/x" } } },
        { properties: { a: { $ref: "#anchor" } } },
        { properties: { a: { $ref: "#/%E0%A4%A" } } },
        {
          $id: "http://example.com/s.json",
          properties: { a: { $ref: "#/definitions/s" } },
          definitions: { s: { type: "string" } },
        },
        { properties: { a: { $dynamicRef: "#meta" } } },
      ]) {
        const { schema, skipped } = stripSchemaPatterns(original);
        expect(skipped).toBe(1);
        expect((schema as { properties: { a: unknown } }).properties.a).toEqual(
          {},
        );
      }
    });
  });

  describe("compositions a removed regex could flip", () => {
    it("drops `not` rather than leaving `not: {}`", () => {
      const original = { type: "string", not: { pattern: "^x$" } };
      const { schema, skipped } = stripSchemaPatterns(original);
      expect(skipped).toBe(1);
      expect((schema as Record<string, unknown>).not).toBeUndefined();
      expect(compile(schema)("abc")).toBe(true);
    });

    it("keeps an independent `not` beside a dropped one", () => {
      const { schema } = stripSchemaPatterns({
        allOf: [{ not: { type: "number" } }, { not: { pattern: "^x$" } }],
      });
      const validate = compile(schema);
      expect(validate("abc")).toBe(true);
      expect(validate(1)).toBe(false);
    });

    it("drops a `not` that reaches a pattern through a $ref", () => {
      const { schema, skipped } = stripSchemaPatterns({
        not: { $ref: "#/definitions/p" },
        definitions: { p: { pattern: "^x$" } },
      });
      expect(skipped).toBe(1);
      expect(compile(schema)("abc")).toBe(true);
    });

    it("drops a `oneOf` with a loosened branch", () => {
      const { schema, skipped } = stripSchemaPatterns({
        type: "string",
        oneOf: [{ pattern: "^a" }, { minLength: 3 }],
      });
      expect(skipped).toBe(1);
      expect(compile(schema)("bcd")).toBe(true); // matched one branch before
    });

    it("drops if/then/else when the condition lost a pattern", () => {
      const { schema, skipped } = stripSchemaPatterns({
        type: "string",
        maxLength: 4,
        if: { pattern: "^a" },
        then: { minLength: 3 },
        else: { maxLength: 2 },
      });
      expect(skipped).toBe(1);
      const validate = compile(schema);
      expect(validate("b")).toBe(true); // took `else` before
      expect(validate("bbbbb")).toBe(false); // the sibling still applies
    });

    it("keeps if/then/else when only a branch lost a pattern", () => {
      const { schema, skipped } = stripSchemaPatterns({
        if: { type: "string" },
        then: { minLength: 2, pattern: "^a" },
      });
      expect(skipped).toBe(0);
      const validate = compile(schema);
      expect(validate("b")).toBe(false);
      expect(validate("bb")).toBe(true);
    });

    it("drops `contains` and its bounds when it lost a pattern", () => {
      const { schema, skipped } = stripSchemaPatterns({
        type: "array",
        contains: { pattern: "^a" },
        minContains: 1,
        maxContains: 1,
      });
      expect(skipped).toBe(1);
      expect(schema).toEqual({
        type: "array",
        definitions: { __inspector_unevaluated_0: {} },
      });
    });

    it("drops unevaluated* where a sibling lost something", () => {
      const { schema, skipped } = stripSchemaPatterns({
        type: "object",
        patternProperties: { "^x-": {} },
        unevaluatedProperties: false,
      });
      expect(skipped).toBe(1);
      expect(
        (schema as Record<string, unknown>).unevaluatedProperties,
      ).toBeUndefined();
    });
  });

  describe("cost", () => {
    /** A wide schema: n properties, each with a pattern and a $ref. */
    const wide = (n: number) => {
      const properties: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        properties[`p${i}`] = { type: "string", pattern: "^x$" };
        properties[`r${i}`] = { $ref: `#/properties/p${i}` };
      }
      return { type: "object", properties, not: { $ref: "#/properties/p0" } };
    };
    /** A deep schema: a chain n levels down, under a `not`. */
    const deep = (n: number) => {
      let node: Record<string, unknown> = { type: "string", pattern: "^x$" };
      for (let i = 0; i < n; i++) node = { properties: { a: node } };
      return { not: node };
    };
    /** Fastest of three runs, in ms (the minimum is least noisy). */
    const time = (schema: unknown) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        stripSchemaPatterns(schema);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };

    it("sanitizes a 10,000-property schema correctly", () => {
      const { schema, stripped, skipped } = stripSchemaPatterns(wide(10_000));
      expect(stripped).toBe(10_000);
      expect(skipped).toBe(1); // the `not`
      const out = schema as { properties: Record<string, unknown> };
      expect(out.properties.p9999).toEqual({ type: "string" });
      expect(out.properties.r9999).toEqual({ $ref: "#/properties/p9999" });
      const { stripped: deepStripped, skipped: deepSkipped } =
        stripSchemaPatterns(deep(1_000));
      expect(deepStripped).toBe(1);
      expect(deepSkipped).toBe(1);
    });

    it("grows linearly with the schema's width and depth", () => {
      // Quadratic work grows 16x for 4x the input; linear grows 4x. The
      // generous bounds absorb timer noise and a loaded machine.
      time(wide(1_000)); // warm up the JIT
      const small = Math.max(time(wide(2_500)), 1);
      const large = time(wide(10_000));
      expect(large).toBeLessThan(1_000);
      expect(large / small).toBeLessThan(10);
      const shallow = Math.max(time(deep(250)), 1);
      const deeper = time(deep(1_000));
      expect(deeper).toBeLessThan(1_000);
      expect(deeper / shallow).toBeLessThan(10);
    });
  });

  it("leaves a schema without regexes equivalent and counts zero", () => {
    expect(stripSchemaPatterns({ type: "string" })).toEqual({
      schema: { type: "string" },
      stripped: 0,
      skipped: 0,
    });
    expect(stripSchemaPatterns(true)).toEqual({
      schema: true,
      stripped: 0,
      skipped: 0,
    });
  });

  it("does not collide with existing definitions", () => {
    const { schema } = stripSchemaPatterns({
      not: { pattern: "^x$" },
      definitions: { __inspector_unevaluated_0: { type: "number" } },
    });
    expect(
      Object.keys((schema as { definitions: object }).definitions),
    ).toEqual(["__inspector_unevaluated_0", "__inspector_unevaluated_1"]);
  });

  it("formats the note", () => {
    expect(patternsNotEvaluatedNote(2)).toBe(
      "2 regex pattern(s) in this schema were not evaluated",
    );
    expect(patternsNotEvaluatedNote(1, 2)).toBe(
      "1 regex pattern(s) in this schema were not evaluated; 2 check(s) in this schema were skipped because they depend on an unevaluated pattern or an unresolvable $ref",
    );
    expect(patternsNotEvaluatedNote(0, 1)).toBe(
      "1 check(s) in this schema were skipped because they depend on an unevaluated pattern or an unresolvable $ref",
    );
  });
});
