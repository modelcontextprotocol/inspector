import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "./helpers/renderTui";
import { ListFilterBar, filterCount } from "../src/components/ListFilterBar.js";

describe("ListFilterBar", () => {
  it("shows the query, a cursor and the ways out while editing", () => {
    const { lastFrame } = render(
      <ListFilterBar query="echo" editing focused />,
    );
    expect(lastFrame()).toContain("/echo");
    expect(lastFrame()).toContain("Enter keep · Esc clear");
  });

  it("shows a kept query and how to change it", () => {
    const { lastFrame } = render(
      <ListFilterBar query="echo" editing={false} focused={false} />,
    );
    expect(lastFrame()).toContain("/echo");
    expect(lastFrame()).toContain("(/ to edit)");
  });

  it("advertises '/' on a focused list with no query", () => {
    const { lastFrame } = render(
      <ListFilterBar query=" " editing={false} focused />,
    );
    expect(lastFrame()).toContain("/ to filter");
  });

  it("stays blank on an unfocused list with no query", () => {
    const { lastFrame } = render(
      <ListFilterBar query="" editing={false} focused={false} />,
    );
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});

describe("filterCount", () => {
  it("is the total alone when nothing is filtered", () => {
    expect(filterCount(false, 3, 3)).toBe("3");
  });

  it("is matches over total while a filter narrows the list", () => {
    expect(filterCount(true, 1, 3)).toBe("1/3");
  });
});
