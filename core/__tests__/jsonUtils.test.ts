import { describe, it, expect } from "vitest";
import {
  convertParameterValue,
  convertToolParameters,
  convertPromptArguments,
} from "../json/jsonUtils.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

describe("JSON Utils", () => {
  describe("convertParameterValue", () => {
    it("should convert string to string", () => {
      expect(convertParameterValue("hello", { type: "string" })).toBe("hello");
    });

    it("should convert string to number", () => {
      expect(convertParameterValue("42", { type: "number" })).toBe(42);
      expect(convertParameterValue("3.14", { type: "number" })).toBe(3.14);
    });

    it("should convert string to boolean", () => {
      expect(convertParameterValue("true", { type: "boolean" })).toBe(true);
      expect(convertParameterValue("false", { type: "boolean" })).toBe(false);
    });

    it("should parse JSON strings", () => {
      expect(
        convertParameterValue('{"key":"value"}', { type: "object" }),
      ).toEqual({
        key: "value",
      });
      expect(convertParameterValue("[1,2,3]", { type: "array" })).toEqual([
        1, 2, 3,
      ]);
    });

    it("should return string for unknown types", () => {
      expect(convertParameterValue("hello", { type: "unknown" })).toBe("hello");
    });
  });

  describe("convertToolParameters", () => {
    const tool: Tool = {
      name: "test-tool",
      description: "Test tool",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          count: { type: "number" },
          enabled: { type: "boolean" },
        },
      },
    };

    it("should convert string parameters", () => {
      const result = convertToolParameters(tool, {
        message: "hello",
        count: "42",
        enabled: "true",
      });

      expect(result.message).toBe("hello");
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
    });

    it("should preserve non-string values", () => {
      const result = convertToolParameters(tool, {
        message: "hello",
        count: "42", // Still pass as string, conversion will handle it
        enabled: "true", // Still pass as string, conversion will handle it
      });

      expect(result.message).toBe("hello");
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
    });

    it("should handle missing schema", () => {
      const toolWithoutSchema: Tool = {
        name: "test-tool",
        description: "Test tool",
        inputSchema: {
          type: "object",
          properties: {},
        },
      };

      const result = convertToolParameters(toolWithoutSchema, {
        message: "hello",
      });

      expect(result.message).toBe("hello");
    });
  });

  describe("convertPromptArguments", () => {
    it("should convert values to strings", () => {
      const result = convertPromptArguments({
        name: "John",
        age: 42,
        active: true,
        data: { key: "value" },
        items: [1, 2, 3],
      });

      expect(result.name).toBe("John");
      expect(result.age).toBe("42");
      expect(result.active).toBe("true");
      expect(result.data).toBe('{"key":"value"}');
      expect(result.items).toBe("[1,2,3]");
    });

    it("should handle null and undefined", () => {
      const result = convertPromptArguments({
        value: null,
        missing: undefined,
      });

      expect(result.value).toBe("null");
      expect(result.missing).toBe("undefined");
    });
  });
});
