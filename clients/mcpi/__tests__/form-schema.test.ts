import { describe, it, expect } from "vitest";
import { parseFormSchema } from "../src/session/form-schema.js";

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
});
