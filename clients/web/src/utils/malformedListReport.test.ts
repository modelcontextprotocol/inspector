import { describe, it, expect } from "vitest";
import type { MalformedListItem } from "@inspector/core/mcp";
import { visibleMalformedListItems } from "./malformedListReport";

const entry = (method: string): MalformedListItem => ({
  method,
  index: 0,
  reason: "annotations: expected object",
});

const TOOLS = entry("tools/list");
const PROMPTS = entry("prompts/list");
const RESOURCES = entry("resources/list");
const TEMPLATES = entry("resources/templates/list");

describe("visibleMalformedListItems", () => {
  it("shows every report in aggregate mode", () => {
    const items = [TOOLS, PROMPTS, RESOURCES, TEMPLATES];
    expect(visibleMalformedListItems(items, false)).toEqual(items);
  });

  it("returns the same array in aggregate mode rather than a copy", () => {
    // Identity is load-bearing: the value feeds a memo, and a fresh array every
    // render would re-render the panels for a filter that removed nothing.
    const items = [TOOLS];
    expect(visibleMalformedListItems(items, false)).toBe(items);
  });

  it("suppresses the paged lists' reports in paginated mode", () => {
    // Those panels render the paged store, which neither writes nor clears this
    // report — so the entry would describe a list that is no longer on screen.
    expect(
      visibleMalformedListItems([TOOLS, PROMPTS, RESOURCES], true),
    ).toEqual([]);
  });

  it("keeps resource templates, which are aggregate-backed in both modes", () => {
    // Templates have no paged store, so their report always describes the list
    // actually being rendered.
    expect(
      visibleMalformedListItems([TOOLS, TEMPLATES, PROMPTS], true),
    ).toEqual([TEMPLATES]);
  });
});
