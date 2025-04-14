import { generateDefaultValue, formatFieldLabel } from "../schemaUtils";
import type { JsonSchemaType } from "../jsonUtils";

describe("generateDefaultValue", () => {
  test("generates default string", () => {
    expect(generateDefaultValue({ type: "string", required: true })).toBe("");
  });

  test("generates default number", () => {
    expect(generateDefaultValue({ type: "number", required: true })).toBe(0);
  });

  test("generates default integer", () => {
    expect(generateDefaultValue({ type: "integer", required: true })).toBe(0);
  });

  test("generates default boolean", () => {
    expect(generateDefaultValue({ type: "boolean", required: true })).toBe(
      false,
    );
  });

  test("generates default array", () => {
    expect(generateDefaultValue({ type: "array", required: true })).toEqual([]);
  });

  test("generates default empty object", () => {
    expect(generateDefaultValue({ type: "object", required: true })).toEqual(
      {},
    );
  });

  test("generates default null for unknown types", () => {
    // @ts-expect-error Testing with invalid type
    expect(generateDefaultValue({ type: "unknown", required: true })).toBe(
      null,
    );
  });

  test("generates empty array for non-required array", () => {
    expect(generateDefaultValue({ type: "array", required: false })).toEqual(
      [],
    );
  });

  test("generates empty object for non-required object", () => {
    expect(generateDefaultValue({ type: "object", required: false })).toEqual(
      {},
    );
  });

  test("generates null for non-required primitive types", () => {
    expect(generateDefaultValue({ type: "string", required: false })).toBe(
      null,
    );
    expect(generateDefaultValue({ type: "number", required: false })).toBe(
      null,
    );
    expect(generateDefaultValue({ type: "boolean", required: false })).toBe(
      null,
    );
  });

  test("generates object with properties", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: true,
      properties: {
        name: { type: "string", required: true },
        age: { type: "number", required: true },
        isActive: { type: "boolean", required: true },
      },
    };
    expect(generateDefaultValue(schema)).toEqual({
      name: "",
      age: 0,
      isActive: false,
    });
  });

  test("handles nested objects", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: true,
      properties: {
        user: {
          type: "object",
          required: true,
          properties: {
            name: { type: "string", required: true },
            address: {
              type: "object",
              required: true,
              properties: {
                city: { type: "string", required: true },
              },
            },
          },
        },
      },
    };
    expect(generateDefaultValue(schema)).toEqual({
      user: {
        name: "",
        address: {
          city: "",
        },
      },
    });
  });

  test("uses schema default value when provided", () => {
    expect(generateDefaultValue({ type: "string", default: "test" })).toBe(
      "test",
    );
  });
});

describe("formatFieldLabel", () => {
  test("formats camelCase", () => {
    expect(formatFieldLabel("firstName")).toBe("First Name");
  });

  test("formats snake_case", () => {
    expect(formatFieldLabel("first_name")).toBe("First name");
  });

  test("formats single word", () => {
    expect(formatFieldLabel("name")).toBe("Name");
  });

  test("formats mixed case with underscores", () => {
    expect(formatFieldLabel("user_firstName")).toBe("User first Name");
  });

  test("handles empty string", () => {
    expect(formatFieldLabel("")).toBe("");
  });
});
