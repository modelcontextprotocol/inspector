import { cleanParams } from "../paramUtils";
import type { JsonSchemaType } from "../jsonUtils";

describe("cleanParams", () => {
  it("should preserve required fields even when empty", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: ["requiredString", "requiredNumber"],
      properties: {
        requiredString: { type: "string" },
        requiredNumber: { type: "number" },
        optionalString: { type: "string" },
        optionalNumber: { type: "number" },
      },
    };

    const params = {
      requiredString: "",
      requiredNumber: 0,
      optionalString: "",
      optionalNumber: undefined,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      requiredString: "",
      requiredNumber: 0,
      // optionalString and optionalNumber should be omitted
    });
  });

  it("should omit optional fields with empty strings", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalString: { type: "string" },
        optionalNumber: { type: "number" },
      },
    };

    const params = {
      optionalString: "",
      optionalNumber: "",
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({});
  });

  it("should omit optional fields with undefined values", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalString: { type: "string" },
        optionalNumber: { type: "number" },
      },
    };

    const params = {
      optionalString: undefined,
      optionalNumber: undefined,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({});
  });

  it("should omit optional fields with null values", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalString: { type: "string" },
        optionalNumber: { type: "number" },
      },
    };

    const params = {
      optionalString: null,
      optionalNumber: null,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({});
  });

  it("should preserve optional fields with meaningful values", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalString: { type: "string" },
        optionalNumber: { type: "number" },
        optionalBoolean: { type: "boolean" },
      },
    };

    const params = {
      optionalString: "hello",
      optionalNumber: 42,
      optionalBoolean: false, // false is a meaningful value
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      optionalString: "hello",
      optionalNumber: 42,
      optionalBoolean: false,
    });
  });

  it("should handle mixed required and optional fields", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: ["requiredField"],
      properties: {
        requiredField: { type: "string" },
        optionalWithValue: { type: "string" },
        optionalEmpty: { type: "string" },
        optionalUndefined: { type: "number" },
      },
    };

    const params = {
      requiredField: "",
      optionalWithValue: "test",
      optionalEmpty: "",
      optionalUndefined: undefined,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      requiredField: "",
      optionalWithValue: "test",
    });
  });

  it("should handle schema without required array", () => {
    const schema: JsonSchemaType = {
      type: "object",
      properties: {
        field1: { type: "string" },
        field2: { type: "number" },
      },
    };

    const params = {
      field1: "",
      field2: undefined,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({});
  });

  it("should preserve zero values for numbers", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalNumber: { type: "number" },
      },
    };

    const params = {
      optionalNumber: 0,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      optionalNumber: 0,
    });
  });
});
