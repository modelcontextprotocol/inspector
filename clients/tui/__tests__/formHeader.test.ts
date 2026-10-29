import { describe, it, expect } from "vitest";
import { untitledForm } from "../src/utils/formHeader.js";
import { schemaToForm } from "../src/utils/schemaToForm.js";

describe("untitledForm (#2827)", () => {
  it("drops the title the modal header already shows, keeping the sections", () => {
    const form = schemaToForm(
      { type: "object", properties: { q: { type: "string" } } },
      "search",
    );
    expect(form.title).toBe("Test Tool: search");
    const body = untitledForm(form);
    expect(body.title).toBeUndefined();
    expect(body.sections).toBe(form.sections);
  });

  it("does not mutate the form the header reads", () => {
    const form = schemaToForm(null, "noParams");
    untitledForm(form);
    expect(form.title).toBe("Test Tool: noParams");
  });
});
