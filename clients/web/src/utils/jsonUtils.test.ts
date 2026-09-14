import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDataType,
  tryParseJson,
  updateValueAtPath,
  getValueAtPath,
  collectSchemaDefaults,
  hasMissingRequiredFields,
  applySchemaConstants,
  seedSchemaValues,
} from "./jsonUtils";
import type { InspectorFormSchema } from "./jsonUtils";

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

describe("collectSchemaDefaults", () => {
  it("collects defaults across field types and omits fields without one", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        firstLine: {
          type: "string",
          default: "It was a dark and stormy night.",
        },
        integer: { type: "integer", default: 42 },
        number: { type: "number", default: 3.14 },
        choice: { type: "string", enum: ["a", "b"], default: "a" },
        picks: { type: "array", items: { enum: ["x", "y"] }, default: ["x"] },
        // No default — must be absent from the result, not undefined.
        name: { type: "string", title: "Name" },
      },
    };
    expect(collectSchemaDefaults(schema)).toEqual({
      firstLine: "It was a dark and stormy night.",
      integer: 42,
      number: 3.14,
      choice: "a",
      picks: ["x"],
    });
  });

  it("recurses into nested object schemas and skips empty ones", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        db: {
          type: "object",
          properties: {
            host: { type: "string", default: "localhost" },
            port: { type: "integer" },
          },
        },
        empty: {
          type: "object",
          properties: { note: { type: "string" } },
        },
      },
    };
    expect(collectSchemaDefaults(schema)).toEqual({
      db: { host: "localhost" },
    });
  });

  it("returns an empty object when the schema has no properties", () => {
    expect(collectSchemaDefaults({ type: "object" })).toEqual({});
  });

  // The form normalizes a nullable union before rendering, so this has to as
  // well: a nested object's `properties` live on the union's surviving branch,
  // and a default only visible there would be displayed but never submitted.
  it("collects defaults hoisted out of a nullable object union", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        profile: {
          anyOf: [
            {
              type: "object",
              properties: { nick: { type: "string", default: "ada" } },
            },
            { type: "null" },
          ],
        },
      },
    };
    expect(collectSchemaDefaults(schema)).toEqual({
      profile: { nick: "ada" },
    });
  });

  it("keeps a default declared on the union wrapper itself", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        direction: {
          default: "envio",
          anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
        },
      },
    };
    expect(collectSchemaDefaults(schema)).toEqual({ direction: "envio" });
  });
});

describe("hasMissingRequiredFields", () => {
  const schema: InspectorFormSchema = {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "integer" } },
    required: ["name"],
  };

  it("is false when no fields are required", () => {
    expect(hasMissingRequiredFields({ type: "object" }, {})).toBe(false);
  });

  it("is true when a required field is absent, null, or empty", () => {
    expect(hasMissingRequiredFields(schema, {})).toBe(true);
    expect(hasMissingRequiredFields(schema, { name: null })).toBe(true);
    expect(hasMissingRequiredFields(schema, { name: "" })).toBe(true);
  });

  it("is false when every required field has a value", () => {
    expect(hasMissingRequiredFields(schema, { name: "Ada" })).toBe(false);
    // A non-required field being empty does not matter.
    expect(hasMissingRequiredFields(schema, { name: "Ada", age: "" })).toBe(
      false,
    );
  });

  // JSON Schema `required` constrains presence, not content — so an explicit
  // `null` satisfies a required field whose schema admits null. Since #1928 the
  // user can produce exactly that by clearing a nullable enum, and treating it
  // as missing would disable submit on a value the schema calls valid.
  it("accepts an explicit null for a required field that admits null", () => {
    const nullable: InspectorFormSchema = {
      type: "object",
      properties: {
        direction: {
          anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
        },
      },
      required: ["direction"],
    };
    expect(hasMissingRequiredFields(nullable, { direction: null })).toBe(false);
    expect(hasMissingRequiredFields(nullable, {})).toBe(true);
  });

  it("accepts an explicit null for a required type: [T, null] field", () => {
    const nullable: InspectorFormSchema = {
      type: "object",
      properties: { note: { type: ["string", "null"] } },
      required: ["note"],
    };
    expect(hasMissingRequiredFields(nullable, { note: null })).toBe(false);
  });

  it("still rejects null for a required field whose schema is not nullable", () => {
    expect(hasMissingRequiredFields(schema, { name: null })).toBe(true);
  });

  // The renderer's collapse only handles a two-member union, but null admission
  // has no such limit — this one renders through the JSON fallback, where the
  // user can still type `null`, and the schema plainly accepts it.
  it("accepts an explicit null for a required three-member union", () => {
    const wide: InspectorFormSchema = {
      type: "object",
      properties: {
        mixed: {
          anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
        },
      },
      required: ["mixed"],
    };
    expect(hasMissingRequiredFields(wide, { mixed: null })).toBe(false);
  });

  it("rejects null for a required field the schema does not describe", () => {
    const undescribed: InspectorFormSchema = {
      type: "object",
      properties: {},
      required: ["ghost"],
    };
    expect(hasMissingRequiredFields(undescribed, { ghost: null })).toBe(true);
  });
});

describe("root composition (#2123)", () => {
  const UNION: InspectorFormSchema = {
    type: "object",
    properties: { note: { type: "string" } },
    anyOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "email" },
          address: { type: "string" },
        },
        required: ["kind", "address"],
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "sms" },
          phone: { type: "string" },
        },
        required: ["kind", "phone"],
      },
    ],
  };

  it("seeds the first branch's defaults, including its const", () => {
    expect(collectSchemaDefaults(UNION)).toEqual({ kind: "email" });
  });

  it("does not seed fields of branches the form is not showing", () => {
    expect(collectSchemaDefaults(UNION)).not.toHaveProperty("phone");
  });

  it("seeds a required const property on an ordinary schema too", () => {
    expect(
      collectSchemaDefaults({
        type: "object",
        properties: { version: { type: "string", const: "1" } },
        required: ["version"],
      }),
    ).toEqual({ version: "1" });
  });

  it("leaves an optional const out", () => {
    // `const` constrains a present value; it does not require the property or
    // act as a default, so seeding it would turn a valid `{}` call into one
    // that asks the server to do something.
    const optional: InspectorFormSchema = {
      type: "object",
      properties: { dryRun: { type: "boolean", const: true } },
    };
    expect(collectSchemaDefaults(optional)).toEqual({});
    expect(applySchemaConstants(optional, {})).toEqual({});
    // …but a value that IS present must be the one the schema fixes.
    expect(applySchemaConstants(optional, { dryRun: false })).toEqual({
      dryRun: true,
    });
  });

  it("prefers a const over a conflicting default", () => {
    // `default` is an annotation, not a constraint, so a schema may advertise
    // one its own `const` rejects — seeding it would submit an invalid value
    // through a read-only field.
    expect(
      collectSchemaDefaults({
        type: "object",
        properties: {
          v: { type: "string", const: "a", default: "b" },
        },
        required: ["v"],
      }),
    ).toEqual({ v: "a" });
  });

  it("collects defaults from a root allOf", () => {
    expect(
      collectSchemaDefaults({
        type: "object",
        allOf: [
          {
            type: "object",
            properties: { merged: { type: "string", default: "m" } },
          },
        ],
      }),
    ).toEqual({ merged: "m" });
  });

  it("seeds the branch the known values identify, not the first", () => {
    // What the App deep link does: seed defaults, then overlay its `appArgs`.
    // Seeding branch 0 underneath branch 1's args would leave `address` in the
    // submitted arguments, invisible to a form showing the SMS branch.
    expect(collectSchemaDefaults(UNION, { kind: "sms" })).toEqual({
      kind: "sms",
    });
  });

  it("accepts a required field pinned to null", () => {
    // `const: null` admits null and nothing else, so seeding it must not leave
    // submit disabled on a value the user cannot change.
    const schema: InspectorFormSchema = {
      type: "object",
      properties: { nothing: { const: null } },
      required: ["nothing"],
    };
    const values = collectSchemaDefaults(schema);
    expect(values).toEqual({ nothing: null });
    expect(hasMissingRequiredFields(schema, values)).toBe(false);
  });

  it("re-applies a branch's constants over conflicting supplied values", () => {
    // A read-only field cannot be corrected by the user, so a deep link
    // disagreeing with a `const` must not survive into the submitted arguments.
    expect(applySchemaConstants(UNION, { kind: "sms", note: "hi" })).toEqual({
      kind: "sms",
      note: "hi",
    });
    expect(applySchemaConstants(UNION, { kind: "nonsense" })).toEqual({
      kind: "email",
    });
  });

  it("seeds a field named __proto__", () => {
    // A plain assignment would invoke the legacy prototype setter, leaving a
    // required pinned field displayed read-only and seeded with nothing.
    const seeded = collectSchemaDefaults({
      type: "object",
      properties: Object.fromEntries([
        ["__proto__", { type: "string", const: "kept" }],
      ]),
      required: ["__proto__"],
    });
    expect(Object.hasOwn(seeded, "__proto__")).toBe(true);
  });

  it("seeds defaults from a nested object's own union branch", () => {
    // The nested form renders that branch, so its read-only discriminator has
    // to reach the submitted values too.
    expect(
      collectSchemaDefaults({
        type: "object",
        properties: {
          config: {
            type: "object",
            anyOf: [
              {
                type: "object",
                properties: {
                  kind: { type: "string", const: "email" },
                  address: { type: "string" },
                },
                required: ["kind"],
              },
              {
                type: "object",
                properties: {
                  kind: { type: "string", const: "sms" },
                  phone: { type: "string" },
                },
                required: ["kind"],
              },
            ],
          },
        },
      }),
    ).toEqual({ config: { kind: "email" } });
  });

  describe("seedSchemaValues", () => {
    const NESTED: InspectorFormSchema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "email" },
                retries: { type: "number", default: 1 },
              },
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "sms" },
                retries: { type: "number", default: 3 },
              },
            },
          ],
        },
      },
    };

    it("keeps a nested branch's defaults beside the supplied values", () => {
      // A shallow spread would replace the whole `config` object, so the SMS
      // branch's `retries` would be displayed by the form and never submitted.
      expect(seedSchemaValues(NESTED, { config: { kind: "sms" } })).toEqual({
        config: { kind: "sms", retries: 3 },
      });
    });

    it("lets the supplied value win where the two meet", () => {
      expect(
        seedSchemaValues(NESTED, { config: { kind: "sms", retries: 9 } }),
      ).toEqual({ config: { kind: "sms", retries: 9 } });
    });

    it("does not treat an array as a nested object", () => {
      const withArray: InspectorFormSchema = {
        type: "object",
        properties: { items: { type: "array" } },
      };
      expect(seedSchemaValues(withArray, { items: [1, 2] })).toEqual({
        items: [1, 2],
      });
    });

    it("keeps a supplied argument named __proto__", () => {
      const seeded = seedSchemaValues(
        { type: "object", properties: {} },
        Object.fromEntries([["__proto__", "kept"]]),
      );
      expect(Object.hasOwn(seeded, "__proto__")).toBe(true);
    });
  });

  it("re-applies a nested object's constants", () => {
    // The overlay replaces the whole nested object rather than merging into it,
    // so a link naming `{ config: { kind: "sms" } }` would otherwise slip past
    // the pinned `kind` the nested form displays.
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            kind: { type: "string", const: "email" },
            to: { type: "string" },
          },
        },
      },
    };
    expect(
      applySchemaConstants(schema, { config: { kind: "sms", to: "a@b.c" } }),
    ).toEqual({ config: { kind: "email", to: "a@b.c" } });
  });

  it("leaves values alone when nothing is pinned", () => {
    const values = { a: 1 };
    expect(
      applySchemaConstants(
        { type: "object", properties: { a: { type: "number" } } },
        values,
      ),
    ).toBe(values);
  });

  it("accepts an empty string a const pins the field to", () => {
    // Rendered read-only, so treating the seeded value as missing would
    // disable submit on a value the user cannot change.
    const pinnedEmpty: InspectorFormSchema = {
      type: "object",
      properties: { kind: { type: "string", const: "" } },
      required: ["kind"],
    };
    expect(hasMissingRequiredFields(pinnedEmpty, { kind: "" })).toBe(false);
    // An ordinary required string is still missing when left blank.
    expect(
      hasMissingRequiredFields(
        {
          type: "object",
          properties: { kind: { type: "string" } },
          required: ["kind"],
        },
        { kind: "" },
      ),
    ).toBe(true);
  });

  it("does not read an inherited property as a supplied answer", () => {
    // `constructor` is a legal argument name; reading it off the prototype
    // would enable a submit the schema rejects.
    const schema: InspectorFormSchema = {
      type: "object",
      // Built through `fromEntries`: in an object literal, `constructor` is
      // TypeScript's own inherited member rather than a plain key.
      properties: Object.fromEntries([["constructor", { type: "string" }]]),
      required: ["constructor"],
    };
    expect(hasMissingRequiredFields(schema, {})).toBe(true);
    expect(hasMissingRequiredFields(schema, { constructor: "x" })).toBe(false);
  });

  it("blocks submission while no branch is satisfied", () => {
    expect(hasMissingRequiredFields(UNION, {})).toBe(true);
    expect(hasMissingRequiredFields(UNION, { kind: "email" })).toBe(true);
  });

  it("does not count a branch whose discriminator the values contradict", () => {
    // `{ kind: "sms", address: … }` supplies everything the EMAIL branch
    // requires while carrying a `kind` that branch rejects — and the SMS
    // branch it does name is still missing `phone`.
    expect(
      hasMissingRequiredFields(UNION, { kind: "sms", address: "a@b.c" }),
    ).toBe(true);
  });

  it("allows submission once one branch is satisfied", () => {
    expect(hasMissingRequiredFields(UNION, { kind: "sms", phone: "555" })).toBe(
      false,
    );
  });

  it("gates on required fields declared only in a root allOf", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      allOf: [
        {
          type: "object",
          properties: { a: { type: "string" } },
          required: ["a"],
        },
      ],
    };
    expect(hasMissingRequiredFields(schema, {})).toBe(true);
    expect(hasMissingRequiredFields(schema, { a: "x" })).toBe(false);
  });
});
