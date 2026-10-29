import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import {
  compareToolLabels,
  compareToolsByLabel,
  compareToolsByName,
} from "@inspector/core/mcp/toolOrder.js";

const tool = (name: string, title?: string): Tool => ({
  name,
  ...(title !== undefined && { title }),
  inputSchema: { type: "object" },
});

const names = (tools: Tool[]) => tools.map((t) => t.name);

describe("toolOrder (#2827)", () => {
  it("compares labels case-insensitively with numeric digit runs", () => {
    expect(
      ["tool_10", "Git", "tool_2", "alpha", "git"].sort(compareToolLabels),
    ).toEqual(["alpha", "Git", "git", "tool_2", "tool_10"]);
  });

  it("sorts by title when present, else name (the web row label)", () => {
    const tools = [tool("b"), tool("z", "Apple"), tool("a")];
    expect(names([...tools].sort(compareToolsByLabel))).toEqual([
      "a",
      "z",
      "b",
    ]);
  });

  it("sorts by bare name, ignoring title (the TUI row label)", () => {
    const tools = [tool("b"), tool("z", "Apple"), tool("a")];
    expect(names([...tools].sort(compareToolsByName))).toEqual(["a", "b", "z"]);
  });

  it("agrees across both comparators for tools without titles", () => {
    const tools = [tool("tool_10"), tool("Beta"), tool("tool_2"), tool("zeta")];
    expect(names([...tools].sort(compareToolsByLabel))).toEqual(
      names([...tools].sort(compareToolsByName)),
    );
  });
});
