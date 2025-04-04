import tryParseJson from "../tryParseJson";

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
