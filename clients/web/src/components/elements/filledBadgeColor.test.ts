import { describe, expect, it } from "vitest";
import { filledBadgeColor } from "./filledBadgeColor";

describe("filledBadgeColor", () => {
  it("pins amber fills to shade 5 so autoContrast picks black text", () => {
    expect(filledBadgeColor("yellow")).toBe("yellow.5");
    expect(filledBadgeColor("orange")).toBe("orange.5");
  });

  it("returns every other color unchanged", () => {
    for (const c of [
      "blue",
      "green",
      "red",
      "teal",
      "grape",
      "violet",
      "gray",
    ]) {
      expect(filledBadgeColor(c)).toBe(c);
    }
  });
});
