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
});
