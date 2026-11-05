import React from "react";
import { describe, it, expect, vi } from "vitest";
import { Form, type FormStructure } from "ink-form";
import { render } from "./helpers/renderTui";
import {
  FORM_FIELD_MANAGERS,
  MultiSelectInput,
  VISIBLE_OPTIONS,
  multiSelectFieldManager,
} from "../src/components/MultiSelectField.js";
import { schemaToForm } from "../src/utils/schemaToForm.js";
import type { FormFieldMultiSelect } from "../src/utils/multiSelectField.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;

const press = async (stdin: { write: (s: string) => void }, key: string) => {
  stdin.write(key);
  await tick();
};

const field = (
  over: Partial<FormFieldMultiSelect> = {},
): FormFieldMultiSelect => ({
  type: "multiselect",
  name: "tags",
  options: [
    { label: "Alpha", value: "a" },
    { label: "Beta", value: "b" },
    { value: "c" },
  ],
  ...over,
});

describe("MultiSelectInput", () => {
  it("moves the cursor and toggles the highlighted option", async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame, rerender, unmount } = render(
      <MultiSelectInput field={field()} onChange={onChange} />,
    );
    await tick();
    expect(lastFrame()).toContain("❯ [ ] Alpha");
    expect(lastFrame()).toContain("(0 selected)");
    // Up at the top stays put; Space toggles the first option.
    await press(stdin, UP);
    await press(stdin, " ");
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
    // Down twice (and once more past the end) lands on the last option.
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    rerender(
      <MultiSelectInput
        field={field({ minItems: 2 })}
        value={["a"]}
        onChange={onChange}
      />,
    );
    await tick();
    await press(stdin, " ");
    expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
    expect(lastFrame()).toContain("  [x] Alpha");
    expect(lastFrame()).toContain("❯ [ ] c");
    expect(lastFrame()).toContain("(1 selected). Choose at least 2");
    // Other keys do nothing.
    await press(stdin, "q");
    expect(onChange).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does nothing on Space when there are no options", async () => {
    const onChange = vi.fn();
    const { stdin, unmount } = render(
      <MultiSelectInput field={field({ options: [] })} onChange={onChange} />,
    );
    await tick();
    await press(stdin, " ");
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  it("scrolls a list longer than the visible window", async () => {
    const options = Array.from({ length: VISIBLE_OPTIONS + 4 }, (_, i) => ({
      value: `opt${i}`,
    }));
    const { stdin, lastFrame, unmount } = render(
      <MultiSelectInput field={field({ options })} onChange={vi.fn()} />,
    );
    await tick();
    expect(lastFrame()).toContain(`1-${VISIBLE_OPTIONS} of ${options.length}`);
    expect(lastFrame()).not.toContain(`opt${VISIBLE_OPTIONS}`);
    for (let i = 0; i < options.length; i++) await press(stdin, DOWN);
    expect(lastFrame()).toContain(`❯ [ ] opt${options.length - 1}`);
    expect(lastFrame()).not.toContain("opt0\n");
    expect(lastFrame()).toContain(`5-${options.length} of ${options.length}`);
    unmount();
  });
});

describe("multiSelectFieldManager", () => {
  it("renders nothing for a field of another type", () => {
    const other = { type: "string" as const, name: "x" };
    const form: FormStructure = { sections: [] };
    expect(
      multiSelectFieldManager.renderField({
        field: other,
        form,
        onChange: vi.fn(),
        onSetEditingField: vi.fn(),
        onError: vi.fn(),
        onClearError: vi.fn(),
        onSave: vi.fn(),
        onCancel: vi.fn(),
      }),
    ).toBeNull();
    expect(multiSelectFieldManager.renderValue({ field: other })).toBeNull();
  });
});

describe("multi-select in a real ink-form Form (#2904)", () => {
  it("edits, saves and submits several values", async () => {
    const form: FormStructure = schemaToForm(
      {
        properties: {
          tags: {
            type: "array",
            items: {
              enum: ["a", "b", "c"],
              enumNames: ["Alpha", "Beta", "Gamma"],
            },
          },
        },
      },
      "multi",
    );
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Form
        form={form}
        customManagers={FORM_FIELD_MANAGERS}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    expect(lastFrame()).toContain("tags: No value");
    // Focus the field, open it, choose Alpha and Gamma, save.
    await press(stdin, "\t");
    await press(stdin, "\r");
    expect(lastFrame()).toContain("Space to toggle");
    await press(stdin, " ");
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, " ");
    await press(stdin, "\r");
    expect(lastFrame()).toContain("tags: Alpha, Gamma");
    // Move to Submit and press it.
    await press(stdin, "\t");
    await press(stdin, "\r");
    // The form holds option ids (enum indices); `decodeFormValues` maps them
    // back to the members.
    expect(onSubmit).toHaveBeenCalledWith({ tags: ["0", "2"] });
    unmount();
  });
});
