import { expect } from "storybook/test";

/**
 * Assert a list `ScrollArea.Autosize` reserves a scrollbar gutter
 * (`offsetScrollbars`, so the bar never overlays the cards) and keeps the bar
 * hidden when idle (`type="scroll"`, so it shows only while scrolling rather
 * than on hover). Shared by the Protocol/Network/Logging panel stories (#1474).
 */
export async function expectScrollbarGutterIdleHidden(
  canvasElement: HTMLElement,
) {
  const viewport = canvasElement.querySelector(".mantine-ScrollArea-viewport");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("scroll viewport not found");
  }
  // offsetScrollbars reserves a non-zero inline-end gutter for the scrollbar.
  const pad = parseFloat(getComputedStyle(viewport).paddingInlineEnd);
  await expect(pad).toBeGreaterThan(0);
  // type="scroll" → scrollbars are mounted but hidden until the user scrolls.
  // Assert at least one exists first so the loop isn't trivially-true if a
  // future change stops rendering the scrollbar element.
  const scrollbars = canvasElement.querySelectorAll(
    ".mantine-ScrollArea-scrollbar",
  );
  await expect(scrollbars.length).toBeGreaterThan(0);
  for (const bar of scrollbars) {
    await expect(bar.getAttribute("data-state")).toBe("hidden");
  }
}

// Sub-pixel tolerance for layout comparisons: rects are fractional and the two
// edges are rounded independently, so an exact `<=` can fail on a fit.
const LAYOUT_EPSILON_PX = 1;

/**
 * Assert nothing in a list `ScrollArea` overflows its viewport horizontally:
 * the viewport does not scroll sideways, every row, card and button ends
 * inside it, and no button or badge label is cut short. Used by the monitoring-sidebar stories,
 * where a single long entry once widened the whole list and clipped every card
 * at the column's edge (#1623, #2675). It needs real layout, so it only means
 * anything in a browser — happy-dom reports zero for every rect.
 */
export async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const viewport = canvasElement.querySelector(".mantine-ScrollArea-viewport");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("scroll viewport not found");
  }
  await expect(viewport.scrollWidth).toBeLessThanOrEqual(
    viewport.clientWidth + LAYOUT_EPSILON_PX,
  );
  // The content's right edge is the viewport's minus its scrollbar gutter, so
  // measure against the viewport's content box rather than its border box.
  const box = viewport.getBoundingClientRect();
  const right =
    box.right - parseFloat(getComputedStyle(viewport).paddingInlineEnd);
  // The list's own rows (the children of its top-level Stack — a Logs or
  // Console line, a Protocol section) and every card nested anywhere in it.
  const rows = viewport.querySelectorAll(
    ".mantine-ScrollArea-content > * > *, .mantine-Card-root",
  );
  // Guard against a trivially-true loop if the list renders no rows at all.
  await expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    await expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(
      right + LAYOUT_EPSILON_PX,
    );
  }
  for (const button of viewport.querySelectorAll("button")) {
    const rect = button.getBoundingClientRect();
    // A button inside a collapsed section has no box; it can't clip.
    if (rect.width === 0) continue;
    await expect(rect.right).toBeLessThanOrEqual(right + LAYOUT_EPSILON_PX);
  }
  // A box that fits can still clip its own text: a squeezed button or badge
  // hides the overflow of its label. Every label must show all of its text.
  for (const label of viewport.querySelectorAll<HTMLElement>(
    ".mantine-Button-label, .mantine-Badge-label",
  )) {
    if (label.clientWidth === 0) continue;
    await expect(label.scrollWidth).toBeLessThanOrEqual(
      label.clientWidth + LAYOUT_EPSILON_PX,
    );
  }
}
