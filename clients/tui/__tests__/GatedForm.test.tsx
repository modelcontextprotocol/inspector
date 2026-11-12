import React from "react";
import { describe, it, expect, vi } from "vitest";
import type { FormStructure } from "ink-form";
import { render } from "./helpers/renderTui";
import { GatedForm, initialFormValues } from "../src/components/GatedForm.js";

// The real ink-form, not the double the modal suites use: what is under test
// is that its own key handlers and focusables go away while the form is gated,
// which the double (one Enter handler) cannot show (#2967).

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;

const FORM: FormStructure = {
  sections: [
    {
      title: "Args",
      fields: [
        { type: "string", name: "city", initialValue: "Oslo" },
        { type: "string", name: "note" },
      ],
    },
  ],
};

describe("initialFormValues", () => {
  it("collects each field's initialValue across sections, skipping undefined", () => {
    expect(
      initialFormValues({
        sections: [
          FORM.sections[0]!,
          {
            title: "More",
            fields: [{ type: "boolean", name: "flag", initialValue: false }],
          },
        ],
      }),
    ).toEqual({ city: "Oslo", flag: false });
  });
});

describe("GatedForm", () => {
  it("submits each field's default, as the uncontrolled form did", async () => {
    const onSubmit = vi.fn();
    const api = render(<GatedForm form={FORM} active onSubmit={onSubmit} />);
    await tick();
    // Past both fields to the submit button.
    for (const key of [DOWN, DOWN, DOWN, "\r"]) {
      api.stdin.write(key);
      await tick();
    }
    expect(onSubmit).toHaveBeenCalledWith({ city: "Oslo" });
    api.unmount();
  });

  it("ignores every key while inactive and keeps the draft for when it returns", async () => {
    const onSubmit = vi.fn();
    const api = render(<GatedForm form={FORM} active onSubmit={onSubmit} />);
    await tick();
    // Edit the first field: focus it, open it, type, commit.
    for (const key of [DOWN, "\r", "X", "\r"]) {
      api.stdin.write(key);
      await tick();
    }
    expect(api.lastFrame()).toContain("OsloX");

    api.rerender(<GatedForm form={FORM} active={false} onSubmit={onSubmit} />);
    await tick();
    expect(api.lastFrame()).toContain("Paused while a server request is open");
    expect(api.lastFrame()).not.toContain("city");
    // Keys meant for an overlay above: open a field, type, commit, submit.
    for (const key of [DOWN, "\r", "junk", "\r", DOWN, DOWN, "\r"]) {
      api.stdin.write(key);
      await tick();
    }
    expect(onSubmit).not.toHaveBeenCalled();

    api.rerender(<GatedForm form={FORM} active onSubmit={onSubmit} />);
    await tick();
    expect(api.lastFrame()).toContain("OsloX");
    expect(api.lastFrame()).not.toContain("junk");
    for (const key of [DOWN, DOWN, DOWN, "\r"]) {
      api.stdin.write(key);
      await tick();
    }
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ city: "OsloX" });
    api.unmount();
  });
});
