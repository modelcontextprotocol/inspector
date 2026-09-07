import { describe, it, expect } from "vitest";
import {
  decodeFormValues,
  missingRequiredFields,
  schemaToForm,
} from "../src/utils/schemaToForm.js";

describe("schemaToForm", () => {
  it("returns an empty Parameters section when there is no schema", () => {
    const form = schemaToForm(null, "noParams");
    expect(form.title).toBe("Test Tool: noParams");
    expect(form.sections).toEqual([{ title: "Parameters", fields: [] }]);
  });

  it("returns an empty Parameters section when properties are absent", () => {
    const form = schemaToForm({}, "empty");
    expect(form.sections[0]?.fields).toEqual([]);
  });

  it("treats a non-object property value as an empty schema instead of throwing", () => {
    // A malformed server schema whose property value is null/primitive must not
    // crash — the field degrades to a plain string input labelled by its key.
    const form = schemaToForm(
      { properties: { bad: null, worse: 42 } },
      "malformed",
    );
    const fields = form.sections[0]?.fields ?? [];
    expect(fields).toHaveLength(2);
    expect(
      fields.map((f) => ({ name: f.name, type: f.type, label: f.label })),
    ).toEqual([
      { name: "bad", type: "string", label: "bad" },
      { name: "worse", type: "string", label: "worse" },
    ]);
  });

  it("maps each JSON Schema type to the matching ink-form field type", () => {
    const form = schemaToForm(
      {
        properties: {
          name: { type: "string", title: "Name" },
          age: { type: "integer", minimum: 0, maximum: 120 },
          ratio: { type: "number", minimum: 0, maximum: 1 },
          active: { type: "boolean" },
          mystery: { type: "object" },
        },
        required: ["name"],
      },
      "typed",
    );

    const fields = form.sections[0]!.fields;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName.name).toMatchObject({
      type: "string",
      label: "Name",
      required: true,
    });
    expect(byName.age).toMatchObject({ type: "integer", min: 0, max: 120 });
    expect(byName.ratio).toMatchObject({ type: "float", min: 0, max: 1 });
    expect(byName.active).toMatchObject({ type: "boolean" });
    // Unknown types fall back to string, and label falls back to the key.
    expect(byName.mystery).toMatchObject({ type: "string", label: "mystery" });
  });

  it("builds a select field from an enum", () => {
    const form = schemaToForm(
      { properties: { color: { type: "string", enum: ["red", "blue"] } } },
      "enum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      type: "select",
      options: [
        { label: "red", value: "red" },
        { label: "blue", value: "blue" },
      ],
    });
  });

  it("builds a select field from an array-of-enum on items.enum alone", () => {
    const form = schemaToForm(
      {
        properties: {
          // Standard array-of-enums shape: options come from `items.enum` with
          // NO top-level `enum`. The array branch keys on `items.enum` alone
          // (matching the web guard), so this renders as a select.
          tags: {
            type: "array",
            items: { enum: ["a", "b"] },
          },
        },
      },
      "arrayEnum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      type: "select",
      options: [
        { label: "a", value: "a" },
        { label: "b", value: "b" },
      ],
    });
  });

  it("still builds a select for an array-of-enum that also carries a top-level enum", () => {
    const form = schemaToForm(
      {
        properties: {
          tags: {
            type: "array",
            enum: ["a", "b"],
            items: { enum: ["a", "b"] },
          },
        },
      },
      "arrayEnumRedundant",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      type: "select",
      options: [
        { label: "a", value: "a" },
        { label: "b", value: "b" },
      ],
    });
  });

  it("uses enumNames as single-select labels while keeping raw values", () => {
    const form = schemaToForm(
      {
        properties: {
          pet: {
            type: "string",
            enum: ["pet-1", "pet-2"],
            enumNames: ["Cats", "Dogs"],
          },
        },
      },
      "titledEnum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      type: "select",
      options: [
        { label: "Cats", value: "pet-1" },
        { label: "Dogs", value: "pet-2" },
      ],
    });
  });

  it("falls back to raw single-select labels when enumNames length mismatches", () => {
    const form = schemaToForm(
      {
        properties: {
          pet: {
            type: "string",
            enum: ["pet-1", "pet-2"],
            // Only one name for two values — a wrong-length zip would
            // mislabel, so the raw values are used as labels.
            enumNames: ["Cats"],
          },
        },
      },
      "mismatchedEnum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      options: [
        { label: "pet-1", value: "pet-1" },
        { label: "pet-2", value: "pet-2" },
      ],
    });
  });

  it("uses items.enumNames as array-of-enum labels while keeping raw values", () => {
    const form = schemaToForm(
      {
        properties: {
          pets: {
            type: "array",
            items: { enum: ["pet-1", "pet-2"], enumNames: ["Cats", "Dogs"] },
          },
        },
      },
      "titledArrayEnum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      type: "select",
      options: [
        { label: "Cats", value: "pet-1" },
        { label: "Dogs", value: "pet-2" },
      ],
    });
  });

  it("falls back to raw array-of-enum labels when items.enumNames length mismatches", () => {
    const form = schemaToForm(
      {
        properties: {
          pets: {
            type: "array",
            items: { enum: ["pet-1", "pet-2"], enumNames: ["Cats"] },
          },
        },
      },
      "mismatchedArrayEnum",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({
      options: [
        { label: "pet-1", value: "pet-1" },
        { label: "pet-2", value: "pet-2" },
      ],
    });
  });

  it("carries a JSON Schema default through as the field's initialValue", () => {
    const form = schemaToForm(
      { properties: { greeting: { type: "string", default: "hi" } } },
      "withDefault",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({ initialValue: "hi" });
  });

  // #2015 (the TUI twin of #1928): an argument declared with Zod's `.nullish()`
  // has no top-level `type`/`enum` — they sit on the surviving `anyOf` branch —
  // so before normalization every one of these degraded to a plain text field.
  describe("nullable unions", () => {
    it("renders a select for an anyOf string-enum|null argument", () => {
      const form = schemaToForm(
        {
          properties: {
            direction: {
              anyOf: [
                { type: "string", enum: ["envio", "recebimento"] },
                { type: "null" },
              ],
            },
          },
        },
        "nullableEnum",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        name: "direction",
        type: "select",
        options: [
          { label: "envio", value: "envio" },
          { label: "recebimento", value: "recebimento" },
        ],
      });
    });

    it("maps the remaining nullable scalar branches to their typed fields", () => {
      const form = schemaToForm(
        {
          properties: {
            reference: { anyOf: [{ type: "string" }, { type: "null" }] },
            quantity: {
              anyOf: [
                { type: "integer", minimum: 1, maximum: 9 },
                { type: "null" },
              ],
            },
            ratio: { anyOf: [{ type: "number" }, { type: "null" }] },
            express: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          },
        },
        "nullableScalars",
      );
      const fields = form.sections[0]!.fields;
      expect(fields.map((f) => ({ name: f.name, type: f.type }))).toEqual([
        { name: "reference", type: "string" },
        { name: "quantity", type: "integer" },
        { name: "ratio", type: "float" },
        { name: "express", type: "boolean" },
      ]);
      // The branch's own constraints are hoisted along with its type.
      expect(fields[1]).toMatchObject({ min: 1, max: 9 });
    });

    it("renders a select for a nullable array-of-enum argument", () => {
      const form = schemaToForm(
        {
          properties: {
            tags: {
              anyOf: [
                { type: "array", items: { enum: ["a", "b"] } },
                { type: "null" },
              ],
            },
          },
        },
        "nullableArrayEnum",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        type: "select",
        options: [
          { label: "a", value: "a" },
          { label: "b", value: "b" },
        ],
      });
    });

    // With the null left in the list, the all-strings check would reject the
    // enum and this would degrade to a plain text field.
    it("renders a select for a type: [string, null] enum, null stripped", () => {
      const form = schemaToForm(
        {
          properties: {
            direction: {
              type: ["string", "null"],
              enum: ["envio", "recebimento", null],
            },
          },
        },
        "typeArrayNullableEnum",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        type: "select",
        options: [
          { label: "envio", value: "envio" },
          { label: "recebimento", value: "recebimento" },
        ],
      });
    });

    it("collapses the type: [T, null] encoding too", () => {
      const form = schemaToForm(
        {
          properties: {
            note: { type: ["string", "null"] },
            flag: { type: ["boolean", "null"] },
          },
        },
        "typeArrayNull",
      );
      expect(
        form.sections[0]!.fields.map((f) => ({ name: f.name, type: f.type })),
      ).toEqual([
        { name: "note", type: "string" },
        { name: "flag", type: "boolean" },
      ]);
    });

    // ink-form hands a select's stringified value straight back, so a numeric
    // enum routed to a select would submit "1" for 1. The typed field loses the
    // enum constraint but keeps the value's type — the safer loss.
    it("routes a nullable numeric enum to its typed field, not a select", () => {
      const form = schemaToForm(
        {
          properties: {
            level: {
              anyOf: [{ type: "integer", enum: [1, 2] }, { type: "null" }],
            },
            ratio: {
              anyOf: [{ type: "number", enum: [0.5, 1.5] }, { type: "null" }],
            },
          },
        },
        "numericEnum",
      );
      expect(
        form.sections[0]!.fields.map((f) => ({ name: f.name, type: f.type })),
      ).toEqual([
        { name: "level", type: "integer" },
        { name: "ratio", type: "float" },
      ]);
    });

    it("routes a plain numeric enum to its typed field too", () => {
      const form = schemaToForm(
        { properties: { level: { type: "integer", enum: [1, 2] } } },
        "plainNumericEnum",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({ type: "integer" });
    });

    it("leaves a union of two real types as a plain string field", () => {
      const form = schemaToForm(
        {
          properties: {
            mixed: { anyOf: [{ type: "string" }, { type: "number" }] },
          },
        },
        "realUnion",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        name: "mixed",
        type: "string",
      });
    });

    // #1005: the unportable-schemas showcase advertises a remote `$ref` so the
    // lint has a `remote-ref` finding to report. A `$ref`-only property falls
    // through to a string field here, which the tool's real (numeric) handler
    // then rejects — so the fixture keeps a local `type` alongside the ref and
    // the tool stays runnable. This pins the half of that contract the TUI
    // owns; the wire half is in `raw-tool-schemas.test.ts`.
    it("types a property that carries both a remote $ref and a local type", () => {
      const form = schemaToForm(
        {
          properties: {
            a: {
              type: "number",
              $ref: "https://example.com/schemas/number.json",
            },
          },
        },
        "refWithLocalType",
      );
      // `float` is this form builder's numeric field kind — the point is that
      // it is NOT the string fallback a `$ref`-only property would get.
      expect(form.sections[0]!.fields[0]).toMatchObject({
        name: "a",
        type: "float",
      });
    });
  });
  describe("root composition (#2123)", () => {
    const UNION = {
      type: "object",
      properties: { note: { type: "string" } },
      discriminator: { propertyName: "kind" },
      oneOf: [
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
            count: { type: "integer" },
          },
          required: ["kind", "count"],
        },
      ],
    };

    it("gives each branch its own section instead of rendering no fields", () => {
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections.map((section) => section.title)).toEqual([
        "Parameters",
        "email",
        "sms",
      ]);
      expect(form.sections[0]!.fields.map((field) => field.name)).toEqual([
        "__variant",
        "note",
      ]);
    });

    it("names branch fields uniquely, since ink-form scopes by name alone", () => {
      // Both branches declare `kind`. Rendered under their real names they
      // would be one field, and the later section's initial value would decide
      // what the earlier section submits.
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections[1]!.fields.map((field) => field.name)).toEqual([
        "__b0__kind",
        "__b0__address",
      ]);
      expect(form.sections[2]!.fields.map((field) => field.name)).toEqual([
        "__b1__kind",
        "__b1__count",
      ]);
    });

    it("labels a branch field by the name the schema declared", () => {
      // The prefix is an internal field name; `buildFields` falls back to its
      // map key for a label, so the user would otherwise see `__b0__address`.
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections[1]!.fields[1]).toMatchObject({
        name: "__b0__address",
        label: "address",
      });
    });

    it("keeps a declared title ahead of the fallback", () => {
      const form = schemaToForm(
        {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { a: { type: "string", title: "Street address" } },
            },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        },
        "titled",
      );
      expect(form.sections[1]!.fields[0]).toMatchObject({
        label: "Street address",
      });
    });

    it("offers a variant select listing the alternatives", () => {
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections[0]!.fields[0]).toMatchObject({
        name: "__variant",
        type: "select",
        initialValue: "0",
        options: [
          { label: "email", value: "0" },
          { label: "sms", value: "1" },
        ],
      });
    });

    it("keeps a branch's typed fields typed", () => {
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections[2]!.fields[1]).toMatchObject({
        name: "__b1__count",
        type: "integer",
      });
    });

    it("renders branch fields optional, since only one branch applies", () => {
      const form = schemaToForm(UNION, "union_tool");
      for (const field of form.sections[1]!.fields) {
        expect(field.required).toBe(false);
      }
    });

    it("renders a const as a one-option select so it cannot be changed", () => {
      const form = schemaToForm(UNION, "union_tool");
      expect(form.sections[1]!.fields[0]).toMatchObject({
        name: "__b0__kind",
        type: "select",
        initialValue: "email",
        options: [{ label: "email", value: "email" }],
      });
    });

    it("never marks a const control required", () => {
      // Its one option may be the empty string, which ink-form's required gate
      // can never accept — the call would not even reach `decodeFormValues`.
      const form = schemaToForm(
        {
          type: "object",
          properties: { kind: { type: "string", const: "" } },
          required: ["kind"],
        },
        "empty_const",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        name: "kind",
        type: "select",
        required: false,
      });
    });

    it("renders a const outside a union the same way", () => {
      const form = schemaToForm(
        {
          type: "object",
          properties: { v: { type: "string", const: "a", default: "b" } },
          required: ["v"],
        },
        "const_tool",
      );
      expect(form.sections[0]!.fields[0]).toMatchObject({
        type: "select",
        initialValue: "a",
        options: [{ label: "a", value: "a" }],
      });
    });

    it("leaves an optional const unfilled", () => {
      // `const` constrains a present value; it does not require the property
      // or act as a default, so an optional one must stay omittable.
      const form = schemaToForm(
        {
          type: "object",
          properties: { dryRun: { type: "boolean", const: true } },
        },
        "optional_const",
      );
      const field = form.sections[0]!.fields[0] as {
        initialValue?: unknown;
        options?: unknown[];
      };
      expect(field.initialValue).toBeUndefined();
      // The single option is still offered to a user who wants it.
      expect(field.options).toEqual([{ label: "true", value: "true" }]);
      expect(decodeFormValues({ type: "object" }, {})).toEqual({});
    });

    it("renders a branch's specialization of a root property in its section", () => {
      const form = schemaToForm(
        {
          type: "object",
          properties: { count: {} },
          anyOf: [
            { type: "object", properties: { count: { type: "integer" } } },
            { type: "object", properties: { other: { type: "string" } } },
          ],
        },
        "specializing",
      );
      // The untyped base declaration is not rendered a second time as a string.
      expect(form.sections[0]!.fields.map((field) => field.name)).toEqual([
        "__variant",
      ]);
      expect(form.sections[1]!.fields[0]).toMatchObject({
        name: "__b0__count",
        type: "integer",
      });
    });

    it("offers a shared base property in every branch's section", () => {
      const schema = {
        type: "object",
        properties: { count: {} },
        required: ["count"],
        anyOf: [
          { type: "object", properties: { count: { type: "integer" } } },
          { type: "object", properties: { other: { type: "string" } } },
        ],
      };
      const form = schemaToForm(schema, "shared");
      // Rendered only in branch A's section, branch B could never supply the
      // required root argument — the chosen branch's fields are what decode.
      expect(form.sections[2]!.fields.map((field) => field.name)).toEqual([
        "__b1__other",
        "__b1__count",
      ]);
      expect(
        decodeFormValues(schema, {
          __variant: "1",
          __b1__other: "x",
          __b1__count: "4",
        }),
      ).toEqual({ other: "x", count: "4" });
    });

    it("keeps its generated names clear of the schema's own", () => {
      const form = schemaToForm(
        {
          type: "object",
          properties: { __variant: { type: "string" } },
          anyOf: [
            { type: "object", properties: { __b0__x: { type: "string" } } },
            { type: "object", properties: { y: { type: "string" } } },
          ],
        },
        "colliding",
      );
      const names = form.sections.flatMap((section) =>
        section.fields.map((field) => field.name),
      );
      // The select steps aside for the declared `__variant`, and the branch
      // prefix steps aside for the declared `__b0__x`.
      expect(names).toContain("__variant_");
      expect(names).toContain("__variant");
      expect(names).toContain("__b_0____b0__x");
    });

    // #2224: `required` lists names, not declarations, so a member may require
    // one it never declares. `buildFields` enumerates `properties` alone, so no
    // control was rendered for it while `missingRequiredFields` reported it
    // missing at every submit — a section the user could never complete.
    it("declines a member requiring a name it never declares", () => {
      const schema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { kind: { type: "string", const: "a" } },
            required: ["kind", "payload"],
          },
          {
            type: "object",
            properties: { kind: { type: "string", const: "b" } },
            required: ["kind"],
          },
        ],
      };
      const form = schemaToForm(schema, "undeclared_required");
      // No variant select and no per-branch section: the union is declined, so
      // the root's own (here empty) properties are what render.
      expect(form.sections).toEqual([{ title: "Parameters", fields: [] }]);
      // And nothing is reported missing, so the call is no longer blocked on a
      // field that has nowhere to be typed.
      expect(
        missingRequiredFields(schema, decodeFormValues(schema, {})),
      ).toEqual([]);
    });

    it("keeps offering a member requiring a name the root declares", () => {
      // The regression guard for the check above: the merge is what is judged,
      // and `anyOf: [{ required: ["email"] }, …]` is an ordinary union.
      const form = schemaToForm(
        {
          type: "object",
          properties: {
            email: { type: "string" },
            phone: { type: "string" },
          },
          anyOf: [
            { type: "object", required: ["email"] },
            { type: "object", required: ["phone"] },
          ],
        },
        "inherited_required",
      );
      expect(form.sections).toHaveLength(3);
      expect(form.sections[0]!.fields[0]).toMatchObject({ name: "__variant" });
    });

    describe("decodeFormValues", () => {
      it("submits the chosen branch's fields under their real names", () => {
        expect(
          decodeFormValues(UNION, {
            __variant: "0",
            note: "hi",
            __b0__kind: "email",
            __b0__address: "a@b.c",
            __b1__kind: "sms",
            __b1__count: 3,
          }),
        ).toEqual({ note: "hi", kind: "email", address: "a@b.c" });
      });

      it("drops the branches the call is not making", () => {
        expect(
          decodeFormValues(UNION, {
            __variant: "1",
            __b0__kind: "email",
            __b0__address: "a@b.c",
            __b1__kind: "sms",
            __b1__count: 3,
          }),
        ).toEqual({ kind: "sms", count: 3 });
      });

      it("omits a branch field the user never filled", () => {
        expect(
          decodeFormValues(UNION, {
            __variant: "0",
            __b0__kind: "email",
          }),
        ).toEqual({ kind: "email" });
      });

      it("falls back to the first branch on an unusable selection", () => {
        expect(
          decodeFormValues(UNION, {
            __variant: "nonsense",
            __b0__kind: "email",
          }),
        ).toEqual({ kind: "email" });
      });

      it("returns the values untouched for a schema with no root union", () => {
        const values = { message: "hi" };
        expect(decodeFormValues({ properties: { message: {} } }, values)).toBe(
          values,
        );
      });

      it("restores a const from the schema rather than trusting the form", () => {
        // ink-form has no immutable field, and a select hands back a string —
        // so the pinned value is re-applied on the way out, with its own type.
        expect(
          decodeFormValues(
            {
              type: "object",
              anyOf: [
                {
                  type: "object",
                  properties: { n: { const: 7 }, a: { type: "string" } },
                },
                { type: "object", properties: { n: { const: 8 } } },
              ],
            },
            { __variant: "0", __b0__n: "tampered", __b0__a: "x" },
          ),
        ).toEqual({ n: 7, a: "x" });
      });

      it("keeps a decoded argument named __proto__", () => {
        // Assigning it would invoke the legacy prototype setter, so a field
        // prefixed safely in the form would vanish on the way to the call.
        const schema = {
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { ["__proto__"]: { type: "string" } },
            },
            { type: "object", properties: { other: { type: "string" } } },
          ] as unknown[],
        };
        const decoded = decodeFormValues(schema, {
          __variant: "0",
          __b0____proto__: "kept",
        });
        expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
      });

      it("keeps a base argument whose name looks generated", () => {
        const schema = {
          type: "object",
          properties: { __b0__x: { type: "string" } },
          anyOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        };
        expect(
          decodeFormValues(schema, {
            __variant: "0",
            __b0__x: "mine",
            __b_0__a: "chosen",
          }),
        ).toEqual({ __b0__x: "mine", a: "chosen" });
      });
    });

    it("merges a root allOf into the parameters section", () => {
      const form = schemaToForm(
        {
          type: "object",
          properties: { a: { type: "string" } },
          allOf: [{ type: "object", properties: { b: { type: "boolean" } } }],
        },
        "allof_tool",
      );
      expect(form.sections).toHaveLength(1);
      expect(form.sections[0]!.fields.map((field) => field.name)).toEqual([
        "a",
        "b",
      ]);
    });

    it("still renders an empty form for a schema with no properties", () => {
      const form = schemaToForm({ type: "object" }, "empty_tool");
      expect(form.sections).toEqual([{ title: "Parameters", fields: [] }]);
    });
  });

  describe("edge shapes (#2123)", () => {
    it("renders a union that declares no root properties", () => {
      const form = schemaToForm(
        {
          type: "object",
          anyOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        },
        "no_base",
      );
      expect(form.sections[0]!.fields.map((f) => f.name)).toEqual([
        "__variant",
      ]);
      expect(form.sections[1]!.fields.map((f) => f.name)).toEqual(["__b0__a"]);
    });

    it("returns the values unchanged for a schema with no properties", () => {
      const values = { anything: "x" };
      expect(decodeFormValues({ type: "object" }, values)).toBe(values);
    });

    it("declines a union carrying a malformed property declaration", () => {
      // `properties` values are `unknown`; a `null` entry is not a schema, so
      // the union is declined — and, the point of the test, nothing throws on
      // the way out of the form any more than on the way in.
      const schema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { broken: null, kind: { const: "a" } },
          },
          { type: "object", properties: { kind: { const: "b" } } },
        ] as unknown[],
      };
      // No union, so the form values pass through as they are.
      expect(
        decodeFormValues(schema, { __variant: "0", __b0__kind: "tampered" }),
      ).toEqual({ __variant: "0", __b0__kind: "tampered" });
    });
  });

  describe("missingRequiredFields (#2123)", () => {
    const REQUIRED_UNION = {
      type: "object",
      oneOf: [
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

    it("reports what the chosen branch requires and the values omit", () => {
      // A branch's fields render optional — a static form cannot demand every
      // branch's — so the requirement is checked against the chosen shape here
      // rather than sending a call known to violate the schema.
      expect(
        missingRequiredFields(
          REQUIRED_UNION,
          { kind: "email" },
          { __variant: "0" },
        ),
      ).toEqual(["address"]);
    });

    it("reports nothing once the chosen branch is satisfied", () => {
      expect(
        missingRequiredFields(
          REQUIRED_UNION,
          { kind: "sms", phone: "555" },
          { __variant: "1" },
        ),
      ).toEqual([]);
    });

    it("does not mistake an inherited property for a supplied argument", () => {
      // `constructor` is a legal argument name; reading it off the prototype
      // would report it as present and send the call without it.
      const schema = {
        type: "object",
        properties: { constructor: { type: "string" } },
        required: ["constructor"],
      };
      expect(missingRequiredFields(schema, {})).toEqual(["constructor"]);
    });

    it("accepts null only where the schema admits it", () => {
      // Branch fields render optional, so a `default: null` on a non-nullable
      // required field reaches this check — and `type: "string"` rejects it.
      const strict = {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      };
      expect(missingRequiredFields(strict, { a: null })).toEqual(["a"]);

      const nullable = {
        type: "object",
        properties: { a: { type: ["string", "null"] } },
        required: ["a"],
      };
      expect(missingRequiredFields(nullable, { a: null })).toEqual([]);
    });

    it("accepts an empty string a const pins the field to", () => {
      // The one-option control cannot produce anything else, so reporting the
      // seeded value as missing would make the branch permanently uncallable.
      const pinnedEmpty = {
        type: "object",
        properties: { kind: { type: "string", const: "" } },
        required: ["kind"],
      };
      expect(missingRequiredFields(pinnedEmpty, { kind: "" })).toEqual([]);
      // An ordinary required string is still missing when left blank.
      const ordinary = {
        type: "object",
        properties: { kind: { type: "string" } },
        required: ["kind"],
      };
      expect(missingRequiredFields(ordinary, { kind: "" })).toEqual(["kind"]);
    });

    it("checks the root's own required fields when there is no union", () => {
      const schema = {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      };
      expect(missingRequiredFields(schema, {})).toEqual(["message"]);
      expect(missingRequiredFields(schema, { message: "hi" })).toEqual([]);
    });
  });
});
