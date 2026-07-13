import { describe, expect, it } from "vitest";
import { accessibleTextColor } from "./accessibleTextColor";

describe("accessibleTextColor", () => {
  it("maps a color name to its scheme-aware -light-color variable", () => {
    expect(accessibleTextColor("yellow")).toBe(
      "var(--mantine-color-yellow-light-color)",
    );
    expect(accessibleTextColor("red")).toBe(
      "var(--mantine-color-red-light-color)",
    );
  });

  it("passes dimmed through unchanged (already AA-tuned)", () => {
    expect(accessibleTextColor("dimmed")).toBe("dimmed");
  });

  it("passes undefined through (inherit default text color)", () => {
    expect(accessibleTextColor(undefined)).toBeUndefined();
  });
});
