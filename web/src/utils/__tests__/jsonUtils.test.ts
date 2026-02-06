import {
  getDataType,
  tryParseJson,
  updateValueAtPath,
  getValueAtPath,
} from "../jsonUtils";
import type { JsonValue, JsonSchemaType } from "../jsonUtils";

describe("getDataType", () => {
  test("should return 'string' for string values", () => {
    expect(getDataType("hello")).toBe("string");
    expect(getDataType("")).toBe("string");
  });

  test("should return 'number' for number values", () => {
    expect(getDataType(123)).toBe("number");
    expect(getDataType(0)).toBe("number");
    expect(getDataType(-10)).toBe("number");
    expect(getDataType(1.5)).toBe("number");
    expect(getDataType(NaN)).toBe("number");
    expect(getDataType(Infinity)).toBe("number");
  });

  test("should return 'boolean' for boolean values", () => {
    expect(getDataType(true)).toBe("boolean");
    expect(getDataType(false)).toBe("boolean");
  });

  test("should return 'undefined' for undefined value", () => {
    expect(getDataType(undefined)).toBe("undefined");
  });

  test("should return 'object' for object values", () => {
    expect(getDataType({})).toBe("object");
    expect(getDataType({ key: "value" })).toBe("object");
  });

  test("should return 'array' for array values", () => {
    expect(getDataType([])).toBe("array");
    expect(getDataType([1, 2, 3])).toBe("array");
    expect(getDataType(["a", "b", "c"])).toBe("array");
    expect(getDataType([{}, { nested: true }])).toBe("array");
  });

  test("should return 'null' for null value", () => {
    expect(getDataType(null)).toBe("null");
  });
});

describe("tryParseJson", () => {
  test("should correctly parse valid JSON object", () => {
    const jsonString = '{"name":"test","value":123}';
    const result = tryParseJson(jsonString);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: "test", value: 123 });
  });

  test("should correctly parse valid JSON array", () => {
    const jsonString = '[1,2,3,"test"]';
    const result = tryParseJson(jsonString);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3, "test"]);
  });

  test("should correctly parse JSON with whitespace", () => {
    const jsonString = '  {  "name"  :  "test"  }  ';
    const result = tryParseJson(jsonString);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: "test" });
  });

  test("should correctly parse nested JSON structures", () => {
    const jsonString =
      '{"user":{"name":"test","details":{"age":30}},"items":[1,2,3]}';
    const result = tryParseJson(jsonString);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      user: {
        name: "test",
        details: {
          age: 30,
        },
      },
      items: [1, 2, 3],
    });
  });

  test("should correctly parse empty objects and arrays", () => {
    expect(tryParseJson("{}").success).toBe(true);
    expect(tryParseJson("{}").data).toEqual({});

    expect(tryParseJson("[]").success).toBe(true);
    expect(tryParseJson("[]").data).toEqual([]);
  });

  test("should return failure for non-JSON strings", () => {
    const nonJsonString = "this is not json";
    const result = tryParseJson(nonJsonString);

    expect(result.success).toBe(false);
    expect(result.data).toBe(nonJsonString);
  });

  test("should return failure for malformed JSON", () => {
    const malformedJson = '{"name":"test",}';
    const result = tryParseJson(malformedJson);

    expect(result.success).toBe(false);
    expect(result.data).toBe(malformedJson);
  });

  test("should return failure for strings with correct delimiters but invalid JSON", () => {
    const invalidJson = "{name:test}";
    const result = tryParseJson(invalidJson);

    expect(result.success).toBe(false);
    expect(result.data).toBe(invalidJson);
  });

  test("should handle edge cases", () => {
    expect(tryParseJson("").success).toBe(false);
    expect(tryParseJson("").data).toBe("");

    expect(tryParseJson("   ").success).toBe(false);
    expect(tryParseJson("   ").data).toBe("   ");

    expect(tryParseJson("null").success).toBe(false);
    expect(tryParseJson("null").data).toBe("null");

    expect(tryParseJson('"string"').success).toBe(false);
    expect(tryParseJson('"string"').data).toBe('"string"');

    expect(tryParseJson("123").success).toBe(false);
    expect(tryParseJson("123").data).toBe("123");

    expect(tryParseJson("true").success).toBe(false);
    expect(tryParseJson("true").data).toBe("true");
  });
});

describe("updateValueAtPath", () => {
  // Basic functionality tests
  test("returns the new value when path is empty", () => {
    expect(updateValueAtPath({ foo: "bar" }, [], "newValue")).toBe("newValue");
  });

  test("initializes an empty object when input is null/undefined and path starts with a string", () => {
    expect(updateValueAtPath(null, ["foo"], "bar")).toEqual({
      foo: "bar",
    });
    expect(updateValueAtPath(undefined, ["foo"], "bar")).toEqual({
      foo: "bar",
    });
  });

  test("initializes an empty array when input is null/undefined and path starts with a number", () => {
    expect(updateValueAtPath(null, ["0"], "bar")).toEqual(["bar"]);
    expect(updateValueAtPath(undefined, ["0"], "bar")).toEqual(["bar"]);
  });

  // Object update tests
  test("updates a simple object property", () => {
    const obj = { name: "John", age: 30 };
    expect(updateValueAtPath(obj, ["age"], 31)).toEqual({
      name: "John",
      age: 31,
    });
  });

  test("updates a nested object property", () => {
    const obj = { user: { name: "John", address: { city: "New York" } } };
    expect(
      updateValueAtPath(obj, ["user", "address", "city"], "Boston"),
    ).toEqual({ user: { name: "John", address: { city: "Boston" } } });
  });

  test("creates missing object properties", () => {
    const obj = { user: { name: "John" } };
    expect(
      updateValueAtPath(obj, ["user", "address", "city"], "Boston"),
    ).toEqual({ user: { name: "John", address: { city: "Boston" } } });
  });

  // Array update tests
  test("updates an array item", () => {
    const arr = [1, 2, 3, 4];
    expect(updateValueAtPath(arr, ["2"], 5)).toEqual([1, 2, 5, 4]);
  });

  test("extends an array when index is out of bounds", () => {
    const arr = [1, 2, 3];
    const result = updateValueAtPath(arr, ["5"], "new") as JsonValue[];

    // Check overall array structure
    expect(result).toEqual([1, 2, 3, null, null, "new"]);

    // Explicitly verify that indices 3 and 4 contain null, not undefined
    expect(result[3]).toBe(null);
    expect(result[4]).toBe(null);

    // Verify these aren't "holes" in the array (important distinction)
    expect(3 in result).toBe(true);
    expect(4 in result).toBe(true);

    // Verify the array has the correct length
    expect(result.length).toBe(6);

    // Verify the array doesn't have holes by checking every index exists
    expect(result.every((_, index: number) => index in result)).toBe(true);
  });

  test("updates a nested array item", () => {
    const obj = { users: [{ name: "John" }, { name: "Jane" }] };
    expect(updateValueAtPath(obj, ["users", "1", "name"], "Janet")).toEqual({
      users: [{ name: "John" }, { name: "Janet" }],
    });
  });

  // Error handling tests
  test("returns original value when trying to update a primitive with a path", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const result = updateValueAtPath("string", ["foo"], "bar");
    expect(result).toBe("string");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns original array when index is invalid", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const arr = [1, 2, 3];
    expect(updateValueAtPath(arr, ["invalid"], 4)).toEqual(arr);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns original array when index is negative", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const arr = [1, 2, 3];
    expect(updateValueAtPath(arr, ["-1"], 4)).toEqual(arr);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("handles sparse arrays correctly by filling holes with null", () => {
    // Create a sparse array by deleting an element
    const sparseArr = [1, 2, 3];
    delete sparseArr[1]; // Now sparseArr is [1, <1 empty item>, 3]

    // Update a value beyond the array length
    const result = updateValueAtPath(sparseArr, ["5"], "new") as JsonValue[];

    // Check overall array structure
    expect(result).toEqual([1, null, 3, null, null, "new"]);

    // Explicitly verify that index 1 (the hole) contains null, not undefined
    expect(result[1]).toBe(null);

    // Verify this isn't a hole in the array
    expect(1 in result).toBe(true);

    // Verify all indices contain null (not undefined)
    expect(result[1]).not.toBe(undefined);
    expect(result[3]).toBe(null);
    expect(result[4]).toBe(null);
  });
});

describe("getValueAtPath", () => {
  test("returns the original value when path is empty", () => {
    const obj = { foo: "bar" };
    expect(getValueAtPath(obj, [])).toBe(obj);
  });

  test("returns the value at a simple path", () => {
    const obj = { name: "John", age: 30 };
    expect(getValueAtPath(obj, ["name"])).toBe("John");
  });

  test("returns the value at a nested path", () => {
    const obj = { user: { name: "John", address: { city: "New York" } } };
    expect(getValueAtPath(obj, ["user", "address", "city"])).toBe("New York");
  });

  test("returns default value when path does not exist", () => {
    const obj = { user: { name: "John" } };
    expect(getValueAtPath(obj, ["user", "address", "city"], "Unknown")).toBe(
      "Unknown",
    );
  });

  test("returns default value when input is null/undefined", () => {
    expect(getValueAtPath(null, ["foo"], "default")).toBe("default");
    expect(getValueAtPath(undefined, ["foo"], "default")).toBe("default");
  });

  test("handles array indices correctly", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["1"])).toBe("b");
  });

  test("returns default value for out of bounds array indices", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["5"], "default")).toBe("default");
  });

  test("returns default value for invalid array indices", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["invalid"], "default")).toBe("default");
  });

  test("navigates through mixed object and array paths", () => {
    const obj = { users: [{ name: "John" }, { name: "Jane" }] };
    expect(getValueAtPath(obj, ["users", "1", "name"])).toBe("Jane");
  });
});

describe("JsonSchemaType elicitation field support", () => {
  const sampleSchema: JsonSchemaType = {
    type: "object",
    title: "User Info",
    description: "User information form",
    properties: {
      name: {
        type: "string",
        title: "Full Name",
        description: "Your full name",
        minLength: 2,
        maxLength: 50,
        pattern: "^[A-Za-z\\s]+$",
      },
      email: {
        type: "string",
        format: "email",
        title: "Email Address",
      },
      age: {
        type: "integer",
        minimum: 18,
        maximum: 120,
        default: 25,
      },
      role: {
        type: "string",
        oneOf: [
          { const: "admin", title: "Administrator" },
          { const: "user", title: "User" },
          { const: "guest", title: "Guest" },
        ],
      },
    },
    required: ["name", "email"],
  };

  test("should parse JsonSchemaType with elicitation fields", () => {
    const schemaString = JSON.stringify(sampleSchema);
    const result = tryParseJson(schemaString);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(sampleSchema);
  });

  test("should update schema properties with new validation fields", () => {
    const updated = updateValueAtPath(
      sampleSchema,
      ["properties", "name", "minLength"],
      5,
    );

    expect(getValueAtPath(updated, ["properties", "name", "minLength"])).toBe(
      5,
    );
  });

  test("should handle oneOf with const and title fields", () => {
    const schema = {
      type: "string",
      oneOf: [
        { const: "option1", title: "Option 1" },
        { const: "option2", title: "Option 2" },
      ],
    };

    expect(getValueAtPath(schema, ["oneOf", "0", "const"])).toBe("option1");
    expect(getValueAtPath(schema, ["oneOf", "1", "title"])).toBe("Option 2");
  });

  test("should handle validation constraints", () => {
    const numberSchema = {
      type: "number" as const,
      minimum: 0,
      maximum: 100,
      default: 50,
    };

    expect(getValueAtPath(numberSchema, ["minimum"])).toBe(0);
    expect(getValueAtPath(numberSchema, ["maximum"])).toBe(100);
    expect(getValueAtPath(numberSchema, ["default"])).toBe(50);
  });

  test("should handle string format and pattern fields", () => {
    const stringSchema = {
      type: "string" as const,
      format: "email",
      pattern: "^[a-z]+@[a-z]+\\.[a-z]+$",
      minLength: 5,
      maxLength: 100,
    };

    expect(getValueAtPath(stringSchema, ["format"])).toBe("email");
    expect(getValueAtPath(stringSchema, ["pattern"])).toBe(
      "^[a-z]+@[a-z]+\\.[a-z]+$",
    );
    expect(getValueAtPath(stringSchema, ["minLength"])).toBe(5);
  });

  test("should handle title and description fields", () => {
    const schema = {
      type: "boolean" as const,
      title: "Accept Terms",
      description: "Do you accept the terms and conditions?",
      default: false,
    };

    expect(getValueAtPath(schema, ["title"])).toBe("Accept Terms");
    expect(getValueAtPath(schema, ["description"])).toBe(
      "Do you accept the terms and conditions?",
    );
  });

  test("should handle JSON Schema spec compliant oneOf with const for labeled enums", () => {
    // Example from JSON Schema spec: labeled enums using oneOf with const
    const trafficLightSchema = {
      type: "string" as const,
      title: "Traffic Light",
      description: "Select a traffic light color",
      oneOf: [
        { const: "red", title: "Stop" },
        { const: "amber", title: "Caution" },
        { const: "green", title: "Go" },
      ],
    };

    // Verify the schema structure
    expect(trafficLightSchema.type).toBe("string");
    expect(trafficLightSchema.oneOf).toHaveLength(3);

    // Verify each oneOf option has const and title
    expect(trafficLightSchema.oneOf[0].const).toBe("red");
    expect(trafficLightSchema.oneOf[0].title).toBe("Stop");

    expect(trafficLightSchema.oneOf[1].const).toBe("amber");
    expect(trafficLightSchema.oneOf[1].title).toBe("Caution");

    expect(trafficLightSchema.oneOf[2].const).toBe("green");
    expect(trafficLightSchema.oneOf[2].title).toBe("Go");

    // Test with JsonValue operations
    const schemaAsJsonValue = trafficLightSchema as JsonValue;
    expect(getValueAtPath(schemaAsJsonValue, ["oneOf", "0", "const"])).toBe(
      "red",
    );
    expect(getValueAtPath(schemaAsJsonValue, ["oneOf", "1", "title"])).toBe(
      "Caution",
    );
    expect(getValueAtPath(schemaAsJsonValue, ["oneOf", "2", "const"])).toBe(
      "green",
    );
  });

  test("should handle complex oneOf scenarios with mixed schema types", () => {
    const complexSchema = {
      type: "object" as const,
      title: "User Preference",
      properties: {
        theme: {
          type: "string" as const,
          oneOf: [
            { const: "light", title: "Light Mode" },
            { const: "dark", title: "Dark Mode" },
            { const: "auto", title: "Auto (System)" },
          ],
        },
        notifications: {
          type: "string" as const,
          oneOf: [
            { const: "all", title: "All Notifications" },
            { const: "important", title: "Important Only" },
            { const: "none", title: "None" },
          ],
        },
      },
    };

    expect(
      getValueAtPath(complexSchema, [
        "properties",
        "theme",
        "oneOf",
        "0",
        "const",
      ]),
    ).toBe("light");
    expect(
      getValueAtPath(complexSchema, [
        "properties",
        "theme",
        "oneOf",
        "1",
        "title",
      ]),
    ).toBe("Dark Mode");
    expect(
      getValueAtPath(complexSchema, [
        "properties",
        "notifications",
        "oneOf",
        "2",
        "const",
      ]),
    ).toBe("none");
  });
});
