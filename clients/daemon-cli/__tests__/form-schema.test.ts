import { describe, it, expect } from "vitest";
import { parseFormSchema } from "../src/connection/form-schema.js";

describe("parseFormSchema", () => {
  it("returns null for a non-object schema", () => {
    expect(parseFormSchema(undefined)).toBeNull();
    expect(parseFormSchema({ type: "string" })).toBeNull();
  });

  it("returns null when properties is missing or not an object", () => {
    expect(parseFormSchema({ type: "object" })).toBeNull();
    expect(parseFormSchema({ type: "object", properties: "nope" })).toBeNull();
  });

  it("parses a string field with title/description/length/format/default", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Display Name",
          description: "Your name",
          minLength: 2,
          maxLength: 20,
          format: "email",
          default: "octocat",
        },
      },
      required: ["name"],
    });
    expect(fields).toEqual([
      {
        name: "name",
        required: true,
        title: "Display Name",
        description: "Your name",
        kind: "string",
        minLength: 2,
        maxLength: 20,
        format: "email",
        default: "octocat",
      },
    ]);
  });

  it("parses a number field, distinguishing integer from number", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        age: { type: "number", minimum: 18, maximum: 100, default: 30 },
        count: { type: "integer" },
      },
      properties2: undefined,
    } as Record<string, unknown>);
    expect(fields).toEqual([
      {
        name: "age",
        required: false,
        title: "age",
        description: undefined,
        kind: "number",
        integer: false,
        minimum: 18,
        maximum: 100,
        default: 30,
      },
      {
        name: "count",
        required: false,
        title: "count",
        description: undefined,
        kind: "number",
        integer: true,
        minimum: undefined,
        maximum: undefined,
        default: undefined,
      },
    ]);
  });

  it("parses a boolean field with a default", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: { confirm: { type: "boolean", default: false } },
    });
    expect(fields).toEqual([
      {
        name: "confirm",
        required: false,
        title: "confirm",
        description: undefined,
        kind: "boolean",
        default: false,
      },
    ]);
  });

  it("parses a single-select enum without titles", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        color: {
          type: "string",
          title: "Color",
          enum: ["Red", "Green", "Blue"],
          default: "Red",
        },
      },
    });
    expect(fields).toEqual([
      {
        name: "color",
        required: false,
        title: "Color",
        description: undefined,
        kind: "enum",
        choices: [
          { value: "Red", label: "Red" },
          { value: "Green", label: "Green" },
          { value: "Blue", label: "Blue" },
        ],
        default: "Red",
      },
    ]);
  });

  it("parses a single-select enum with titled oneOf", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        color: {
          type: "string",
          oneOf: [{ const: "#FF0000", title: "Red" }, { const: "#00FF00" }],
        },
      },
    });
    expect(fields).toEqual([
      {
        name: "color",
        required: false,
        title: "color",
        description: undefined,
        kind: "enum",
        choices: [
          { value: "#FF0000", label: "Red" },
          { value: "#00FF00", label: "#00FF00" },
        ],
        default: undefined,
      },
    ]);
  });

  it("returns null when oneOf entries are malformed", () => {
    expect(
      parseFormSchema({
        type: "object",
        properties: {
          color: { type: "string", oneOf: [{ notConst: true }] },
        },
      }),
    ).toBeNull();
    expect(
      parseFormSchema({
        type: "object",
        properties: { color: { type: "string", oneOf: "nope" } },
      }),
    ).toBeNull();
  });

  it("returns null for empty choice arrays (unwinnable required prompt otherwise)", () => {
    // A required field with zero options renders no choices and rejects
    // every answer (1..0 range) — treat the schema as malformed instead.
    expect(
      parseFormSchema({
        type: "object",
        properties: { color: { type: "string", enum: [] } },
        required: ["color"],
      }),
    ).toBeNull();
    expect(
      parseFormSchema({
        type: "object",
        properties: { color: { type: "string", oneOf: [] } },
      }),
    ).toBeNull();
    expect(
      parseFormSchema({
        type: "object",
        properties: {
          colors: { type: "array", items: { type: "string", enum: [] } },
        },
      }),
    ).toBeNull();
    expect(
      parseFormSchema({
        type: "object",
        properties: {
          colors: { type: "array", items: { type: "string", anyOf: [] } },
        },
      }),
    ).toBeNull();
    // Non-string enum entries stay malformed too (not a freeform string).
    expect(
      parseFormSchema({
        type: "object",
        properties: { color: { type: "string", enum: [1, 2] } },
      }),
    ).toBeNull();
  });

  it("parses a multi-select enum without titles, with min/maxItems and default", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        colors: {
          type: "array",
          title: "Colors",
          minItems: 1,
          maxItems: 2,
          items: { type: "string", enum: ["Red", "Green", "Blue"] },
          default: ["Red", "Green"],
        },
      },
    });
    expect(fields).toEqual([
      {
        name: "colors",
        required: false,
        title: "Colors",
        description: undefined,
        kind: "multiselect",
        choices: [
          { value: "Red", label: "Red" },
          { value: "Green", label: "Green" },
          { value: "Blue", label: "Blue" },
        ],
        minItems: 1,
        maxItems: 2,
        default: ["Red", "Green"],
      },
    ]);
  });

  it("parses a multi-select enum with titled anyOf", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        colors: {
          type: "array",
          items: {
            anyOf: [
              { const: "#FF0000", title: "Red" },
              { const: "#00FF00", title: "Green" },
            ],
          },
        },
      },
    });
    expect(fields?.[0]).toMatchObject({
      kind: "multiselect",
      choices: [
        { value: "#FF0000", label: "Red" },
        { value: "#00FF00", label: "Green" },
      ],
    });
  });

  it("returns null for an array field without items or without enum/anyOf", () => {
    expect(
      parseFormSchema({
        type: "object",
        properties: { colors: { type: "array" } },
      }),
    ).toBeNull();
    expect(
      parseFormSchema({
        type: "object",
        properties: {
          colors: { type: "array", items: { type: "string" } },
        },
      }),
    ).toBeNull();
  });

  it("ignores a non-string-array default on a multiselect field", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        colors: {
          type: "array",
          items: { type: "string", enum: ["Red"] },
          default: [1, 2],
        },
      },
    });
    expect(fields?.[0]).toMatchObject({ default: undefined });
  });

  it("returns null for an unsupported/unknown property type", () => {
    expect(
      parseFormSchema({
        type: "object",
        properties: { nested: { type: "object", properties: {} } },
      }),
    ).toBeNull();
  });

  it("returns null when a property isn't an object", () => {
    expect(
      parseFormSchema({
        type: "object",
        properties: { name: "not-a-schema" },
      }),
    ).toBeNull();
  });

  it("treats non-array/malformed required as no required fields", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: { name: { type: "string" } },
      required: "name",
    });
    expect(fields?.[0].required).toBe(false);
  });

  // Internally inconsistent fields are rejected like any other malformed
  // schema: unsatisfiable constraints or a default violating its own
  // constraints would render unwinnable / instantly-invalid prompts.
  it("returns null for unsatisfiable constraints", () => {
    const cases: Record<string, unknown>[] = [
      { n: { type: "number", minimum: 10, maximum: 5 } },
      { s: { type: "string", minLength: 5, maxLength: 2 } },
      { m: { type: "array", items: { enum: ["a"] }, minItems: 2 } },
      {
        m: {
          type: "array",
          items: { enum: ["a", "b"] },
          minItems: 2,
          maxItems: 1,
        },
      },
    ];
    for (const properties of cases) {
      expect(parseFormSchema({ type: "object", properties })).toBeNull();
    }
  });

  it("returns null for defaults that violate the field's own constraints", () => {
    const cases: Record<string, unknown>[] = [
      { n: { type: "number", minimum: 1, maximum: 10, default: 11 } },
      { n: { type: "number", minimum: 1, default: 0 } },
      { i: { type: "integer", default: 1.5 } },
      { s: { type: "string", minLength: 3, default: "ab" } },
      { s: { type: "string", maxLength: 2, default: "abc" } },
      { e: { type: "string", enum: ["a", "b"], default: "c" } },
      {
        e: {
          type: "string",
          oneOf: [{ const: "a", title: "A" }],
          default: "b",
        },
      },
      { m: { type: "array", items: { enum: ["a", "b"] }, default: ["c"] } },
      {
        m: {
          type: "array",
          items: { enum: ["a", "b"] },
          minItems: 2,
          default: ["a"],
        },
      },
      {
        m: {
          type: "array",
          items: { enum: ["a", "b"] },
          maxItems: 1,
          default: ["a", "b"],
        },
      },
    ];
    for (const properties of cases) {
      expect(parseFormSchema({ type: "object", properties })).toBeNull();
    }
  });

  it("accepts consistent constraints with in-range defaults", () => {
    const fields = parseFormSchema({
      type: "object",
      properties: {
        n: { type: "number", minimum: 1, maximum: 10, default: 5 },
        i: { type: "integer", minimum: 0, default: 0 },
        s: { type: "string", minLength: 1, maxLength: 3, default: "ab" },
        e: { type: "string", enum: ["a", "b"], default: "b" },
        m: {
          type: "array",
          items: { enum: ["a", "b"] },
          minItems: 1,
          maxItems: 2,
          default: ["a", "b"],
        },
      },
    });
    expect(fields).toHaveLength(5);
  });
});
