import { describe, it, expect } from "vitest";
import {
  convertParameterValue,
  convertToolParameters,
  convertPromptArguments,
  coercedArgumentNames,
  coercedArgumentsError,
  toRecord,
} from "@inspector/core/json/jsonUtils.js";
import type { Tool } from "@modelcontextprotocol/client";

describe("JSON Utils", () => {
  describe("toRecord", () => {
    it("returns the same object widened to a string-keyed record", () => {
      const source = { a: 1, b: "two" };
      const widened = toRecord(source);
      expect(widened).toBe(source);
      expect(widened.a).toBe(1);
      expect(Object.keys(widened)).toEqual(["a", "b"]);
    });
  });

  describe("convertParameterValue", () => {
    it("should convert string to string", () => {
      expect(convertParameterValue("hello", { type: "string" })).toBe("hello");
    });

    it("returns the raw value unchanged when it is empty", () => {
      // Empty string short-circuits before any type coercion.
      expect(convertParameterValue("", { type: "number" })).toBe("");
    });

    it("falls back to the raw string when JSON parsing fails", () => {
      expect(convertParameterValue("{not json", { type: "object" })).toBe(
        "{not json",
      );
      expect(convertParameterValue("[oops", { type: "array" })).toBe("[oops");
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

  // #2171: the predicate both raw-JSON editors refuse on. It must agree with
  // the conversion exactly — a false negative sends a payload other than the
  // one shown, and a false positive blocks a draft that was fine.
  describe("coercedArgumentNames", () => {
    const numeric: Tool = {
      name: "add",
      inputSchema: {
        type: "object",
        properties: { count: { type: "number" }, label: { type: "string" } },
      },
    };

    it("names a string the schema would retype", () => {
      expect(
        coercedArgumentNames(numeric.inputSchema, { count: "01" }),
      ).toEqual(["count"]);
    });

    // The conversion only inspects strings, so a value already written with
    // its declared type is untouched and must not be reported.
    it("ignores a value already of the declared type", () => {
      expect(coercedArgumentNames(numeric.inputSchema, { count: 1 })).toEqual(
        [],
      );
    });

    it("ignores a string the schema declares as a string", () => {
      expect(
        coercedArgumentNames(numeric.inputSchema, { label: "01" }),
      ).toEqual([]);
    });

    // An argument the schema does not declare is passed through by the
    // conversion, so there is nothing to warn about.
    it("ignores an undeclared argument", () => {
      expect(coercedArgumentNames(numeric.inputSchema, { extra: "x" })).toEqual(
        [],
      );
    });

    it("reports every offending name, in supplied order", () => {
      const two: Tool = {
        name: "pair",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "boolean" } },
        },
      };
      expect(
        coercedArgumentNames(two.inputSchema, { a: "1", b: "true" }),
      ).toEqual(["a", "b"]);
    });

    // Root composition (#2123): the declared type can live on a branch, and
    // the conversion selects that branch from the supplied values — so this
    // must too, or a branch's arguments would look unconvertible.
    it("resolves a type declared on a root union branch", () => {
      const union: Tool = {
        name: "u",
        inputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { const: "n" },
                value: { type: "number" },
              },
              required: ["kind"],
            },
            {
              type: "object",
              properties: {
                kind: { const: "s" },
                value: { type: "string" },
              },
              required: ["kind"],
            },
          ],
        },
      };
      expect(
        coercedArgumentNames(union.inputSchema, { kind: "n", value: "2" }),
      ).toEqual(["value"]);
      expect(
        coercedArgumentNames(union.inputSchema, { kind: "s", value: "2" }),
      ).toEqual([]);
    });

    it("says nothing when no argument is a string", () => {
      expect(coercedArgumentNames(numeric.inputSchema, { count: 1 })).toEqual(
        [],
      );
    });
  });

  describe("coercedArgumentsError", () => {
    // Both surfaces refuse the same drafts, so they must not word it two ways;
    // the tool name is included only where the caller knows it.
    it("names the tool when it is known", () => {
      expect(coercedArgumentsError(["count"], "add")).toBe(
        "`count` would be converted to the type add's schema declares — write the value with that type instead",
      );
    });

    it("omits the tool when the caller is already rendering one", () => {
      expect(coercedArgumentsError(["count"])).toBe(
        "`count` would be converted to the type the schema declares — write the value with that type instead",
      );
    });

    it("lists several names", () => {
      expect(coercedArgumentsError(["a", "b"], "pair")).toContain("`a`, `b`");
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

    it("coerces a value whose schema lives on a root union branch (#2123)", () => {
      const unionTool: Tool = {
        name: "union-tool",
        inputSchema: {
          type: "object",
          properties: { note: { type: "string" } },
          anyOf: [
            {
              type: "object",
              properties: { count: { type: "number" } },
            },
            {
              type: "object",
              properties: { enabled: { type: "boolean" } },
            },
          ],
        },
      };
      // Reading the root's `properties` alone finds no schema for either, so
      // both would have been sent as the strings the user typed.
      expect(
        convertToolParameters(unionTool, {
          note: "hi",
          count: "42",
          enabled: "true",
        }),
      ).toEqual({ note: "hi", count: 42, enabled: true });
    });

    it("prefers a branch's specialization of a root property (#2123)", () => {
      const specializing: Tool = {
        name: "specializing",
        inputSchema: {
          type: "object",
          // The root declares the name but constrains nothing; the branch is
          // what says it is a number.
          properties: { count: {} },
          anyOf: [
            { type: "object", properties: { count: { type: "number" } } },
            { type: "object", properties: { other: { type: "string" } } },
          ],
        },
      };
      expect(convertToolParameters(specializing, { count: "3" })).toEqual({
        count: 3,
      });
    });

    it("picks the branch its discriminator names (#2123)", () => {
      const discriminated: Tool = {
        name: "discriminated",
        inputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "a" },
                value: { type: "number" },
              },
              // Required, or the alternatives are not exclusive and the
              // resolver declines the `oneOf` outright.
              required: ["kind"],
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "b" },
                value: { type: "boolean" },
              },
              required: ["kind"],
            },
          ],
        },
      };
      // `value` is a number in one branch and a boolean in the other, so the
      // discriminator is the only thing that says how to coerce it.
      expect(
        convertToolParameters(discriminated, { kind: "b", value: "true" }),
      ).toEqual({ kind: "b", value: true });
      expect(
        convertToolParameters(discriminated, { kind: "a", value: "3" }),
      ).toEqual({ kind: "a", value: 3 });
    });

    it("identifies the branch from the argument names supplied (#2123)", () => {
      const undiscriminated: Tool = {
        name: "undiscriminated",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { a: { type: "string" }, value: { type: "number" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" }, value: { type: "boolean" } },
            },
          ],
        },
      };
      // `a` belongs to the first branch alone, so `value` is that branch's
      // number — falling straight through to cross-branch type agreement would
      // drop the coercion and send "3".
      expect(
        convertToolParameters(undiscriminated, { a: "x", value: "3" }),
      ).toEqual({ a: "x", value: 3 });
    });

    it("does not read an inherited property as a supplied constant (#2123)", () => {
      const pinnedOnInherited: Tool = {
        name: "pinned-on-inherited",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: Object.fromEntries([
                ["constructor", { const: "a" }],
                ["count", { type: "number" }],
              ]),
            },
            {
              type: "object",
              properties: Object.fromEntries([
                ["constructor", { const: "b" }],
                ["other", { type: "string" }],
              ]),
            },
          ],
        },
      };
      // `constructor` was not supplied, so it rules nothing out — `count`
      // belongs to the first branch alone and settles it.
      expect(convertToolParameters(pinnedOnInherited, { count: "3" })).toEqual({
        count: 3,
      });
    });

    it("sends a non-string discriminator as its typed constant (#2123)", () => {
      const numericallyPinned: Tool = {
        name: "numerically-pinned",
        inputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: 1 }, a: { type: "string" } },
              required: ["kind"],
            },
            {
              type: "object",
              properties: { kind: { const: 2 }, b: { type: "string" } },
              required: ["kind"],
            },
          ],
        },
      };
      // `kind=2` selects the second branch, which then rejects `"2"` — the
      // schema's own typed value is what goes on the wire.
      expect(convertToolParameters(numericallyPinned, { kind: "2" })).toEqual({
        kind: 2,
      });
      // Text that matches no constant is the user's input and is left alone.
      expect(convertToolParameters(numericallyPinned, { kind: "9" })).toEqual({
        kind: "9",
      });
    });

    it("keeps a converted argument named __proto__ (#2123)", () => {
      const protoNamed: Tool = {
        name: "proto-named",
        inputSchema: {
          type: "object",
          properties: Object.fromEntries([["__proto__", { type: "number" }]]),
        },
      };
      const converted = convertToolParameters(protoNamed, {
        ["__proto__"]: "3",
      });
      expect(Object.hasOwn(converted, "__proto__")).toBe(true);
    });

    it("reads an array type as a set when branches agree (#2123)", () => {
      const setTyped: Tool = {
        name: "set-typed",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { v: { type: ["number", "null"] }, a: {} },
            },
            {
              type: "object",
              properties: { v: { type: ["null", "number"] }, b: {} },
            },
          ],
        },
      };
      // The same declaration written in the other order — not a disagreement,
      // so the coercion survives.
      expect(convertToolParameters(setTyped, { v: "2" })).toEqual({ v: 2 });
    });

    it("sees through nullable encodings when branches disagree (#2123)", () => {
      const nullableDisagreement: Tool = {
        name: "nullable-disagreement",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: {
                value: { anyOf: [{ type: "number" }, { type: "null" }] },
                a: {},
              },
            },
            {
              type: "object",
              properties: {
                value: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                b: {},
              },
            },
          ],
        },
      };
      // Neither declaration states a top-level `type`, so uncollapsed they
      // would both read as "no type" and agree — and `value=true` would come
      // back as `NaN` through the first branch's number.
      expect(
        convertToolParameters(nullableDisagreement, { value: "true" }),
      ).toEqual({ value: "true" });
    });

    it("matches a structured const by parsing the supplied text (#2123)", () => {
      const structured: Tool = {
        name: "structured-const",
        inputSchema: {
          type: "object",
          properties: { tag: { const: { kind: "x", n: 1 } } },
        },
      };
      // `String({...})` is "[object Object]", which no argument can equal — so
      // the only value the schema accepts would never have matched.
      expect(
        convertToolParameters(structured, { tag: '{"n":1,"kind":"x"}' }),
      ).toEqual({ tag: { kind: "x", n: 1 } });
      // Text that is not that value, or not JSON at all, is left alone.
      expect(convertToolParameters(structured, { tag: "{}" })).toEqual({
        tag: "{}",
      });
      expect(convertToolParameters(structured, { tag: "nope" })).toEqual({
        tag: "nope",
      });
    });

    it("treats textually equal constants of different types as ambiguous (#2123)", () => {
      const indistinguishable: Tool = {
        name: "indistinguishable",
        inputSchema: {
          type: "object",
          anyOf: [
            { type: "object", properties: { kind: { const: 1 }, a: {} } },
            { type: "object", properties: { kind: { const: "1" }, b: {} } },
          ],
        },
      };
      // `kind=1` matches both, so neither typed constant may be assumed —
      // the raw string is the honest answer.
      expect(convertToolParameters(indistinguishable, { kind: "1" })).toEqual({
        kind: "1",
      });
    });

    it("leaves an ambiguously typed argument uncoerced (#2123)", () => {
      const ambiguous: Tool = {
        name: "ambiguous",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: {
                value: { type: "number" },
                a: { type: "string" },
              },
            },
            {
              type: "object",
              properties: {
                value: { type: "boolean" },
                b: { type: "string" },
              },
            },
          ],
        },
      };
      // Nothing identifies a branch, so coercing `value` by an arbitrary one
      // would turn `true` into `Number("true")` — `NaN`, i.e. `null` on the
      // wire. The raw string is honest; it is also what shipped before.
      expect(convertToolParameters(ambiguous, { value: "true" })).toEqual({
        value: "true",
      });
    });

    it("agrees on an array-form type across branches (#2123)", () => {
      const arrayTyped: Tool = {
        name: "array-typed",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { v: { type: ["number", "null"] }, a: {} },
            },
            {
              type: "object",
              properties: { v: { type: ["number", "null"] }, b: {} },
            },
          ],
        },
      };
      // Both spell the type the same way, so it is not ambiguous — and the
      // nullable declaration collapses to `number`, which is what coerces.
      expect(convertToolParameters(arrayTyped, { v: "2" })).toEqual({ v: 2 });
    });

    it("ignores a malformed branch declaration when matching constants (#2123)", () => {
      const malformed: Tool = {
        name: "malformed",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "a" },
                broken: null as unknown,
                value: { type: "number" },
              },
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "b" },
                value: { type: "boolean" },
              },
            },
          ],
        },
      };
      // A `properties: { broken: null }` entry must not throw. The union is
      // declined — a `null` is not a schema, and handing it on would crash a
      // renderer — so nothing is coerced and the strings pass through.
      expect(
        convertToolParameters(malformed, { kind: "a", value: "3" }),
      ).toEqual({ kind: "a", value: "3" });
    });

    it("falls back to the branch-agreement path when no constant is supplied (#2123)", () => {
      const discriminated: Tool = {
        name: "no-discriminator-supplied",
        inputSchema: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "a" },
                shared: { type: "number" },
              },
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "b" },
                shared: { type: "number" },
              },
            },
          ],
        },
      };
      // Both branches match vacuously, so no single branch is identified — but
      // they agree about `shared`, so it is still coerced.
      expect(convertToolParameters(discriminated, { shared: "4" })).toEqual({
        shared: 4,
      });
    });

    it("ignores a malformed branch declaration when agreeing on a type (#2123)", () => {
      const malformedDeclaration: Tool = {
        name: "malformed-declaration",
        inputSchema: {
          type: "object",
          anyOf: [
            { type: "object", properties: { count: null as unknown, a: {} } },
            {
              type: "object",
              properties: { count: { type: "number" }, b: {} },
            },
          ],
        },
      };
      // The `null` makes the whole union unofferable, so nothing is coerced —
      // and, the point of the test, nothing throws either.
      expect(
        convertToolParameters(malformedDeclaration, { count: "3" }),
      ).toEqual({ count: "3" });
    });

    it("coerces a value whose schema lives on a root allOf branch (#2123)", () => {
      const allOfTool: Tool = {
        name: "allof-tool",
        inputSchema: {
          type: "object",
          allOf: [
            { type: "object", properties: { count: { type: "number" } } },
          ],
        },
      };
      expect(convertToolParameters(allOfTool, { count: "7" })).toEqual({
        count: 7,
      });
    });

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
