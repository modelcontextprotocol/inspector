import { describe, it, expect, vi, afterEach } from "vitest";
import { uriTemplateToForm } from "../src/utils/uriTemplateToForm.js";

describe("uriTemplateToForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a field for each template variable", () => {
    const form = uriTemplateToForm("file:///{path}/{name}", "file");
    expect(form.title).toBe("Read Resource: file");
    const fields = form.sections[0]!.fields;
    expect(fields.map((f) => f.name)).toEqual(["path", "name"]);
    // Simple `{path}` sits mid-URI, so omitting it would leave an empty path
    // segment rather than a shorter URI -- it is mandatory, matching the web
    // panel. Both clients read this from core's `requiredGroups`.
    expect(fields[0]).toMatchObject({ type: "string", required: true });
  });

  it("names fields as the expander looks them up, not as the SDK parses them", () => {
    // The SDK reports these as ";id" and "id:3"; submitting under those keys
    // would make the expander find nothing and drop the expression (#1919).
    expect(
      uriTemplateToForm("x://a{;id}", "matrix").sections[0]!.fields.map(
        (f) => f.name,
      ),
    ).toEqual(["id"]);
    expect(
      uriTemplateToForm("x://a/{id:3}", "prefix").sections[0]!.fields.map(
        (f) => f.name,
      ),
    ).toEqual(["id"]);
  });

  it("leaves a shared required group optional rather than demanding every name", () => {
    // `{a,b}` is satisfied by either name, and ink-form cannot say "any one
    // of"; marking both required would refuse input the expander accepts.
    const fields = uriTemplateToForm("x://{a,b}", "pair").sections[0]!.fields;
    expect(fields.map((f) => f.name)).toEqual(["a", "b"]);
    expect(fields.every((f) => f.required === false)).toBe(true);
  });

  it("marks an omittable variable optional", () => {
    const fields = uriTemplateToForm("x://a{?topic}", "q").sections[0]!.fields;
    expect(fields[0]).toMatchObject({ name: "topic", required: false });
  });

  it("returns an empty Template Variables section for a static URI", () => {
    const form = uriTemplateToForm("file:///static", "static");
    expect(form.sections[0]).toEqual({
      title: "Template Variables",
      fields: [],
    });
  });

  it("logs and returns an empty form when the template cannot be parsed", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const form = uriTemplateToForm("file:///{unclosed", "broken");

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to parse URI template:",
      expect.any(Error),
    );
    expect(form.sections[0]!.fields).toEqual([]);
  });
});

describe("a name repeated inside one expression", () => {
  it("is required, not treated as a shared group", () => {
    // `{a,a}` is one requirement named twice. Before core deduplicated the
    // group, `requiredGroups` returned ["a","a"], so this form's
    // `length === 1` test left the field optional while ResourceTestModal's
    // submit guard still refused a blank -- an un-submittable form.
    const [field] = uriTemplateToForm("x://{a,a}", "T").sections[0].fields;
    expect(field.name).toBe("a");
    expect(field.required).toBe(true);
  });
});
