import { describe, it, expect } from "vitest";
import { tabs } from "../src/components/Tabs.js";

describe("TUI", () => {
  it("exports tabs with expected shape", () => {
    expect(Array.isArray(tabs)).toBe(true);
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      expect(tab).toHaveProperty("id");
      expect(tab).toHaveProperty("label");
      expect(tab).toHaveProperty("accelerator");
    }
  });

  it("includes info tab", () => {
    const info = tabs.find((t) => t.id === "info");
    expect(info).toBeDefined();
    expect(info?.label).toBe("Info");
    expect(info?.accelerator).toBe("i");
  });
});
