import { describe, it, expect } from "vitest";
import {
  boundsHint,
  selectionLabel,
  toggleChoice,
  windowStart,
} from "../src/utils/multiSelectField.js";

const OPTIONS = [
  { label: "Alpha", value: "a" },
  { value: "b" },
  { label: "Gamma", value: "c" },
];

describe("toggleChoice", () => {
  it("adds a value, keeping option order", () => {
    expect(toggleChoice(["c"], "a", OPTIONS)).toEqual(["a", "c"]);
  });

  it("removes a selected value", () => {
    expect(toggleChoice(["a", "c"], "a", OPTIONS)).toEqual(["c"]);
  });
});

describe("boundsHint", () => {
  it("describes each combination of bounds", () => {
    expect(boundsHint(undefined, undefined)).toBeUndefined();
    expect(boundsHint(2, undefined)).toBe("Choose at least 2");
    expect(boundsHint(undefined, 3)).toBe("Choose at most 3");
    expect(boundsHint(1, 3)).toBe("Choose 1 to 3");
    expect(boundsHint(2, 2)).toBe("Choose exactly 2");
  });
});

describe("selectionLabel", () => {
  it("joins the chosen labels, falling back to the value", () => {
    expect(selectionLabel(OPTIONS, ["a", "b", "zz"])).toBe("Alpha, b, zz");
  });

  it("distinguishes an unset field from an empty selection", () => {
    expect(selectionLabel(OPTIONS, undefined)).toBe("No value");
    expect(selectionLabel(OPTIONS, [])).toBe("None selected");
  });
});

describe("windowStart", () => {
  it("shows everything when the list fits", () => {
    expect(windowStart(3, 5, 8)).toBe(0);
  });

  it("centres the cursor, clamped to both ends", () => {
    expect(windowStart(1, 20, 8)).toBe(0);
    expect(windowStart(10, 20, 8)).toBe(6);
    expect(windowStart(19, 20, 8)).toBe(12);
  });
});
