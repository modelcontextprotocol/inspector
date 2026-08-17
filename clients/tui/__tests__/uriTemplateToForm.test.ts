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
    expect(fields[0]).toMatchObject({ type: "string", required: false });
  });

  it("returns an empty Template Variables section for a static URI", () => {
    const form = uriTemplateToForm("file:///static", "static");
    expect(form.sections[0]).toEqual({
      title: "Template Variables",
      fields: [],
    });
  });

  it("logs and returns an empty form when the template cannot be parsed", () => {
    // The shared core/uri helper warns and yields no names; this file no longer
    // does its own try/catch, so the assertion is on that warning (#1919).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const form = uriTemplateToForm("file:///{unclosed", "broken");

    expect(warnSpy).toHaveBeenCalled();
    expect(form.sections[0]!.fields).toEqual([]);
  });

  // Shared with the web panel's field list: the old scan saw only bare
  // `{name}` expressions, and a repeated name produced two identical fields.
  it("creates a field for a variable inside a query expression", () => {
    const form = uriTemplateToForm("foobar://events{?topic}", "events");
    expect(form.sections[0]!.fields.map((f) => f.name)).toEqual(["topic"]);
  });

  it("creates one field for a name repeated across expressions", () => {
    const form = uriTemplateToForm("x://{a}/{b}/{a}", "repeat");
    expect(form.sections[0]!.fields.map((f) => f.name)).toEqual(["a", "b"]);
  });
});
