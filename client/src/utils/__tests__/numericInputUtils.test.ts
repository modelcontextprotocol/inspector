import { shouldDeferNumericCommit } from "../numericInputUtils";

describe("shouldDeferNumericCommit", () => {
  it("defers partial decimal input", () => {
    expect(shouldDeferNumericCommit("1.")).toBe(true);
    expect(shouldDeferNumericCommit("-74.")).toBe(true);
  });

  it("defers trailing-zero decimals", () => {
    expect(shouldDeferNumericCommit("1.0")).toBe(true);
    expect(shouldDeferNumericCommit("-74.0")).toBe(true);
    expect(shouldDeferNumericCommit("10.50")).toBe(true);
  });

  it("commits complete non-zero-ending decimals", () => {
    expect(shouldDeferNumericCommit("98.6")).toBe(false);
    expect(shouldDeferNumericCommit("10.5")).toBe(false);
  });
});
