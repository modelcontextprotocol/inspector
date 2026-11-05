import { describe, it, expect } from "vitest";
import { canonicalJson, diffLines } from "./lineDiff";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      JSON.stringify({ a: { c: null, d: [2, 1] }, b: 1 }, null, 2),
    );
  });

  it("keeps a `__proto__` key as data", () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"x": 1}, "a": 2}');
    expect(canonicalJson(parsed)).toContain('"__proto__"');
    expect(canonicalJson(parsed)).not.toBe(
      canonicalJson(JSON.parse('{"__proto__": {"x": 2}, "a": 2}')),
    );
  });

  it("renders primitives as JSON", () => {
    expect(canonicalJson("x")).toBe('"x"');
  });
});

describe("diffLines", () => {
  it("marks every line the same for identical input", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("reports a changed middle line as removed then added", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("keeps common lines inside the changed region", () => {
    expect(diffLines("1\na\nb\n2", "1\nb\na\n2")).toEqual([
      { kind: "same", text: "1" },
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
      { kind: "added", text: "a" },
      { kind: "same", text: "2" },
    ]);
  });

  it("handles pure insertions and deletions", () => {
    expect(diffLines("a", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
      { kind: "added", text: "c" },
    ]);
    expect(diffLines("a\nb\nc", "c")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("drains a removal tail left over once the other side is exhausted", () => {
    expect(diffLines("x\ny\nz", "q\nx")).toEqual([
      { kind: "added", text: "q" },
      { kind: "same", text: "x" },
      { kind: "removed", text: "y" },
      { kind: "removed", text: "z" },
    ]);
  });

  it("returns null when the changed region exceeds the cell budget", () => {
    expect(diffLines("a\nb\nc", "x\ny\nz", 8)).toBeNull();
    expect(diffLines("a\nb\nc", "x\ny\nz", 9)).not.toBeNull();
  });
});
