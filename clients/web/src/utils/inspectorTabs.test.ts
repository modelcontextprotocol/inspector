import { describe, it, expect } from "vitest";
import {
  INSPECTOR_SERVERS_TAB,
  INSPECTOR_TAB_IDS,
  isInspectorTabId,
} from "./inspectorTabs";

describe("inspectorTabs", () => {
  it("names the Servers tab, which is not a liftable inspector tab", () => {
    expect(INSPECTOR_SERVERS_TAB).toBe("Servers");
    expect(INSPECTOR_TAB_IDS).not.toContain(INSPECTOR_SERVERS_TAB);
  });

  it("enumerates the liftable inspector tabs", () => {
    expect(INSPECTOR_TAB_IDS).toEqual([
      "Apps",
      "Tools",
      "Prompts",
      "Resources",
      "Tasks",
      "Logs",
      "History",
      "Network",
    ]);
  });

  it("isInspectorTabId returns true for every enumerated tab", () => {
    for (const tab of INSPECTOR_TAB_IDS) {
      expect(isInspectorTabId(tab)).toBe(true);
    }
  });

  it("isInspectorTabId returns false for non-inspector tab values", () => {
    expect(isInspectorTabId(INSPECTOR_SERVERS_TAB)).toBe(false);
    expect(isInspectorTabId("")).toBe(false);
    expect(isInspectorTabId("Bogus")).toBe(false);
  });
});
