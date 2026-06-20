import { describe, it, expect } from "vitest";
import { schemaToForm } from "../src/utils/schemaToForm.js";

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

  it("builds a select field from an array-of-enum", () => {
    const form = schemaToForm(
      {
        properties: {
          // The array branch is nested under the outer `enum` guard, so a
          // top-level `enum` must also be present for it to be reached; the
          // options are taken from `items.enum`.
          tags: {
            type: "array",
            enum: ["a", "b"],
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

  it("carries a JSON Schema default through as the field's initialValue", () => {
    const form = schemaToForm(
      { properties: { greeting: { type: "string", default: "hi" } } },
      "withDefault",
    );
    expect(form.sections[0]!.fields[0]).toMatchObject({ initialValue: "hi" });
  });
});
