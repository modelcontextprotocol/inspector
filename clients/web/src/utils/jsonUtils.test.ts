import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDataType,
  tryParseJson,
  updateValueAtPath,
  getValueAtPath,
} from "./jsonUtils";

describe("getDataType", () => {
  it("returns 'array' for arrays", () => {
    expect(getDataType([])).toBe("array");
    expect(getDataType([1, 2, 3])).toBe("array");
  });

  it("returns 'null' for null", () => {
    expect(getDataType(null)).toBe("null");
  });

  it("returns the typeof for primitives and objects", () => {
    expect(getDataType("foo")).toBe("string");
    expect(getDataType(42)).toBe("number");
    expect(getDataType(true)).toBe("boolean");
    expect(getDataType(undefined)).toBe("undefined");
    expect(getDataType({ a: 1 })).toBe("object");
  });
});

describe("tryParseJson", () => {
  it("parses valid JSON objects", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ success: true, data: { a: 1 } });
  });

  it("parses valid JSON arrays", () => {
    expect(tryParseJson("[1,2,3]")).toEqual({
      success: true,
      data: [1, 2, 3],
    });
  });

  it("returns the original string for non-object/array input", () => {
    expect(tryParseJson("hello")).toEqual({ success: false, data: "hello" });
    expect(tryParseJson("42")).toEqual({ success: false, data: "42" });
  });

  it("returns the original string for malformed JSON", () => {
    expect(tryParseJson("{ not: json }")).toEqual({
      success: false,
      data: "{ not: json }",
    });
  });

  it("handles empty / whitespace input", () => {
    expect(tryParseJson("")).toEqual({ success: false, data: "" });
    expect(tryParseJson("   ")).toEqual({ success: false, data: "   " });
  });
});

describe("updateValueAtPath", () => {
  it("returns the value when path is empty", () => {
    expect(updateValueAtPath({ a: 1 }, [], "replaced")).toBe("replaced");
  });

  it("updates a nested object property", () => {
    const original = { a: { b: 1 } };
    const result = updateValueAtPath(original, ["a", "b"], 2);
    expect(result).toEqual({ a: { b: 2 } });
    expect(original).toEqual({ a: { b: 1 } });
  });

  it("creates missing nested keys", () => {
    expect(updateValueAtPath({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
  });

  it("updates an array element", () => {
    expect(updateValueAtPath([1, 2, 3], ["1"], 9)).toEqual([1, 9, 3]);
  });

  it("extends arrays with null padding when index is out of bounds", () => {
    expect(updateValueAtPath([1], ["3"], 9)).toEqual([1, null, null, 9]);
  });

  it("creates an array when path[0] is numeric and obj is null/undefined", () => {
    expect(updateValueAtPath(null, ["0", "name"], "x")).toEqual([
      { name: "x" },
    ]);
  });

  it("creates an object when path[0] is non-numeric and obj is null/undefined", () => {
    expect(updateValueAtPath(undefined, ["a"], 1)).toEqual({ a: 1 });
  });

  it("returns the original array on invalid (NaN) array index", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = [1, 2, 3];
    expect(updateValueAtPath(original, ["x"], 9)).toBe(original);
    consoleSpy.mockRestore();
  });

  it("returns the original array on negative index", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = [1, 2, 3];
    expect(updateValueAtPath(original, ["-1"], 9)).toBe(original);
    consoleSpy.mockRestore();
  });

  it("returns the original on non-object/array primitive at path", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(updateValueAtPath(42 as never, ["a"], 1)).toBe(42);
    consoleSpy.mockRestore();
  });

  it("handles deeply nested array+object paths", () => {
    expect(updateValueAtPath({ a: [{ b: 1 }] }, ["a", "0", "b"], 9)).toEqual({
      a: [{ b: 9 }],
    });
  });
});

describe("getValueAtPath", () => {
  it("returns the value at an object path", () => {
    expect(getValueAtPath({ a: { b: 2 } }, ["a", "b"])).toBe(2);
  });

  it("returns the value at an array index", () => {
    expect(getValueAtPath([10, 20, 30], ["1"])).toBe(20);
  });

  it("returns defaultValue when key is missing", () => {
    expect(getValueAtPath({ a: 1 }, ["b"], "fallback")).toBe("fallback");
  });

  it("returns defaultValue for null/undefined obj", () => {
    expect(getValueAtPath(null, ["a"], "fb")).toBe("fb");
    expect(getValueAtPath(undefined, ["a"], "fb")).toBe("fb");
  });

  it("returns defaultValue for out-of-bounds array index", () => {
    expect(getValueAtPath([1, 2], ["5"], "fb")).toBe("fb");
    expect(getValueAtPath([1, 2], ["x"], "fb")).toBe("fb");
    expect(getValueAtPath([1, 2], ["-1"], "fb")).toBe("fb");
  });

  it("returns the obj itself when path is empty", () => {
    expect(getValueAtPath({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it("returns defaultValue (null) when not specified and path doesn't exist", () => {
    expect(getValueAtPath({}, ["x"])).toBe(null);
  });

  it("returns defaultValue for primitive at path", () => {
    expect(getValueAtPath({ a: 5 }, ["a", "b"], "fb")).toBe("fb");
  });
});

describe("updateValueAtPath edge case suppression", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs when array index is invalid", () => {
    updateValueAtPath([1], ["x"], 9);
    expect(console.error).toHaveBeenCalled();
  });
});
