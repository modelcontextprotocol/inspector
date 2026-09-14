import { describe, expect, it } from "vitest";
import { act } from "react";
import { renderWithMantine } from "../test/renderWithMantine";
import { EMPTY_TOOLS_UI } from "../components/screens/screenUiState";
import { INSPECTOR_SERVERS_TAB } from "../utils/inspectorTabs";
import { useTabUiState, type TabUiStateResult } from "./useTabUiState";

function harness() {
  let latest: TabUiStateResult | undefined;
  let renders = 0;
  function Probe() {
    latest = useTabUiState();
    renders += 1;
    return null;
  }
  renderWithMantine(<Probe />);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    renders: () => renders,
    run: (fn: (api: TabUiStateResult) => void) => {
      act(() => {
        if (!latest) throw new Error("hook did not render");
        fn(latest);
      });
    },
  };
}

describe("useTabUiState", () => {
  it("starts every screen empty, on the Servers tab, with no pins", () => {
    const h = harness();
    expect(h.api().ui.toolsUi).toEqual(EMPTY_TOOLS_UI);
    expect(h.api().activeTab).toBe(INSPECTOR_SERVERS_TAB);
    expect(h.api().pinnedProtocolIds.size).toBe(0);
  });

  it("updates one screen's ui without disturbing the others", () => {
    const h = harness();
    const promptsBefore = h.api().ui.promptsUi;
    h.run((api) => api.setUi.setToolsUi({ ...EMPTY_TOOLS_UI, search: "echo" }));
    expect(h.api().ui.toolsUi.search).toBe("echo");
    expect(h.api().ui.promptsUi).toBe(promptsBefore);
  });

  it("keeps the setter object identity stable across renders", () => {
    const h = harness();
    const before = h.api().setUi;
    h.run((api) => api.setActiveTab("Tools"));
    expect(h.renders()).toBeGreaterThan(1);
    expect(h.api().setUi).toBe(before);
  });

  it("toggles a protocol pin on and back off", () => {
    const h = harness();
    h.run((api) => api.togglePinProtocol("m1"));
    expect([...h.api().pinnedProtocolIds]).toEqual(["m1"]);
    h.run((api) => api.togglePinProtocol("m2"));
    expect([...h.api().pinnedProtocolIds].sort()).toEqual(["m1", "m2"]);
    h.run((api) => api.togglePinProtocol("m1"));
    expect([...h.api().pinnedProtocolIds]).toEqual(["m2"]);
  });

  it("replaces the pin set wholesale via setPinnedProtocolIds", () => {
    const h = harness();
    h.run((api) => api.setPinnedProtocolIds(new Set(["a", "b"])));
    expect([...h.api().pinnedProtocolIds].sort()).toEqual(["a", "b"]);
  });

  it("resets every screen and the pins, but leaves the active tab alone", () => {
    const h = harness();
    h.run((api) => {
      api.setUi.setToolsUi({ ...EMPTY_TOOLS_UI, search: "echo" });
      api.setUi.setConsoleUi({ filterText: "boom" });
      api.togglePinProtocol("m1");
      api.setActiveTab("Tools");
    });
    expect(h.api().ui.consoleUi.filterText).toBe("boom");

    h.run((api) => api.resetTabUiState());
    expect(h.api().ui.toolsUi).toEqual(EMPTY_TOOLS_UI);
    expect(h.api().ui.consoleUi.filterText).toBe("");
    expect(h.api().pinnedProtocolIds.size).toBe(0);
    // The tab the user is on is shell state, reset only on explicit disconnect.
    expect(h.api().activeTab).toBe("Tools");
  });

  it("keeps its callbacks stable, so naming them in a dependency array costs no churn", () => {
    const h = harness();
    // Captured BEFORE the update: comparing the post-render values to each
    // other would hold however the identities changed.
    const resetBefore = h.api().resetTabUiState;
    const toggleBefore = h.api().togglePinProtocol;
    const setPinsBefore = h.api().setPinnedProtocolIds;
    const setTabBefore = h.api().setActiveTab;

    h.run((api) => api.setActiveTab("Logs"));
    h.run((api) => api.togglePinProtocol("m1"));

    expect(h.renders()).toBeGreaterThan(1);
    expect(h.api().resetTabUiState).toBe(resetBefore);
    expect(h.api().togglePinProtocol).toBe(toggleBefore);
    expect(h.api().setPinnedProtocolIds).toBe(setPinsBefore);
    expect(h.api().setActiveTab).toBe(setTabBefore);
  });
});
