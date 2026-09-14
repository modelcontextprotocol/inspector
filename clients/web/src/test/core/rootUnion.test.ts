import { describe, it, expect } from "vitest";
import {
  declaresAnyFields,
  resolveRootUnion,
  selectBranchIndex,
} from "@inspector/core/json/rootUnion.js";

const EMAIL = {
  type: "object",
  properties: {
    kind: { type: "string", const: "email" },
    address: { type: "string" },
  },
  required: ["kind", "address"],
};

const SMS = {
  type: "object",
  properties: {
    kind: { type: "string", const: "sms" },
    phone: { type: "string" },
  },
  required: ["kind", "phone"],
};

describe("resolveRootUnion", () => {
  it("leaves an ordinary object schema alone", () => {
    const schema = {
      type: "object" as const,
      properties: { message: { type: "string" as const } },
      required: ["message"],
    };
    const { base, branches } = resolveRootUnion(schema);
    expect(branches).toEqual([]);
    expect(base.properties).toEqual(schema.properties);
    expect(base.required).toEqual(["message"]);
  });

  it("returns a branch per anyOf member, merged with the root", () => {
    const { base, branches } = resolveRootUnion({
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
      anyOf: [EMAIL, SMS],
    });

    // The root's own fields render for every branch, so they stay on the base
    // and are merged into each branch rather than belonging to one.
    expect(Object.keys(base.properties ?? {})).toEqual(["note"]);
    expect(branches).toHaveLength(2);
    expect(Object.keys(branches[0].schema.properties ?? {})).toEqual([
      "note",
      "kind",
      "address",
    ]);
    expect(branches[0].schema.required).toEqual(["note", "kind", "address"]);
    expect(branches[0].declaredFields).toEqual(["kind", "address"]);
    expect(branches[1].declaredFields).toEqual(["kind", "phone"]);
  });

  it("strips the composition keywords it has absorbed", () => {
    const { base, branches } = resolveRootUnion({
      type: "object",
      anyOf: [EMAIL, SMS],
    });
    expect(base.anyOf).toBeUndefined();
    expect(branches[0].schema.anyOf).toBeUndefined();
  });

  it("declines a schema carrying both oneOf and anyOf", () => {
    // Independent keywords a value satisfies together, so reading one and
    // dropping the other would build a form missing real constraints.
    const { base, branches } = resolveRootUnion({
      type: "object",
      properties: { note: { type: "string" } },
      oneOf: [EMAIL],
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toEqual([]);
    expect(Object.keys(base.properties ?? {})).toEqual(["note"]);
  });

  it("leaves an unsatisfiable allOf alone rather than dropping it", () => {
    // `allOf: [false, …]` admits nothing. Treating the boolean member as a
    // no-op and stripping the keyword would render a fillable form for a schema
    // that can never be satisfied.
    const schema = {
      type: "object" as const,
      allOf: [
        false as unknown,
        { type: "object", properties: { x: { type: "string" } } },
      ],
    };
    const { base, branches } = resolveRootUnion(schema);
    expect(branches).toEqual([]);
    expect(base.properties).toBeUndefined();
    expect(base.allOf).toBe(schema.allOf);
  });

  it("leaves an allOf carrying a $ref alone", () => {
    // The referent is not resolved here, so its constraints are unknown rather
    // than absent.
    const { base } = resolveRootUnion({
      type: "object",
      allOf: [{ $ref: "#/$defs/Thing" }],
    });
    expect(base.allOf).toHaveLength(1);
    expect(base.properties).toBeUndefined();
  });

  it("declines a union when the allOf beneath it could not be flattened", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      allOf: [{ $ref: "#/$defs/Thing" }],
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toEqual([]);
  });

  it("leaves an allOf member carrying a constraint the merge cannot apply", () => {
    // Only `properties`/`required` are merged, so a member stating anything
    // further would have that constraint erased with the keyword.
    for (const member of [
      { type: "object", properties: { x: {} }, additionalProperties: false },
      { type: "object", properties: { x: {} }, not: { properties: {} } },
      { type: "string", properties: { x: {} } },
    ]) {
      const { base } = resolveRootUnion({
        type: "object" as const,
        allOf: [member as unknown],
      });
      expect(base.allOf).toHaveLength(1);
      expect(base.properties).toBeUndefined();
    }
  });

  it("declines an allOf whose members contradict each other", () => {
    // Neither conflicts with the root, which declares no `x` at all.
    const { base } = resolveRootUnion({
      type: "object",
      allOf: [
        { type: "object", properties: { x: { minimum: 10 } } },
        { type: "object", properties: { x: { minimum: 0 } } },
      ],
    });
    expect(base.allOf).toHaveLength(2);
    expect(base.properties).toBeUndefined();
  });

  it("leaves an allOf that adds names a restrictive additionalProperties forbids", () => {
    // The root rejects `x` as an additional property; folding the member in
    // would move it beside the keyword, where it reads as allowed.
    const { base } = resolveRootUnion({
      type: "object",
      additionalProperties: false,
      allOf: [
        {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
        },
      ],
    });
    expect(base.allOf).toHaveLength(1);
    expect(base.properties).toBeUndefined();
  });

  it("merges allOf branches unconditionally", () => {
    const { base, branches } = resolveRootUnion({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      allOf: [
        {
          type: "object",
          properties: { b: { type: "number" } },
          required: ["b"],
        },
      ],
    });
    expect(branches).toEqual([]);
    expect(Object.keys(base.properties ?? {})).toEqual(["a", "b"]);
    expect(base.required).toEqual(["a", "b"]);
    expect(base.allOf).toBeUndefined();
  });

  it("merges allOf into every union branch", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      allOf: [{ type: "object", properties: { shared: { type: "string" } } }],
      oneOf: [EMAIL, SMS],
    });
    expect(Object.keys(branches[0].schema.properties ?? {})).toContain(
      "shared",
    );
  });

  it("merges a name collision rather than replacing the root's declaration", () => {
    // Both apply, so the root's floor must survive the branch's ceiling.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { id: { type: "number", minimum: 0 } },
      required: ["id"],
      anyOf: [
        { type: "object", properties: { id: { maximum: 10 } } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches[0].schema.properties?.id).toEqual({
      type: "number",
      minimum: 0,
      maximum: 10,
    });
    // `required` unions rather than duplicating.
    expect(branches[0].schema.required).toEqual(["id"]);
    // The branch declares the name, even though the base did too.
    expect(branches[0].declaredFields).toEqual(["id"]);
  });

  it("declines a union whose branch restates a constraint differently", () => {
    // Both apply, so root `minimum: 10` under branch `minimum: 0` is still 10.
    // Rendering either side would accept a value the schema rejects.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { type: "number", minimum: 10 } },
      anyOf: [
        { type: "object", properties: { x: { minimum: 0 } } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toEqual([]);
  });

  it("tolerates a branch disagreeing only about annotations", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { type: "number", description: "root" } },
      anyOf: [
        {
          type: "object",
          properties: { x: { description: "branch", maximum: 3 } },
        },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toHaveLength(2);
    expect(branches[0].schema.properties?.x).toEqual({
      type: "number",
      description: "branch",
      maximum: 3,
    });
  });

  it("carries an identical non-object declaration across", () => {
    // JSON Schema's boolean form is legal as a property schema. There are no
    // keywords to merge, so the two agree only by being the same declaration.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: true as unknown },
      anyOf: [
        { type: "object", properties: { x: true as unknown } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toHaveLength(2);
    expect(branches[0].schema.properties?.x).toBe(true);
  });

  it("declines a union whose branch redeclares a non-object property differently", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: true as unknown },
      anyOf: [
        { type: "object", properties: { x: false as unknown } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toEqual([]);
  });

  it("tolerates a branch suggesting a different default", () => {
    // `default` constrains nothing, so two declarations suggesting different
    // initial values still accept the same values.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { count: { default: 1 } },
      anyOf: [
        {
          type: "object",
          properties: { count: { type: "number", default: 2 } },
        },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toHaveLength(2);
  });

  it("does not mistake an inherited object property for a root declaration", () => {
    // `constructor` is a legal argument name; finding it on `Object.prototype`
    // would report a conflict the root never declared.
    const anyOf: unknown[] = [
      { type: "object", properties: { constructor: { type: "string" } } },
      { type: "object", properties: { other: { type: "string" } } },
    ];
    const { branches } = resolveRootUnion({
      type: "object",
      properties: {},
      anyOf,
    });
    expect(branches).toHaveLength(2);
    expect(branches[0].schema.properties?.constructor).toEqual({
      type: "string",
    });
  });

  it("keeps a branch property named __proto__", () => {
    // Assigning it would invoke the legacy prototype setter rather than create
    // an own property, losing a renderable field.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { keep: { type: "string" } },
      // A computed key: `__proto__:` in an object literal is the prototype
      // setter, so the literal form would not even create the property.
      anyOf: [
        { type: "object", properties: { ["__proto__"]: { type: "string" } } },
        { type: "object", properties: { other: { type: "string" } } },
      ] as unknown[],
    });
    expect(Object.keys(branches[0].schema.properties ?? {})).toEqual([
      "keep",
      "__proto__",
    ]);
  });

  it("declines a union that adds fields under a restrictive additionalProperties", () => {
    // `additionalProperties` constrains what its SIBLING `properties` does not
    // name, so the original schema admits none of the branch fields — moving
    // them beside the keyword would make them read as allowed.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { known: { type: "string" } },
      additionalProperties: false,
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toEqual([]);
  });

  it("treats an annotation-only additionalProperties schema as permissive", () => {
    // `{ title: … }` asserts nothing, so it is the equivalent of `true` just
    // as `{}` is — declining on key count alone would recreate the empty form.
    const { branches } = resolveRootUnion({
      type: "object",
      additionalProperties: { title: "Extra value" },
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toHaveLength(2);
  });

  it("treats an empty additionalProperties schema as permissive", () => {
    // `{}` is the JSON Schema equivalent of `true` — it constrains nothing.
    const { branches } = resolveRootUnion({
      type: "object",
      additionalProperties: {},
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toHaveLength(2);
  });

  it("allows a restrictive additionalProperties the branches stay within", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { kind: {}, address: {}, phone: {} },
      additionalProperties: false,
      anyOf: [EMAIL, SMS],
    });
    expect(branches).toHaveLength(2);
  });

  it("declines a branch whose const its root type rejects", () => {
    // The two share no keyword, yet nothing satisfies both — and the merged
    // declaration would seed an immutable `1` into a string field.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { type: "string" } },
      anyOf: [
        { type: "object", properties: { x: { const: 1 } } },
        { type: "object", properties: { other: { type: "string" } } },
      ] as unknown[],
    });
    expect(branches).toEqual([]);
  });

  it("declines a branch whose const its root enum excludes", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { enum: ["a", "b"] } },
      anyOf: [
        { type: "object", properties: { x: { const: "c" } } },
        { type: "object", properties: { other: { type: "string" } } },
      ] as unknown[],
    });
    expect(branches).toEqual([]);
  });

  it("declines a const paired with an assertion it cannot evaluate", () => {
    // `minimum: 10` beside `const: 1` is as unsatisfiable as a type mismatch,
    // and proving the conjunction safe is the requirement here.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { type: "number", minimum: 10 } },
      anyOf: [
        { type: "object", properties: { x: { const: 1 } } },
        { type: "object", properties: { other: { type: "string" } } },
      ] as unknown[],
    });
    expect(branches).toEqual([]);
  });

  it("accepts a const its root type and enum admit", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { x: { type: "number", enum: [1, 2] } },
      anyOf: [
        // An integer const satisfies a `number` type — the one direction JSON
        // Schema widens.
        { type: "object", properties: { x: { const: 1 } } },
        { type: "object", properties: { other: { type: "string" } } },
      ] as unknown[],
    });
    expect(branches).toHaveLength(2);
  });

  it("declines a union whose branch contradicts the root's type for a field", () => {
    // `string` under a base `number` describes a value that cannot exist, so
    // flattening it would render one type and accept what the schema rejects.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { id: { type: "number" } },
      anyOf: [
        { type: "object", properties: { id: { type: "string" } } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    });
    expect(branches).toEqual([]);
  });

  describe("values it compares and types it recognizes", () => {
    it("offers a branch whose type list names object", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: ["object", "null"],
            properties: { a: { type: "string" } },
          },
          { type: "object", properties: { b: { type: "string" } } },
        ] as unknown[],
      });
      expect(branches).toHaveLength(2);
    });

    it("compares array-valued constants structurally", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        required: ["tag"],
        oneOf: [
          {
            type: "object",
            properties: { tag: { const: [1, 2] }, x: { type: "string" } },
          },
          {
            type: "object",
            properties: { tag: { const: [1, 2] }, y: { type: "string" } },
          },
        ],
      });
      // The same value twice, so the alternatives are not exclusive.
      expect(branches).toEqual([]);
    });

    it("treats a keyword explicitly set to undefined as a disagreement", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        properties: { x: { minimum: undefined } },
        anyOf: [
          { type: "object", properties: { x: { minimum: 1 } } },
          { type: "object", properties: { other: { type: "string" } } },
        ] as unknown[],
      });
      expect(branches).toEqual([]);
    });

    it("recognizes each JSON type when checking a const", () => {
      const accepts = (type: unknown, constValue: unknown) =>
        resolveRootUnion({
          type: "object",
          properties: { x: { type } as unknown },
          anyOf: [
            { type: "object", properties: { x: { const: constValue } } },
            { type: "object", properties: { other: { type: "string" } } },
          ] as unknown[],
        }).branches.length > 0;

      expect(accepts("null", null)).toBe(true);
      expect(accepts("array", [1])).toBe(true);
      expect(accepts("number", 1)).toBe(true);
      expect(accepts(["string", "integer"], 1)).toBe(true);
      expect(accepts("integer", 1.5)).toBe(false);
      expect(accepts(["string", "boolean"], 1)).toBe(false);
    });

    it("emits no properties when neither side declares any", () => {
      const { base } = resolveRootUnion({
        type: "object",
        allOf: [{ type: "object", required: ["a"] }],
      });
      expect(base.properties).toBeUndefined();
      expect(base.required).toEqual(["a"]);
    });
  });

  describe("branch labels", () => {
    it("uses the branch's own title first", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [{ ...EMAIL, title: "By email" }, SMS],
      });
      expect(branches[0].label).toBe("By email");
    });

    it("uses the discriminator property's const when one is named", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        discriminator: { propertyName: "kind" },
        oneOf: [EMAIL, SMS],
      });
      expect(branches.map((branch) => branch.label)).toEqual(["email", "sms"]);
    });

    it("uses a lone constant-valued property when there is no discriminator", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [EMAIL, SMS],
      });
      expect(branches.map((branch) => branch.label)).toEqual(["email", "sms"]);
    });

    it("falls back to a position when a branch has several constants", () => {
      const twoConstants = {
        type: "object",
        properties: {
          kind: { const: "a" },
          other: { const: "b" },
        },
      };
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [twoConstants, SMS],
      });
      expect(branches[0].label).toBe("Option 1");
    });

    it("falls back to a position when a branch names no constant", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
      });
      expect(branches.map((branch) => branch.label)).toEqual([
        "Option 1",
        "Option 2",
      ]);
    });

    it("ignores a discriminator naming a property without a usable const", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        discriminator: { propertyName: "missing" },
        anyOf: [EMAIL, SMS],
      });
      expect(branches[0].label).toBe("email");
    });

    it("labels boolean and null constants by their values", () => {
      // `hasDiscriminator` accepts these, so the label must too — otherwise a
      // perfectly discriminated union reads as "Option 1"/"Option 2".
      const { branches } = resolveRootUnion({
        type: "object",
        required: ["v"],
        oneOf: [
          { type: "object", properties: { v: { const: true }, a: {} } },
          { type: "object", properties: { v: { const: null }, b: {} } },
        ],
      });
      expect(branches.map((branch) => branch.label)).toEqual(["true", "null"]);
    });

    it("labels a numeric const by its value", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          { type: "object", properties: { v: { const: 1 } } },
          { type: "object", properties: { v: { const: 2 } } },
        ],
      });
      expect(branches.map((branch) => branch.label)).toEqual(["1", "2"]);
    });

    it("ignores a blank title", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [{ ...EMAIL, title: "  " }, SMS],
      });
      expect(branches[0].label).toBe("email");
    });
  });

  it("offers a branch that only adds required names over the root's fields", () => {
    // `anyOf: [{ required: ["email"] }, { required: ["phone"] }]` is an
    // ordinary way to say "one of these two". Judging the member on its own
    // properties declined it, leaving the gate checking the base alone and
    // accepting `{}` — which the schema rejects.
    const { branches } = resolveRootUnion({
      type: "object",
      properties: { email: { type: "string" }, phone: { type: "string" } },
      anyOf: [
        { type: "object", required: ["email"] },
        { type: "object", required: ["phone"] },
      ],
    });
    expect(branches).toHaveLength(2);
    expect(branches[0].schema.required).toEqual(["email"]);
    expect(branches[1].schema.required).toEqual(["phone"]);
  });

  describe("oneOf exclusivity", () => {
    it("offers a discriminated oneOf", () => {
      expect(
        resolveRootUnion({ type: "object", oneOf: [EMAIL, SMS] }).branches,
      ).toHaveLength(2);
    });

    it("declines a oneOf whose alternatives are not mutually exclusive", () => {
      // `oneOf` demands that EXACTLY one alternative match; flattening offers
      // them as if any would do. Here entering `a` satisfies both, so a call
      // the form calls valid is one the server refuses.
      const { branches } = resolveRootUnion({
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
            required: ["a"],
          },
          {
            type: "object",
            properties: { a: { type: "string" }, b: { type: "string" } },
            required: ["a"],
          },
        ],
      });
      expect(branches).toEqual([]);
    });

    it("still offers the same alternatives under anyOf", () => {
      // `anyOf` makes no exclusivity claim, so overlapping alternatives are
      // exactly what it means.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
            required: ["a"],
          },
          {
            type: "object",
            properties: { a: { type: "string" }, b: { type: "string" } },
            required: ["a"],
          },
        ],
      });
      expect(branches).toHaveLength(2);
    });

    it("compares object constants irrespective of member order", () => {
      // Member order carries no meaning in JSON, so these two alternatives are
      // pinned to the SAME value and both match — not mutually exclusive.
      const { branches } = resolveRootUnion({
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: { tag: { const: { a: 1, b: 2 } }, x: {} },
          },
          {
            type: "object",
            properties: { tag: { const: { b: 2, a: 1 } }, y: {} },
          },
        ],
      });
      expect(branches).toEqual([]);
    });

    it("declines a oneOf whose discriminator is optional", () => {
      // Two branches pinning an OPTIONAL `kind` both match `{}`, so arguments
      // omitting it satisfy more than one alternative.
      const { branches } = resolveRootUnion({
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: { kind: { const: "a" }, x: { type: "string" } },
          },
          {
            type: "object",
            properties: { kind: { const: "b" }, y: { type: "string" } },
          },
        ],
      });
      expect(branches).toEqual([]);
    });

    it("accepts a discriminator the root requires", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        required: ["kind"],
        oneOf: [
          {
            type: "object",
            properties: { kind: { const: "a" }, x: { type: "string" } },
          },
          {
            type: "object",
            properties: { kind: { const: "b" }, y: { type: "string" } },
          },
        ],
      });
      expect(branches).toHaveLength(2);
    });

    it("declines a oneOf whose named discriminator does not distinguish", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        discriminator: { propertyName: "kind" },
        oneOf: [EMAIL, { ...EMAIL, properties: { ...EMAIL.properties } }],
      });
      expect(branches).toEqual([]);
    });
  });

  describe("unions it declines to offer", () => {
    // Each of these would produce a picker with an option that renders
    // nothing, which is the failure this module exists to prevent.
    it("declines a union with a member that is not an object", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [EMAIL, "nope" as unknown],
      });
      expect(branches).toEqual([]);
    });

    it("declines a union with a fieldless member", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [EMAIL, { type: "null" }],
      });
      expect(branches).toEqual([]);
    });

    it("declines a member whose type rules objects out", () => {
      // Tool arguments are a JSON object, so a `{ type: "string" }` member can
      // never match — a fillable form for it would offer an invalid call.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [EMAIL, { type: "string", properties: { a: {} } }],
      });
      expect(branches).toEqual([]);
    });

    it("declines a member carrying a property that is not a schema", () => {
      // A `null` or an array is not a schema, and the web form dereferences
      // one on the way to choosing a widget — so the branch is declined rather
      // than handed on to crash a tool panel.
      for (const property of [null, [1]] as unknown[]) {
        const { branches } = resolveRootUnion({
          type: "object",
          anyOf: [
            EMAIL,
            { type: "object", properties: { broken: property } },
          ] as unknown[],
        });
        expect(branches).toEqual([]);
      }
    });

    it("offers a member carrying a `true` property schema", () => {
      // `true` constrains nothing and answers every keyword lookup with
      // `undefined`, so it renders through the JSON fallback harmlessly.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          { type: "object", properties: { anything: true } },
          { type: "object", properties: { other: { type: "string" } } },
        ] as unknown[],
      });
      expect(branches).toHaveLength(2);
    });

    it("declines a member requiring a name nothing declares", () => {
      // `required` is a list of names, not of declarations. Both form builders
      // enumerate `properties` alone, so `payload` gets no control while the
      // submit gate reports it missing forever — the picker offers an option
      // that can never be completed (#2224).
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { kind: { const: "a" } },
            required: ["kind", "payload"],
          },
          SMS,
        ],
      });
      expect(branches).toEqual([]);
    });

    it("declines a member requiring a name only ANOTHER member declares", () => {
      // Branches are alternatives, not a conjunction: a name the sibling
      // declares is not one this branch can render, so the dead end is the
      // same one.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { kind: { const: "a" } },
            required: ["kind", "phone"],
          },
          SMS,
        ],
      });
      expect(branches).toEqual([]);
    });

    it("offers a member requiring a name it inherits from the root", () => {
      // The merge is what is judged, so a member requiring a name the ROOT
      // declares stays offerable — the `anyOf: [{ required: ["email"] }, …]`
      // shape above must not regress.
      const { branches } = resolveRootUnion({
        type: "object",
        properties: { token: { type: "string" } },
        anyOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
            required: ["token"],
          },
          {
            type: "object",
            properties: { b: { type: "string" } },
            required: ["token"],
          },
        ],
      });
      expect(branches).toHaveLength(2);
    });

    it("does not read an inherited name as a declared property", () => {
      // An argument legally named `constructor` resolves through the prototype
      // on a plain object, so a membership test that is not `hasOwn` would call
      // this branch offerable and render nothing for it.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { kind: { const: "a" } },
            required: ["constructor"],
          },
          SMS,
        ],
      });
      expect(branches).toEqual([]);
    });

    it("declines a member carrying a `false` property schema", () => {
      // `false` admits no value at all, so the field can never be filled — and
      // a required one makes the branch unsatisfiable.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          { type: "object", properties: { nothing: false } },
          { type: "object", properties: { other: { type: "string" } } },
        ] as unknown[],
      });
      expect(branches).toEqual([]);
    });

    it("declines a member whose properties are not an object", () => {
      // Members arrive as `unknown`, so this is reachable and must not throw.
      expect(
        resolveRootUnion({
          type: "object",
          anyOf: [EMAIL, { type: "object", properties: null as unknown }],
        }).branches,
      ).toEqual([]);
    });

    it("declines a member carrying a constraint the merge cannot apply", () => {
      // Same faithfulness test the `allOf` fold applies — otherwise a branch
      // whose nested `allOf: [false]` makes it unsatisfiable is offered as a
      // callable alternative.
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          EMAIL,
          {
            type: "object",
            properties: { x: { type: "string" } },
            allOf: [false as unknown],
          },
        ],
      });
      expect(branches).toEqual([]);
    });

    it("survives a composition keyword that is not a list", () => {
      // These schemas describe the wire, and every member arrives as `unknown`
      // — reading `anyOf: {}` as a list would throw and take all three clients
      // down rather than declining one malformed tool.
      // A single assertion, from an `unknown`-typed value: the point is a wire
      // shape TypeScript would never produce, not a cast chain.
      const malformed: unknown = {};
      const { base, branches } = resolveRootUnion({
        type: "object",
        properties: { a: { type: "string" } },
        anyOf: malformed as unknown[],
      });
      expect(branches).toEqual([]);
      expect(Object.keys(base.properties ?? {})).toEqual(["a"]);
    });

    it("survives a required that is not a list", () => {
      const { branches } = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { a: { type: "string" } },
            required: "a",
          },
          { type: "object", properties: { b: { type: "string" } } },
        ] as unknown[],
      });
      expect(branches).toHaveLength(2);
      expect(branches[0].schema.required).toBeUndefined();
    });

    it("declines an empty union", () => {
      expect(resolveRootUnion({ type: "object", anyOf: [] }).branches).toEqual(
        [],
      );
    });

    it("ignores an allOf member that is not an object", () => {
      const { base } = resolveRootUnion({
        type: "object",
        properties: { a: { type: "string" } },
        allOf: [null as unknown, 3 as unknown],
      });
      expect(Object.keys(base.properties ?? {})).toEqual(["a"]);
    });
  });

  describe("declaresAnyFields", () => {
    it("sees fields on a union the resolver declines", () => {
      // A declined union still HAS fields — reporting none would auto-invoke an
      // App tool with `{}` instead of asking for them.
      const schema = {
        type: "object" as const,
        anyOf: [EMAIL, { $ref: "#/$defs/SMS" }],
      };
      expect(resolveRootUnion(schema).branches).toEqual([]);
      expect(declaresAnyFields(schema)).toBe(true);
    });

    it("sees fields nested a level down", () => {
      expect(
        declaresAnyFields({
          type: "object",
          allOf: [{ type: "object", anyOf: [EMAIL, SMS] }],
        }),
      ).toBe(true);
    });

    it("still counts a union whose every branch is now declined", () => {
      // The #2224 check makes such a union render nothing, which must not be
      // read as "this tool takes no arguments" — an App tool carrying one would
      // then be auto-invoked with `{}` rather than asked about.
      expect(
        declaresAnyFields({
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "a" } },
              required: ["kind", "payload"],
            },
          ],
        }),
      ).toBe(true);
    });

    it("counts a required name a schema never declares", () => {
      // Legal, and the tool plainly takes an argument — an App tool shaped this
      // way must ask rather than being auto-invoked with `{}`.
      expect(declaresAnyFields({ type: "object", required: ["token"] })).toBe(
        true,
      );
      expect(
        declaresAnyFields({
          type: "object",
          allOf: [{ type: "object", required: ["token"] }],
        }),
      ).toBe(true);
    });

    it("reports none for a bare object schema", () => {
      expect(declaresAnyFields({ type: "object" })).toBe(false);
      expect(declaresAnyFields(undefined)).toBe(false);
    });
  });

  describe("selectBranchIndex", () => {
    const { branches } = resolveRootUnion({
      type: "object",
      anyOf: [EMAIL, SMS],
    });

    it("names the branch whose discriminator the values carry", () => {
      expect(selectBranchIndex(branches, { kind: "sms" })).toBe(1);
    });

    it("identifies a branch from the constants that were supplied", () => {
      // Both branches pin `version` as well; a deep link naming only `kind`
      // must still find its branch — the unsupplied constant is one this
      // identification exists to seed.
      const versioned = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: {
              version: { const: "1" },
              kind: { const: "email" },
            },
          },
          {
            type: "object",
            properties: { version: { const: "1" }, kind: { const: "sms" } },
          },
        ],
      }).branches;
      expect(selectBranchIndex(versioned, { kind: "sms" })).toBe(1);
      // A supplied constant that disagrees is still evidence against.
      expect(selectBranchIndex(versioned, { version: "2", kind: "sms" })).toBe(
        null,
      );
    });

    it("falls back to the branch whose required fields the values supply", () => {
      // An undiscriminated union still has shapes, and the required-field gate
      // accepts any satisfied branch — so the picker must open on the one the
      // values satisfy rather than showing a shape they do not describe.
      const undiscriminated = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { address: { type: "string" } },
            required: ["address"],
          },
          {
            type: "object",
            properties: { phone: { type: "string" } },
            required: ["phone"],
          },
        ],
      }).branches;
      expect(selectBranchIndex(undiscriminated, { phone: "555" })).toBe(1);
      expect(selectBranchIndex(undiscriminated, {})).toBeNull();
    });

    it("matches an object-valued discriminator structurally", () => {
      // Deep-link arguments are freshly parsed instances, never `===` the
      // schema's own constant.
      const objectPinned = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { tag: { const: { a: 1 } }, x: { type: "string" } },
          },
          {
            type: "object",
            properties: { tag: { const: { a: 2 } }, y: { type: "string" } },
          },
        ],
      }).branches;
      expect(selectBranchIndex(objectPinned, { tag: { a: 2 } })).toBe(1);
    });

    it("does not read an inherited property as a supplied constant", () => {
      // `constructor` is a legal field name; reading the inherited one would
      // rule out the very branch that pins it.
      const pinnedOnInherited = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: Object.fromEntries([
              ["constructor", { const: "a" }],
              ["x", { type: "string" }],
            ]),
          },
          {
            type: "object",
            properties: Object.fromEntries([
              ["constructor", { const: "b" }],
              ["y", { type: "string" }],
            ]),
          },
        ] as unknown[],
      }).branches;
      expect(selectBranchIndex(pinnedOnInherited, { x: "supplied" })).toBe(0);
    });

    it("keeps looking when several branches share the supplied constant", () => {
      // Both pin `version`, so that constant settles nothing — but `phone`
      // belongs to one branch alone and does.
      const versioned = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: {
              version: { const: 1 },
              address: { type: "string" },
            },
          },
          {
            type: "object",
            properties: { version: { const: 1 }, phone: { type: "string" } },
          },
        ],
      }).branches;
      expect(selectBranchIndex(versioned, { version: 1, phone: "555" })).toBe(
        1,
      );
    });

    it("prefers the branch the supplied names satisfy over a matching constant", () => {
      // `{ kind: "email", phone: "555" }` agrees with the email branch's
      // discriminator while missing its `address`, and satisfies the phone
      // branch outright — the picker must show the one that can be called.
      const mixed = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: {
              kind: { const: "email" },
              address: { type: "string" },
            },
            required: ["kind", "address"],
          },
          {
            type: "object",
            properties: { phone: { type: "string" } },
            required: ["phone"],
          },
        ],
      }).branches;
      expect(selectBranchIndex(mixed, { kind: "email", phone: "555" })).toBe(1);
      // …and the constant still decides when the names settle nothing.
      expect(selectBranchIndex(mixed, { kind: "email" })).toBe(0);
    });

    it("reports none when the values identify nothing", () => {
      expect(selectBranchIndex(branches, {})).toBeNull();
      expect(selectBranchIndex(branches, { kind: "other" })).toBeNull();
    });

    it("reports none when two branches match", () => {
      // An ambiguous answer is worse than none: the caller falls back to the
      // first branch, where the picker and the values at least agree.
      const ambiguous = resolveRootUnion({
        type: "object",
        anyOf: [EMAIL, { ...EMAIL, properties: { ...EMAIL.properties } }],
      }).branches;
      expect(selectBranchIndex(ambiguous, { kind: "email" })).toBeNull();
    });

    it("identifies a branch from a name only it declares", () => {
      // Nothing is pinned and nothing is required, but `a` belongs to one
      // alternative as plainly as a discriminator would.
      const unpinned = resolveRootUnion({
        type: "object",
        anyOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
      }).branches;
      expect(selectBranchIndex(unpinned, { a: "x" })).toBe(0);
      expect(selectBranchIndex(unpinned, { b: "x" })).toBe(1);
    });

    it("treats a name several branches declare as saying nothing", () => {
      const shared = resolveRootUnion({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { both: { type: "string" }, a: { type: "string" } },
          },
          {
            type: "object",
            properties: { both: { type: "string" }, b: { type: "string" } },
          },
        ],
      }).branches;
      expect(selectBranchIndex(shared, { both: "x" })).toBeNull();
      // …and both branches named at once is no answer either.
      expect(selectBranchIndex(shared, { a: "x", b: "y" })).toBeNull();
    });
  });
});
