import { escapeUnicode } from "../escapeUnicode";

describe("escapeUnicode", () => {
  it("should escape Unicode characters in a string", () => {
    const input = { text: "你好世界" };
    const expected = '{\n  "text": "\\\\u4f60\\\\u597d\\\\u4e16\\\\u754c"\n}';
    expect(escapeUnicode(input)).toBe(expected);
  });

  it("should handle empty strings", () => {
    const input = { text: "" };
    const expected = '{\n  "text": ""\n}';
    expect(escapeUnicode(input)).toBe(expected);
  });

  it("should handle null and undefined values", () => {
    const input = { text: null, value: undefined };
    const expected = '{\n  "text": null\n}';
    expect(escapeUnicode(input)).toBe(expected);
  });

  it("should handle numbers and booleans", () => {
    const input = { number: 123, boolean: true };
    const expected = '{\n  "number": 123,\n  "boolean": true\n}';
    expect(escapeUnicode(input)).toBe(expected);
  });
});
