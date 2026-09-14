import { describe, it, expect } from "vitest";
import { isSerializableJson } from "@inspector/core/json/jsonUtils.js";

describe("isSerializableJson", () => {
  it.each([
    ["a string", "a"],
    ["a finite number", 1.5],
    ["zero", 0],
    ["a negative number", -42],
    ["a boolean", true],
    ["null", null],
    ["a nested object", { a: { b: [1, 2, { c: "d" }] } }],
    ["an empty array", []],
  ])("accepts %s", (_label, value) => {
    expect(isSerializableJson(value)).toBe(true);
  });

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("rejects %s, which JSON.stringify rewrites to null", (_label, value) => {
    expect(isSerializableJson(value)).toBe(false);
    // The reason it matters, asserted rather than asserted-about.
    expect(JSON.stringify({ v: value })).toBe('{"v":null}');
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => {}],
    ["a symbol", Symbol("s")],
    ["a bigint", 10n],
  ])("rejects %s, which is not JSON at all", (_label, value) => {
    expect(isSerializableJson(value)).toBe(false);
  });

  it("descends into arrays and objects", () => {
    expect(isSerializableJson({ a: [1, { b: Infinity }] })).toBe(false);
    expect(isSerializableJson([[[NaN]]])).toBe(false);
    expect(isSerializableJson({ a: [1, { b: 2 }] })).toBe(true);
  });

  it("rejects what `JSON.parse` produces for an overflowing literal", () => {
    // The reachable path: valid JSON text that parses to an unsendable value.
    expect(isSerializableJson(JSON.parse('{"n":1e400}'))).toBe(false);
  });
});
