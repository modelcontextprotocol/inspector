import { describe, it, expect } from "vitest";
import {
  admitsNull,
  normalizeNullableUnion,
} from "@inspector/core/json/nullableUnion.js";

// The two JSON Schema encodings of "this type, or null". Both form builders —
// the web `SchemaForm` and the TUI's `schemaToForm` — dispatch on a single
// `type` string, so this collapse is what keeps a nullable field renderable
// (#1928 in the web client, #2015 in the TUI).
describe("normalizeNullableUnion", () => {
  it("normalizes anyOf string|null", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "string" }, { type: "null" }],
      }),
    ).toEqual({
      type: "string",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf boolean|null", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "boolean" }, { type: "null" }],
      }),
    ).toEqual({
      type: "boolean",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf number|null", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "number" }, { type: "null" }],
      }),
    ).toEqual({
      type: "number",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf integer|null", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "integer" }, { type: "null" }],
      }),
    ).toEqual({
      type: "integer",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf array|null", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "array" }, { type: "null" }],
      }),
    ).toEqual({
      type: "array",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes type array string|null", () => {
    expect(normalizeNullableUnion({ type: ["string", "null"] })).toEqual({
      type: "string",
      nullable: true,
    });
  });

  it("normalizes type array boolean|null", () => {
    expect(normalizeNullableUnion({ type: ["boolean", "null"] })).toEqual({
      type: "boolean",
      nullable: true,
    });
  });

  it("normalizes type array number|null", () => {
    expect(normalizeNullableUnion({ type: ["number", "null"] })).toEqual({
      type: "number",
      nullable: true,
    });
  });

  it("normalizes type array integer|null", () => {
    expect(normalizeNullableUnion({ type: ["integer", "null"] })).toEqual({
      type: "integer",
      nullable: true,
    });
  });

  it("returns schema unchanged when no union pattern matches", () => {
    const schema = { type: "string" as const };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("ignores anyOf with more than two members", () => {
    const schema = {
      anyOf: [
        { type: "string" as const },
        { type: "null" as const },
        { type: "number" as const },
      ],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("ignores a two-member anyOf with no null branch", () => {
    const schema = {
      anyOf: [{ type: "string" as const }, { type: "number" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("ignores an anyOf whose non-null branch has no renderable type (#1928)", () => {
    const schema = {
      anyOf: [{ const: "only" }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // #1928: the enum lives on the surviving branch, and hoisting it is what makes
  // the field render as a Select instead of the raw-JSON fallback.
  it("hoists enum out of an anyOf string-enum|null branch", () => {
    expect(
      normalizeNullableUnion({
        description: "Direction",
        anyOf: [
          { type: "string", enum: ["envio", "recebimento"] },
          { type: "null" },
        ],
      }),
    ).toEqual({
      type: "string",
      description: "Direction",
      enum: ["envio", "recebimento"],
      anyOf: undefined,
      nullable: true,
    });
  });

  // JSON Schema's `enum` is untyped, so a typeless branch only implies strings
  // when every member is one. Guessing otherwise would hand a number to a
  // renderer that declared the option list `string[]`.
  it("does not infer string for a typeless non-string enum branch", () => {
    const schema = { anyOf: [{ enum: [1, 2] }, { type: "null" as const }] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("does not infer string for a typeless mixed enum branch", () => {
    const schema = { anyOf: [{ enum: ["a", 2] }, { type: "null" as const }] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("does not infer string for a typeless empty enum branch", () => {
    const schema = { anyOf: [{ enum: [] }, { type: "null" as const }] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // An explicit `type` is authoritative — the enum members are the server's
  // problem at that point, not an inference this function is making.
  it("still collapses a non-string enum branch that declares its type", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "number", enum: [1, 2] }, { type: "null" }],
      }),
    ).toEqual({
      type: "number",
      enum: [1, 2],
      anyOf: undefined,
      nullable: true,
    });
  });

  it("infers string for a typeless enum branch", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ enum: ["a", "b"] }, { type: "null" }],
      }),
    ).toEqual({
      type: "string",
      enum: ["a", "b"],
      anyOf: undefined,
      nullable: true,
    });
  });

  it("hoists items out of an anyOf array|null branch", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [
          { type: "array", items: { type: "string", enum: ["a", "b"] } },
          { type: "null" },
        ],
      }),
    ).toEqual({
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      anyOf: undefined,
      nullable: true,
    });
  });

  it("hoists properties out of an anyOf object|null branch", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "null" },
        ],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf object|null regardless of branch order", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "null" }, { type: "object" }],
      }),
    ).toEqual({ type: "object", anyOf: undefined, nullable: true });
  });

  it("normalizes type array object|null", () => {
    expect(
      normalizeNullableUnion({
        type: ["object", "null"],
        properties: { a: { type: "string" } },
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      nullable: true,
    });
  });

  // The `type: [T, "null"]` encoding keeps its keywords at the top level, so a
  // nullable enum written that way carries the null *inside* the list. Leaving
  // it there hands `null` to Mantine as option data, and makes the TUI's
  // all-strings check reject the enum and fall back to a text field.
  it("strips the null sentinel from a type-array nullable enum", () => {
    expect(
      normalizeNullableUnion({
        type: ["string", "null"],
        enum: ["envio", "recebimento", null],
      }),
    ).toEqual({
      type: "string",
      enum: ["envio", "recebimento"],
      anyOf: undefined,
      nullable: true,
    });
  });

  it("strips a null sentinel hoisted off an anyOf branch too", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "string", enum: ["a", null] }, { type: "null" }],
      }),
    ).toEqual({
      type: "string",
      enum: ["a"],
      anyOf: undefined,
      nullable: true,
    });
  });

  // Declining is the point: emitting `enum: undefined` would turn a schema that
  // permits *only* `null` into a plain string field accepting arbitrary text,
  // inviting values the schema forbids. Left uncollapsed it renders through the
  // JSON editor, which represents it honestly.
  it("declines to collapse an enum that held nothing but null", () => {
    const schema = { type: ["string", "null"], enum: [null] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("declines the same way on the anyOf encoding", () => {
    const schema = {
      anyOf: [{ type: "string", enum: [null] }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // The parallel `enumNames` is filtered by the same indices. Both renderers
  // discard labels outright on a length mismatch, so stripping one without the
  // other would silently lose every label, not just the dropped one's.
  it("keeps enumNames aligned when stripping the null member", () => {
    expect(
      normalizeNullableUnion({
        type: ["string", "null"],
        enum: ["a", null, "b"],
        enumNames: ["Alpha", "None", "Beta"],
      }),
    ).toEqual({
      type: "string",
      enum: ["a", "b"],
      enumNames: ["Alpha", "Beta"],
      anyOf: undefined,
      nullable: true,
    });
  });

  // Flattening still happens — only the nullability claim is withheld, because
  // the sibling enum rules null out even though the type list names it.
  it("flattens but does not mark nullable when a sibling enum excludes null", () => {
    expect(
      normalizeNullableUnion({
        type: ["string", "null"],
        enum: ["envio", "recebimento"],
      }),
    ).toEqual({
      type: "string",
      enum: ["envio", "recebimento"],
      anyOf: undefined,
      nullable: false,
    });
  });

  it("still marks nullable when the enum lives on an anyOf branch", () => {
    expect(
      normalizeNullableUnion({
        anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
      }),
    ).toEqual({
      type: "string",
      enum: ["envio"],
      anyOf: undefined,
      nullable: true,
    });
  });

  // Keeping a mismatched list is not neutral: filtering shortens `enum`, so a
  // list both renderers had correctly *ignored* can come out the same length
  // and start labelling — `enum: [null, "b"]` + `enumNames: ["None"]` would
  // otherwise label `b` as "None". Dropping it preserves the ignore.
  it("drops a mismatched enumNames rather than letting filtering align it", () => {
    expect(
      normalizeNullableUnion({
        type: ["string", "null"],
        enum: [null, "b"],
        enumNames: ["None"],
      }),
    ).toEqual({
      type: "string",
      enum: ["b"],
      enumNames: undefined,
      anyOf: undefined,
      nullable: true,
    });
  });

  it("drops a mismatched enumNames that stays mismatched too", () => {
    expect(
      normalizeNullableUnion({
        type: ["string", "null"],
        enum: ["a", null],
        enumNames: ["Alpha"],
      }),
    ).toEqual({
      type: "string",
      enum: ["a"],
      enumNames: undefined,
      anyOf: undefined,
      nullable: true,
    });
  });

  // An empty enum permits nothing at all, so it reaches the same conclusion as
  // `[null]`: no value a dropdown could offer, so do not build one.
  it("declines to collapse an empty enum", () => {
    const typeArray = { type: ["string", "null"], enum: [] };
    expect(normalizeNullableUnion(typeArray)).toBe(typeArray);
    const union = {
      anyOf: [{ type: "string", enum: [] }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(union)).toBe(union);
  });

  // `$ref` applies alongside its siblings and is never resolved here, so a
  // branch carrying one can be unsatisfiable.
  it("treats $ref as opaque wherever it appears", () => {
    const onBranch = {
      anyOf: [
        { type: "string", $ref: "#/$defs/intOnly" },
        { type: "null" as const },
      ],
    };
    expect(normalizeNullableUnion(onBranch)).toBe(onBranch);
    const onTypeArray = { type: ["string", "null"], $ref: "#/$defs/intOnly" };
    expect(normalizeNullableUnion(onTypeArray)).toBe(onTypeArray);
    expect(admitsNull({ type: ["string", "null"], $ref: "#/$defs/x" })).toBe(
      false,
    );
    expect(admitsNull({ anyOf: [{ type: "null", $ref: "#/$defs/x" }] })).toBe(
      false,
    );
  });

  // The type-array path keeps the schema's own keywords, but `collapsed` clears
  // `anyOf` and the renderers ignore the other applicators — so a compound
  // schema would be widened into an unconstrained field rather than collapsed.
  it("declines a type-array nullable that also carries a sibling anyOf", () => {
    const schema = {
      type: ["string", "null"],
      anyOf: [{ const: "a" }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("declines a type-array nullable that carries an opaque applicator", () => {
    const withNot = { type: ["string", "null"], not: { const: "a" } };
    expect(normalizeNullableUnion(withNot)).toBe(withNot);
    const withOneOf = { type: ["string", "null"], oneOf: [{ const: "a" }] };
    expect(normalizeNullableUnion(withOneOf)).toBe(withOneOf);
    const withAllOf = { type: ["string", "null"], allOf: [{ minLength: 2 }] };
    expect(normalizeNullableUnion(withAllOf)).toBe(withAllOf);
  });

  it("normalizes type array array|null", () => {
    expect(normalizeNullableUnion({ type: ["array", "null"] })).toEqual({
      type: "array",
      nullable: true,
    });
  });

  it("keeps a type array of two non-null members unchanged", () => {
    const schema = { type: ["string", "number"] as const };
    expect(
      normalizeNullableUnion({ ...schema, type: [...schema.type] }),
    ).toEqual({
      type: ["string", "number"],
    });
  });

  // A server can put anything in `anyOf`; a non-object member must not be read
  // as a branch (nor throw), it simply means no nullable union was recognized.
  it("ignores an anyOf holding a non-object member", () => {
    const schema = { anyOf: ["string", { type: "null" as const }] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("ignores an anyOf holding an array member", () => {
    const schema = { anyOf: [["string"], { type: "null" as const }] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("ignores a type array whose non-null member has no widget", () => {
    const schema = { type: ["null", "null"] };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // The hoist is a spread, but JSON Schema applies sibling keywords
  // conjunctively — so a branch keyword replacing the wrapper's would *widen*
  // the field. `enum: ["a"]` around a branch `enum: ["a","b"]` means "a", yet
  // the spread would offer "b" in the dropdown and submit it.
  it("declines when the branch would drop a conflicting wrapper enum", () => {
    const schema = {
      enum: ["a"],
      anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("declines when wrapper and branch disagree on type", () => {
    const schema = {
      type: "string",
      anyOf: [{ type: "integer" }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("declines when wrapper and branch disagree on bounds", () => {
    const schema = {
      minimum: 5,
      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // Deliberately stricter than value-equality: a wrapper restating its branch's
  // `type` also declines. That costs a dropdown on a rare redundant shape and
  // buys a rule with no gap, which is the better trade for a module that cannot
  // evaluate JSON Schema.
  it("declines even when wrapper and branch agree on a shared keyword", () => {
    const schema = {
      type: "string",
      anyOf: [{ type: "string", enum: ["a"] }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  // The hoist *drops* a nested union: the branch's `anyOf` overwrites the
  // wrapper's in the spread and is then cleared, so the constraint vanishes and
  // the field widens into an unconstrained nullable string.
  it("declines when the surviving branch carries its own anyOf", () => {
    const schema = {
      anyOf: [
        { type: "string", anyOf: [{ const: "a" }] },
        { type: "null" as const },
      ],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("declines when the surviving branch carries an opaque applicator", () => {
    const withNot = {
      anyOf: [
        { type: "string", not: { const: "a" } },
        { type: "null" as const },
      ],
    };
    expect(normalizeNullableUnion(withNot)).toBe(withNot);
    const withAllOf = {
      anyOf: [
        { type: "string", allOf: [{ minLength: 2 }] },
        { type: "null" as const },
      ],
    };
    expect(normalizeNullableUnion(withAllOf)).toBe(withAllOf);
    const withOneOf = {
      anyOf: [
        { type: "string", oneOf: [{ const: "a" }] },
        { type: "null" as const },
      ],
    };
    expect(normalizeNullableUnion(withOneOf)).toBe(withOneOf);
  });

  it("declines when the wrapper carries an applicator the module cannot read", () => {
    const schema = {
      allOf: [{ minLength: 2 }],
      anyOf: [{ type: "string" }, { type: "null" as const }],
    };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });

  it("treats wrapper metadata as safe to keep alongside branch constraints", () => {
    expect(
      normalizeNullableUnion({
        title: "Direction",
        description: "Which way",
        default: "envio",
        anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
      }),
    ).toEqual({
      title: "Direction",
      description: "Which way",
      default: "envio",
      type: "string",
      enum: ["envio"],
      anyOf: undefined,
      nullable: true,
    });
  });

  it("ignores a schema with no union keywords at all", () => {
    const schema = { type: "object" as const, properties: {} };
    expect(normalizeNullableUnion(schema)).toBe(schema);
  });
});

// `admitsNull` answers a *validity* question and is deliberately decoupled from
// the collapse, which answers a narrower *rendering* one. A schema can admit
// null while being unrenderable as a single widget, and a form that conflated
// the two would reject a value its own schema accepts.
describe("admitsNull", () => {
  it("recognizes every encoding the collapse handles", () => {
    expect(admitsNull({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe(
      true,
    );
    expect(admitsNull({ type: ["string", "null"] })).toBe(true);
    expect(admitsNull({ type: "null" })).toBe(true);
    expect(admitsNull({ nullable: true })).toBe(true);
  });

  it("recognizes a null branch the collapse declines to flatten", () => {
    // Three members, so `normalizeNullableUnion` leaves this alone and it
    // renders through the JSON fallback — where a user can still enter `null`.
    const wide = {
      anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
    };
    expect(normalizeNullableUnion(wide)).toBe(wide);
    expect(admitsNull(wide)).toBe(true);
  });

  it("recognizes a null branch declared as a nested type array", () => {
    expect(admitsNull({ anyOf: [{ type: ["string", "null"] }] })).toBe(true);
  });

  // Applicators this module does not evaluate. `oneOf` requires *exactly one*
  // branch to match, so a null branch does not by itself mean null validates;
  // `not` and `allOf` can rule it out outright. Under-claiming costs a clear
  // button, over-claiming lets the form emit a value the schema rejects.
  it("declines to claim nullability for applicators it cannot evaluate", () => {
    expect(admitsNull({ oneOf: [{ type: "string" }, { type: "null" }] })).toBe(
      false,
    );
    expect(
      admitsNull({ not: { type: "null" }, anyOf: [{ type: "null" }] }),
    ).toBe(false);
    expect(
      admitsNull({ allOf: [{ type: "string" }], anyOf: [{ type: "null" }] }),
    ).toBe(false);
  });

  // A branch can name null and still admit nothing.
  it("ignores an unsatisfiable null branch", () => {
    expect(
      admitsNull({ anyOf: [{ type: "string" }, { type: "null", const: "x" }] }),
    ).toBe(false);
    expect(
      admitsNull({
        anyOf: [{ type: "string" }, { type: "null", enum: ["x"] }],
      }),
    ).toBe(false);
    expect(
      admitsNull({
        anyOf: [{ type: "string" }, { type: "null", not: { type: "null" } }],
      }),
    ).toBe(false);
  });

  it("ignores a null branch made unsatisfiable by its own nested anyOf", () => {
    expect(
      admitsNull({
        anyOf: [
          { type: "string" },
          { type: "null", anyOf: [{ type: "string" }] },
        ],
      }),
    ).toBe(false);
  });

  it("still accepts a plain null branch alongside an unsatisfiable one", () => {
    expect(
      admitsNull({
        anyOf: [{ type: "null", const: "x" }, { type: "null" }],
      }),
    ).toBe(true);
  });

  it("is false for a schema that does not permit null", () => {
    expect(admitsNull({ type: "string" })).toBe(false);
    expect(admitsNull({ type: ["string", "number"] })).toBe(false);
    expect(
      admitsNull({ anyOf: [{ type: "string" }, { type: "number" }] }),
    ).toBe(false);
    expect(admitsNull({})).toBe(false);
  });

  it("ignores non-object anyOf members instead of throwing", () => {
    expect(admitsNull({ anyOf: ["null", ["null"], 7] })).toBe(false);
  });

  // JSON Schema keywords at one level are conjunctive, so a syntactic null does
  // not by itself mean the schema accepts null. `{ type: ["string","null"],
  // enum: ["envio"] }` names "null" and still rejects it.
  it("is false when a sibling enum excludes null", () => {
    expect(admitsNull({ type: ["string", "null"], enum: ["envio"] })).toBe(
      false,
    );
    expect(
      admitsNull({
        anyOf: [{ type: "string" }, { type: "null" }],
        enum: ["a"],
      }),
    ).toBe(false);
  });

  it("is true when a sibling enum offers null", () => {
    expect(
      admitsNull({ type: ["string", "null"], enum: ["envio", null] }),
    ).toBe(true);
  });

  it("is false when a sibling const pins a non-null value", () => {
    expect(admitsNull({ type: ["string", "null"], const: "envio" })).toBe(
      false,
    );
    expect(admitsNull({ type: ["string", "null"], const: null })).toBe(true);
  });

  // A branch's enum is scoped to that branch, not a sibling of the union — this
  // is the #1928 shape, and reading it as a sibling would call it non-nullable.
  // An explicit `type` is conjunctive with the union, so it decides rather than
  // merely offering another way to say yes. A `{ type: "null" }` branch cannot
  // override a top-level `type: "string"`.
  it("lets an explicit non-null type override a null branch", () => {
    expect(
      admitsNull({
        type: "string",
        anyOf: [{ type: "string", enum: ["a"] }, { type: "null" }],
      }),
    ).toBe(false);
  });

  it("still honors an explicit type that does admit null", () => {
    expect(admitsNull({ type: ["string", "null"] })).toBe(true);
    expect(admitsNull({ type: "null" })).toBe(true);
  });

  // A sibling union is conjunctive with the `type`, so it can reject null even
  // when the type list names it. It is not evaluated here, so its mere presence
  // withholds the claim.
  it("withholds the claim when a sibling anyOf sits beside an explicit type", () => {
    expect(
      admitsNull({ type: ["string", "null"], anyOf: [{ type: "string" }] }),
    ).toBe(false);
    // Unsatisfiable: names null, admits nothing.
    expect(admitsNull({ type: "null", anyOf: [{ type: "string" }] })).toBe(
      false,
    );
  });

  it("is unaffected by an enum that lives inside an anyOf branch", () => {
    expect(
      admitsNull({
        anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
      }),
    ).toBe(true);
  });

  describe("a const-null schema (#2123)", () => {
    it("admits null when nothing else rules it out", () => {
      expect(admitsNull({ const: null })).toBe(true);
      expect(admitsNull({ type: "null", const: null })).toBe(true);
      expect(admitsNull({ type: ["string", "null"], const: null })).toBe(true);
    });

    it("honors a sibling `nullable` flag", () => {
      expect(admitsNull({ type: "string", nullable: true, const: null })).toBe(
        true,
      );
    });

    it("admits null when a sibling anyOf branch does", () => {
      // The union decides in both directions: an all-string one rejects null,
      // and a null branch admits it just as plainly.
      expect(admitsNull({ const: null, anyOf: [{ type: "null" }] })).toBe(true);
    });

    it("recognizes a branch that spells its nullability another way", () => {
      // The branch admits null through `const`, not through `type`.
      expect(admitsNull({ const: null, anyOf: [{ const: null }] })).toBe(true);
      expect(admitsNull({ const: null, anyOf: [{ nullable: true }] })).toBe(
        true,
      );
    });

    it("admits null when a sibling branch constrains nothing", () => {
      // `{}` is the equivalent of `true` — it admits every value, null among
      // them — so the pinned null stays reachable and its field submittable.
      expect(admitsNull({ const: null, anyOf: [{}] })).toBe(true);
      expect(admitsNull({ const: null, anyOf: [{ title: "anything" }] })).toBe(
        true,
      );
    });

    it("reads the boolean schema form", () => {
      // `true` is the unconstrained schema; `false` admits nothing at all.
      expect(admitsNull({ const: null, anyOf: [true] })).toBe(true);
      expect(admitsNull({ const: null, anyOf: [false] })).toBe(false);
    });

    it("treats core identifier keywords as asserting nothing", () => {
      // `$defs` declares subschemas for reference; it constrains nothing on its
      // own, so this branch is unconstrained and admits null.
      expect(admitsNull({ const: null, anyOf: [{ $defs: {} }] })).toBe(true);
      // `$ref` is different — it applies whatever it points at.
      expect(admitsNull({ const: null, anyOf: [{ $ref: "#/$defs/T" }] })).toBe(
        false,
      );
    });

    it("reads an enum that offers null", () => {
      expect(admitsNull({ enum: [null] })).toBe(true);
      expect(admitsNull({ const: null, anyOf: [{ enum: [null] }] })).toBe(true);
      // …under the same sibling conditions a `const: null` answers to.
      expect(admitsNull({ type: "string", enum: [null] })).toBe(false);
    });

    it("does not override a sibling that rejects null", () => {
      // `const` is conjunctive with its siblings, not an override: both of
      // these reject every value, so claiming nullability would let the
      // required-field gate accept a `null` the schema forbids.
      expect(admitsNull({ type: "string", const: null })).toBe(false);
      expect(admitsNull({ const: null, anyOf: [{ type: "string" }] })).toBe(
        false,
      );
      expect(admitsNull({ const: null, not: { type: "null" } })).toBe(false);
    });
  });
});
