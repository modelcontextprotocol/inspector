import getDataType from "../getDataType";

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
