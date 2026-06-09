import { describe, it, expect } from "vitest";
import { reorderIds } from "./reorderIds";

describe("reorderIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an item forward (drop onto a later id)", () => {
    expect(reorderIds(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward (drop onto an earlier id)", () => {
    expect(reorderIds(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves to the very front", () => {
    expect(reorderIds(ids, "c", "a")).toEqual(["c", "a", "b", "d"]);
  });

  it("moves to the very end", () => {
    expect(reorderIds(ids, "a", "d")).toEqual(["b", "c", "d", "a"]);
  });

  it("returns the same array reference when active === over", () => {
    expect(reorderIds(ids, "b", "b")).toBe(ids);
  });

  it("returns the same array reference when active id is missing", () => {
    expect(reorderIds(ids, "x", "b")).toBe(ids);
  });

  it("returns the same array reference when over id is missing", () => {
    expect(reorderIds(ids, "a", "x")).toBe(ids);
  });

  it("preserves the full id set (no drops or duplicates)", () => {
    const out = reorderIds(ids, "a", "d");
    expect([...out].sort()).toEqual([...ids].sort());
    expect(out.length).toBe(ids.length);
  });
});
