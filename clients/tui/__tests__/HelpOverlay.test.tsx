import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import { Box } from "ink";

// ScrollView: passthrough so the sections mount and the imperative ref API
// (scrollBy / getViewportHeight) exists for the scroll-key handlers.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { HelpOverlay } from "../src/components/HelpOverlay.js";
import { keybindingSections } from "../src/utils/keybindings.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write.
const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

/**
 * The overlay is `position="absolute"`, which a bare render does not lay out
 * into the frame; a sized parent gives it a box to draw into, as `App` does.
 */
function renderOverlay(onClose: () => void) {
  return render(
    <Box width={100} height={60}>
      <HelpOverlay
        sections={keybindingSections("tools")}
        width={100}
        height={60}
        onClose={onClose}
      />
    </Box>,
  );
}

describe("HelpOverlay", () => {
  it("lists the global and active-tab bindings", async () => {
    const r = renderOverlay(() => {});
    await tick();
    const frame = r.lastFrame() ?? "";
    expect(frame).toContain("Keyboard shortcuts");
    expect(frame).toContain("Global");
    expect(frame).toContain("Tools tab");
    expect(frame).toContain("Test the tool");
    expect(frame).toContain("Show or hide this help");
    r.unmount();
  });

  it("scrolls without closing on the arrow and page keys", async () => {
    const onClose = vi.fn();
    const r = renderOverlay(onClose);
    await tick();
    for (const k of [DOWN, UP, PAGE_DOWN, PAGE_UP, "x"]) {
      r.stdin.write(k);
      await tick();
    }
    expect(onClose).not.toHaveBeenCalled();
    r.unmount();
  });

  it("closes on '?'", async () => {
    const onClose = vi.fn();
    const r = renderOverlay(onClose);
    await tick();
    r.stdin.write("?");
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it("closes on ESC", async () => {
    const onClose = vi.fn();
    const r = renderOverlay(onClose);
    await tick();
    r.stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
