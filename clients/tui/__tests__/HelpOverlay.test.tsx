import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import { Box } from "ink";

// ScrollView: a passthrough like the shared `inkScrollViewMock`, but with a
// spied `scrollBy`, so the scroll keys' deltas are asserted rather than merely
// exercised (the shared double's `scrollBy` is a no-op).
const scroll = vi.hoisted(() => ({ scrollBy: vi.fn(), viewportHeight: 7 }));
vi.mock("ink-scroll-view", async () => {
  const React = await import("react");
  const { Box } = await import("ink");
  const ScrollView = React.forwardRef<unknown, { children?: React.ReactNode }>(
    function ScrollView({ children }, ref) {
      React.useImperativeHandle(ref, () => ({
        scrollBy: scroll.scrollBy,
        scrollTo: () => {},
        getViewportHeight: () => scroll.viewportHeight,
      }));
      return React.createElement(Box, { flexDirection: "column" }, children);
    },
  );
  return { ScrollView };
});

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

  it("scrolls by a line or a viewport, without closing", async () => {
    scroll.scrollBy.mockClear();
    const onClose = vi.fn();
    const r = renderOverlay(onClose);
    await tick();
    for (const k of [DOWN, UP, PAGE_DOWN, PAGE_UP, "x"]) {
      r.stdin.write(k);
      await tick();
    }
    expect(scroll.scrollBy.mock.calls).toEqual([[1], [-1], [7], [-7]]);
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
