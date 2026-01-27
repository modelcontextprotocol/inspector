import { cleanParams } from "../paramUtils";
import type { JsonSchemaType } from "../jsonUtils";

describe("cleanParams", () => {
  it("should preserve required fields even when undefined", () => {
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
      requiredString: undefined,
      requiredNumber: undefined,
      optionalString: undefined,
      optionalNumber: undefined,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      requiredString: undefined,
      requiredNumber: undefined,
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

  it("should handle the new undefined-first approach (no empty strings)", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: ["requiredField"],
      properties: {
        requiredField: { type: "string" },
        optionalField: { type: "string" },
      },
    };

    // New behavior: cleared fields are undefined, never empty strings
    const params = {
      requiredField: undefined, // cleared required field
      optionalField: undefined, // cleared optional field
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      requiredField: undefined, // required field preserved as undefined
      // optionalField omitted entirely
    });
  });

  it("should preserve null values when field has default: null", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        optionalFieldWithNullDefault: { type: "string", default: null },
        optionalFieldWithoutDefault: { type: "string" },
      },
    };

    const params = {
      optionalFieldWithNullDefault: null,
      optionalFieldWithoutDefault: null,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      optionalFieldWithNullDefault: null, // preserved because default: null
      // optionalFieldWithoutDefault omitted
    });
  });

  it("should preserve default values that match current value", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        fieldWithDefaultString: { type: "string", default: "defaultValue" },
        fieldWithDefaultNumber: { type: "number", default: 42 },
        fieldWithDefaultNull: { type: "string", default: null },
        fieldWithDefaultBoolean: { type: "boolean", default: false },
      },
    };

    const params = {
      fieldWithDefaultString: "defaultValue",
      fieldWithDefaultNumber: 42,
      fieldWithDefaultNull: null,
      fieldWithDefaultBoolean: false,
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      fieldWithDefaultString: "defaultValue",
      fieldWithDefaultNumber: 42,
      fieldWithDefaultNull: null,
      fieldWithDefaultBoolean: false,
    });
  });

  it("should omit values that do not match their default", () => {
    const schema: JsonSchemaType = {
      type: "object",
      required: [],
      properties: {
        fieldWithDefault: { type: "string", default: "defaultValue" },
      },
    };

    const params = {
      fieldWithDefault: null, // doesn't match default
    };

    const cleaned = cleanParams(params, schema);

    expect(cleaned).toEqual({
      // fieldWithDefault omitted because value (null) doesn't match default ("defaultValue")
    });
  });

  it("should fix regression from issue #846 - tools with multiple null defaults", () => {
    // Reproduces the exact scenario from https://github.com/modelcontextprotocol/inspector/issues/846
    // In v0.17.0, the cleanParams function would remove all null values,
    // breaking tools that have parameters with explicit default: null
    const schema: JsonSchemaType = {
      type: "object",
      required: ["requiredString"],
      properties: {
        optionalString: { type: ["string", "null"], default: null },
        optionalNumber: { type: ["number", "null"], default: null },
        optionalBoolean: { type: ["boolean", "null"], default: null },
        requiredString: { type: "string" },
      },
    };

    // When a user opens the tool in Inspector, fields initialize with their defaults
    const params = {
      optionalString: null, // initialized to default
      optionalNumber: null, // initialized to default
      optionalBoolean: null, // initialized to default
      requiredString: "test",
    };

    const cleaned = cleanParams(params, schema);

    // In v0.16, null defaults were preserved (working behavior)
    // In v0.17.0, they were removed (regression)
    // This fix restores the v0.16 behavior
    expect(cleaned).toEqual({
      optionalString: null,
      optionalNumber: null,
      optionalBoolean: null,
      requiredString: "test",
    });
  });
});
