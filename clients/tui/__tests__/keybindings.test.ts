import { describe, it, expect } from "vitest";
import { tabs } from "../src/components/tabsConfig.js";
import {
  HELP_BINDINGS,
  TAB_BINDINGS,
  globalBindings,
  keyColumnWidth,
  keybindingSections,
} from "../src/utils/keybindings.js";

describe("keybindings", () => {
  it("documents every tab with at least one binding", () => {
    for (const tab of tabs) {
      expect(TAB_BINDINGS[tab.id].length).toBeGreaterThan(0);
    }
  });

  it("titles every tab's section with its tab-bar label", () => {
    for (const id of Object.keys(
      TAB_BINDINGS,
    ) as (keyof typeof TAB_BINDINGS)[]) {
      const label = tabs.find((tab) => tab.id === id)?.label;
      expect(label).toBeDefined();
      expect(keybindingSections(id)[1]!.title).toBe(`${label} tab`);
    }
  });

  it("lists every tab accelerator in the global section, from tabsConfig", () => {
    const accelerators = globalBindings().find((b) =>
      b.action.includes("underlined letter"),
    );
    expect(accelerators?.keys.split(" ")).toEqual(
      tabs.map((tab) => tab.accelerator),
    );
  });

  it("documents the help toggle itself", () => {
    expect(globalBindings().some((b) => b.keys === "?")).toBe(true);
    expect(HELP_BINDINGS.some((b) => b.keys.includes("Esc"))).toBe(true);
  });

  it("returns Global, the active tab's section by label, then the help section", () => {
    const sections = keybindingSections("messages");
    expect(sections.map((s) => s.title)).toEqual([
      "Global",
      "Protocol tab",
      "This help",
    ]);
    expect(sections[1]!.bindings).toBe(TAB_BINDINGS.messages);
  });

  it("measures the widest keys column across all sections", () => {
    expect(
      keyColumnWidth([
        { title: "a", bindings: [{ keys: "ab", action: "x" }] },
        {
          title: "b",
          bindings: [
            { keys: "abcd", action: "y" },
            { keys: "a", action: "z" },
          ],
        },
      ]),
    ).toBe(4);
    expect(keyColumnWidth([])).toBe(0);
  });
});
