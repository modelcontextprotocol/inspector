import Ajv from "ajv";
import {
  patternsNotEvaluatedNote,
  stripSchemaPatterns,
} from "../stripSchemaPatterns";

describe("stripSchemaPatterns", () => {
  it("removes every nested pattern without mutating the original", () => {
    const original = {
      type: "object",
      pattern: "^x$",
      properties: {
        a: { type: "string", pattern: "^(a+)+$" },
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

  it("drops patternProperties together with additionalProperties", () => {
    const original = {
      type: "object",
      properties: { id: { type: "number" } },
      patternProperties: { "^x-": { type: "string" }, "^y-": {} },
      additionalProperties: false,
    };
    const { schema, stripped } = stripSchemaPatterns(original);
    expect(stripped).toBe(2);
    expect(schema).toEqual({
      type: "object",
      properties: { id: { type: "number" } },
    });
    // A key the server declared via patternProperties is not falsely
    // rejected as "additional"; the declared properties still validate.
    const validate = new Ajv().compile(schema as object);
    expect(validate({ id: 1, "x-a": "ok" })).toBe(true);
    expect(validate({ id: "1" })).toBe(false);
    expect(original.additionalProperties).toBe(false);
  });

  it("leaves a schema without regexes equivalent and counts zero", () => {
    expect(stripSchemaPatterns({ type: "string" })).toEqual({
      schema: { type: "string" },
      stripped: 0,
    });
    expect(stripSchemaPatterns(true)).toEqual({ schema: true, stripped: 0 });
  });

  it("formats the note", () => {
    expect(patternsNotEvaluatedNote(2)).toBe(
      "2 regex pattern(s) in this schema were not evaluated",
    );
  });
});
