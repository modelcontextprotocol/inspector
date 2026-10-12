import { describe, expect, it } from "vitest";
import { formatCountedLabel, formatListCount, listCountOf } from "./listCount";

describe("formatListCount", () => {
  it("renders a complete count as-is", () => {
    expect(formatListCount({ count: 15, partial: false })).toBe("15");
  });

  it("marks a partial count as a lower bound", () => {
    expect(formatListCount({ count: 10, partial: true })).toBe("10+");
  });
});

describe("formatCountedLabel", () => {
  it("appends the count in parentheses", () => {
    expect(formatCountedLabel("Tools", { count: 0, partial: false })).toBe(
      "Tools (0)",
    );
    expect(formatCountedLabel("Prompts", { count: 3, partial: true })).toBe(
      "Prompts (3+)",
    );
  });

  it("returns the bare label when there is no count", () => {
    expect(formatCountedLabel("Tools", undefined)).toBe("Tools");
  });
});

describe("listCountOf", () => {
  it("counts the loaded items and carries the more-pages flag", () => {
    expect(
      listCountOf({ items: [1, 2, 3], canLoadMore: true, error: null }),
    ).toEqual({ count: 3, partial: true });
  });

  it("has no count after a failed load", () => {
    expect(
      listCountOf({ items: [], canLoadMore: false, error: new Error("x") }),
    ).toBeUndefined();
  });
});
