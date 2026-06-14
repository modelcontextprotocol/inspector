import { expect } from "storybook/test";

/**
 * Assert a list `ScrollArea.Autosize` reserves a scrollbar gutter
 * (`offsetScrollbars`, so the bar never overlays the cards) and keeps the bar
 * hidden when idle (`type="scroll"`, so it shows only while scrolling rather
 * than on hover). Shared by the History/Network/Logging panel stories (#1474).
 */
export function expectScrollbarGutterIdleHidden(canvasElement: HTMLElement) {
  const viewport = canvasElement.querySelector(".mantine-ScrollArea-viewport");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("scroll viewport not found");
  }
  // offsetScrollbars reserves a non-zero inline-end gutter for the scrollbar.
  const pad = parseFloat(getComputedStyle(viewport).paddingInlineEnd);
  expect(pad).toBeGreaterThan(0);
  // type="scroll" → scrollbars are hidden until the user scrolls.
  const scrollbars = canvasElement.querySelectorAll(
    ".mantine-ScrollArea-scrollbar",
  );
  for (const bar of scrollbars) {
    expect(bar.getAttribute("data-state")).toBe("hidden");
  }
}
