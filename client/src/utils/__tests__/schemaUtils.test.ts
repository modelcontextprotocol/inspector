import {
  generateDefaultValue,
  formatFieldLabel,
  validateValueAgainstSchema,
} from "../schemaUtils";
import { JsonSchemaType } from "../../components/DynamicJsonForm";

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

describe("validateValueAgainstSchema", () => {
  test("validates string type", () => {
    expect(validateValueAgainstSchema("test", { type: "string" })).toBe(true);
    expect(validateValueAgainstSchema(123, { type: "string" })).toBe(false);
  });

  test("validates number type", () => {
    expect(validateValueAgainstSchema(123, { type: "number" })).toBe(true);
    expect(validateValueAgainstSchema("test", { type: "number" })).toBe(false);
  });

  test("validates integer type", () => {
    expect(validateValueAgainstSchema(123, { type: "integer" })).toBe(true);
    expect(validateValueAgainstSchema("test", { type: "integer" })).toBe(false);
  });

  test("validates boolean type", () => {
    expect(validateValueAgainstSchema(true, { type: "boolean" })).toBe(true);
    expect(validateValueAgainstSchema("test", { type: "boolean" })).toBe(false);
  });

  test("validates array type", () => {
    expect(validateValueAgainstSchema([], { type: "array" })).toBe(true);
    expect(validateValueAgainstSchema({}, { type: "array" })).toBe(false);
  });

  test("validates object type", () => {
    expect(validateValueAgainstSchema({}, { type: "object" })).toBe(true);
    expect(validateValueAgainstSchema([], { type: "object" })).toBe(false);
    expect(validateValueAgainstSchema("test", { type: "object" })).toBe(false);
  });

  test("returns true for unknown types", () => {
    expect(
      // @ts-expect-error Testing with invalid type
      validateValueAgainstSchema("anything", { type: "unknown" }),
    ).toBe(true);
  });
});
