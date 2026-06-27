import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SelectableItem } from "../src/components/SelectableItem.js";

describe("SelectableItem", () => {
  it("shows the ▶ marker and label when selected", () => {
    const { lastFrame } = render(
      <SelectableItem isSelected>Tool A</SelectableItem>,
    );
    expect(lastFrame()).toContain("▶");
    expect(lastFrame()).toContain("Tool A");
  });

  it("omits the marker when not selected", () => {
    const { lastFrame } = render(
      <SelectableItem isSelected={false}>Tool B</SelectableItem>,
    );
    expect(lastFrame()).not.toContain("▶");
    expect(lastFrame()).toContain("Tool B");
  });

  it("renders bold and non-bold variants without error", () => {
    const bold = render(
      <SelectableItem isSelected bold>
        Bold
      </SelectableItem>,
    );
    expect(bold.lastFrame()).toContain("Bold");

    const plain = render(
      <SelectableItem isSelected={false}>Plain</SelectableItem>,
    );
    expect(plain.lastFrame()).toContain("Plain");
  });
});
