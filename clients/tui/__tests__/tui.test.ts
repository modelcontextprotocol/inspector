import { describe, it, expect } from "vitest";
import { tabs } from "../src/components/tabsConfig.js";
import { splitLabelAtAccelerator } from "../src/components/Tabs.js";

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

  it("uses web-aligned monitor tab labels with unique in-label accelerators", () => {
    expect(tabs.find((t) => t.id === "messages")).toMatchObject({
      label: "Protocol",
      accelerator: "p",
    });
    expect(tabs.find((t) => t.id === "requests")).toMatchObject({
      label: "Network",
      accelerator: "n",
    });
    expect(tabs.find((t) => t.id === "logging")).toMatchObject({
      label: "Console",
      accelerator: "o",
    });
    expect(tabs.find((t) => t.id === "prompts")).toMatchObject({
      label: "Prompts",
      accelerator: "m",
    });

    const accelerators = tabs.map((t) => t.accelerator);
    expect(new Set(accelerators).size).toBe(accelerators.length);
    for (const tab of tabs) {
      expect(tab.label.toLowerCase()).toContain(tab.accelerator.toLowerCase());
    }
  });

  it("splits labels so the accelerator letter can be underlined mid-word", () => {
    expect(splitLabelAtAccelerator("Prompts", "m")).toEqual({
      before: "Pro",
      accel: "m",
      after: "pts",
    });
    expect(splitLabelAtAccelerator("Console", "o")).toEqual({
      before: "C",
      accel: "o",
      after: "nsole",
    });
    expect(splitLabelAtAccelerator("Protocol", "p")).toEqual({
      before: "",
      accel: "P",
      after: "rotocol",
    });
    expect(splitLabelAtAccelerator("Info", "z")).toEqual({
      before: "",
      accel: "I",
      after: "nfo",
    });
  });
});
