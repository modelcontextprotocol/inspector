import { describe, it, expect } from "vitest";
import {
  tabBarRows,
  tabs,
  visibleTabs,
  type TabType,
} from "../src/components/tabsConfig.js";

describe("tab accelerators", () => {
  it("are unique and appear in their own label", () => {
    const seen = new Set<string>();
    for (const tab of tabs) {
      expect(tab.label.toLowerCase()).toContain(tab.accelerator);
      expect(seen.has(tab.accelerator)).toBe(false);
      seen.add(tab.accelerator);
    }
  });
});

describe("visibleTabs", () => {
  it("drops every optional tab when nothing is supported", () => {
    const ids = visibleTabs({
      showAuth: false,
      showLogging: false,
      showRequests: false,
      showSkills: false,
    }).map((t) => t.id);
    expect(ids).not.toContain("auth");
    expect(ids).not.toContain("logging");
    expect(ids).not.toContain("requests");
    expect(ids).not.toContain("skills");
    // The unconditional ones remain.
    expect(ids).toContain("info");
    expect(ids).toContain("tools");
  });

  it("keeps each optional tab when its flag is set", () => {
    const ids = visibleTabs({
      showAuth: true,
      showLogging: true,
      showRequests: true,
      showSkills: true,
    }).map((t) => t.id);
    expect(ids).toEqual(tabs.map((t) => t.id));
  });
});

describe("tabBarRows (#2248)", () => {
  /** A stdio, OAuth-capable, Skills-serving server: the widest ordinary bar. */
  const stdioSkills = visibleTabs({
    showAuth: true,
    showLogging: true,
    showRequests: false,
    showSkills: true,
  });
  const counts: Partial<Record<TabType, number>> = {
    resources: 0,
    prompts: 0,
    skills: 8,
    tools: 1,
    messages: 11,
    logging: 3,
  };

  it("wraps that bar at 80 columns", () => {
    // The regression this exists for: adding Skills pushed the bar past a
    // default terminal, while `App` assumed one row and sized every pane below
    // it one row too tall.
    expect(tabBarRows(stdioSkills, counts, 80)).toBeGreaterThan(1);
  });

  it("needs only one row when the bar fits", () => {
    expect(tabBarRows(stdioSkills, counts, 400)).toBe(1);
  });

  it("never reports fewer rows as the terminal narrows", () => {
    // Monotonicity is the property that matters: a narrower terminal can only
    // need the same number of rows or more, so a pane sized from this can
    // never grow into the bar.
    let previous = 1;
    for (const width of [400, 200, 132, 100, 80, 60, 40, 20]) {
      const rows = tabBarRows(stdioSkills, counts, width);
      expect(rows).toBeGreaterThanOrEqual(previous);
      previous = rows;
    }
  });

  it("gives a tab wider than the row its own row rather than looping", () => {
    expect(tabBarRows(stdioSkills, counts, 1)).toBe(stdioSkills.length);
  });

  it("counts the count suffixes, which are what tip it over", () => {
    const withCounts = tabBarRows(stdioSkills, counts, 100);
    const without = tabBarRows(stdioSkills, {}, 100);
    expect(withCounts).toBeGreaterThanOrEqual(without);
  });

  it("returns one row for an empty bar", () => {
    expect(tabBarRows([], {}, 80)).toBe(1);
  });
});
