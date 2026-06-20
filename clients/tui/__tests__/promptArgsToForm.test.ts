import { describe, it, expect } from "vitest";
import { promptArgsToForm } from "../src/utils/promptArgsToForm.js";

describe("promptArgsToForm", () => {
  it("returns an empty Parameters section when there are no arguments", () => {
    const form = promptArgsToForm([], "noArgs");
    expect(form.title).toBe("Get Prompt: noArgs");
    expect(form.sections).toEqual([{ title: "Parameters", fields: [] }]);
  });

  it("maps prompt arguments to required string fields by default", () => {
    const form = promptArgsToForm(
      [
        { name: "topic", description: "What to write about" },
        { name: "tone", required: false },
      ],
      "writer",
    );

    expect(form.sections[0]!.title).toBe("Prompt Arguments");
    const [topic, tone] = form.sections[0]!.fields;
    expect(topic).toMatchObject({
      name: "topic",
      type: "string",
      required: true,
      description: "What to write about",
    });
    // Only an explicit `required: false` makes a field optional.
    expect(tone).toMatchObject({ name: "tone", required: false });
  });
});
