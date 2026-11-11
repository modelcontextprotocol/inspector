import { describe, it, expect } from "vitest";
import {
  appendToolRun,
  EMPTY_TOOL_RUN_HISTORY,
  formatDuration,
  runsForTool,
  toggleCompare,
  toolRunEnvelope,
  type NewToolRun,
  type ToolRun,
} from "./toolRunHistory";

const newRun = (toolName: string, n: number): NewToolRun => ({
  toolName,
  args: { n },
  startedAt: n,
  durationMs: n,
  status: "ok",
});

describe("runsForTool", () => {
  it("returns a stable empty list for an unknown or absent tool", () => {
    expect(runsForTool(EMPTY_TOOL_RUN_HISTORY, "x")).toBe(
      runsForTool(EMPTY_TOOL_RUN_HISTORY, undefined),
    );
    expect(runsForTool(EMPTY_TOOL_RUN_HISTORY, "x")).toEqual([]);
  });

  it("does not treat an inherited property as a tool", () => {
    expect(runsForTool(EMPTY_TOOL_RUN_HISTORY, "toString")).toEqual([]);
  });
});

describe("appendToolRun", () => {
  it("prepends, numbers per tool and leaves other tools alone", () => {
    let h = appendToolRun(EMPTY_TOOL_RUN_HISTORY, newRun("a", 1), "1");
    h = appendToolRun(h, newRun("b", 2), "2");
    h = appendToolRun(h, newRun("a", 3), "3");
    expect(runsForTool(h, "a").map((r) => [r.id, r.sequence])).toEqual([
      ["3", 2],
      ["1", 1],
    ]);
    expect(runsForTool(h, "b").map((r) => r.sequence)).toEqual([1]);
  });

  it("caps each tool's list, keeping the numbering", () => {
    let h = EMPTY_TOOL_RUN_HISTORY;
    for (let i = 1; i <= 4; i++)
      h = appendToolRun(h, newRun("a", i), `${i}`, 2);
    expect(runsForTool(h, "a").map((r) => r.sequence)).toEqual([4, 3]);
  });
});

describe("toolRunEnvelope", () => {
  const base: ToolRun = {
    id: "1",
    sequence: 1,
    toolName: "a",
    args: { n: 1 },
    startedAt: 0,
    durationMs: 9,
    status: "error",
  };

  it("pairs the arguments with the result", () => {
    const result = { content: [], isError: true };
    expect(toolRunEnvelope({ ...base, result })).toEqual({
      arguments: { n: 1 },
      result,
    });
  });

  it("carries a rejection's message, and its code when known", () => {
    expect(toolRunEnvelope({ ...base, error: "boom" })).toEqual({
      arguments: { n: 1 },
      error: { message: "boom" },
    });
    expect(toolRunEnvelope({ ...base, error: "boom", errorCode: -1 })).toEqual({
      arguments: { n: 1 },
      error: { code: -1, message: "boom" },
    });
  });
});

describe("formatDuration", () => {
  it("uses milliseconds under a second and seconds above", () => {
    expect(formatDuration(12.4)).toBe("12 ms");
    expect(formatDuration(1234)).toBe("1.23 s");
  });
});

describe("toggleCompare", () => {
  it("adds, removes, and swaps out the oldest past the limit", () => {
    expect(toggleCompare([], "a")).toEqual(["a"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleCompare(["a", "b"], "c")).toEqual(["b", "c"]);
  });
});
