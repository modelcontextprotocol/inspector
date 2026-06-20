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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const form = uriTemplateToForm("file:///{unclosed", "broken");

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to parse URI template:",
      expect.any(Error),
    );
    expect(form.sections[0]!.fields).toEqual([]);
  });
});
