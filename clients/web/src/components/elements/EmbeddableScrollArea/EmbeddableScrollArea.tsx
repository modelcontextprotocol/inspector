import type { ReactNode, Ref } from "react";
import { ScrollArea, Stack } from "@mantine/core";

// Full-size, the monitor stream panels bound their scroll to the viewport
// minus the header and the panel's own chrome.
const FULLSIZE_MAH =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px) - 150px)";

export interface EmbeddableScrollAreaProps {
  /**
   * True when rendered inside the pinned monitoring sidebar (#1616): the scroll
   * region fills its flex parent instead of using the viewport calc. A
   * `flex:1 / mih:0` wrapper caps the inner `ScrollArea` at the space remaining
   * below the column's controls (via `mah:100%`), so no viewport math is needed
   * and the final rows never clip.
   */
  embedded: boolean;
  viewportRef: Ref<HTMLDivElement>;
  children: ReactNode;
  /**
   * Constrain the scrolled content to the viewport width instead of letting it
   * grow to its own `max-content`. Mantine's ScrollArea `content` slot defaults
   * to `min-width: max-content`, so a row with non-wrapping content (e.g. a long
   * network URL) stretches every card past the column and it bleeds out (#1623).
   * When true, the content can shrink to the viewport and each row must manage
   * its own overflow (the Network URL scrolls inside its own inner ScrollArea).
   * Left off for panels whose rows already wrap/truncate (Logs, Protocol), where
   * the default lets a long line scroll the list horizontally instead.
   */
  constrainContentWidth?: boolean;
}

// Relax the `content` slot's default `min-width: max-content` so the list can't
// grow wider than its viewport; see `constrainContentWidth`.
const CONSTRAIN_CONTENT_STYLES = { content: { minWidth: 0 } } as const;

/**
 * The scroll region shared by the Logs / Protocol / Network stream panels, which
 * render both full-size (their own tab) and embedded (the monitoring sidebar).
 * Centralizes the one layout difference between those two hosts.
 */
export function EmbeddableScrollArea({
  embedded,
  viewportRef,
  children,
  constrainContentWidth = false,
}: EmbeddableScrollAreaProps) {
  const styles = constrainContentWidth ? CONSTRAIN_CONTENT_STYLES : undefined;
  if (embedded) {
    return (
      <Stack flex={1} mih={0} gap={0}>
        <ScrollArea.Autosize
          viewportRef={viewportRef}
          mah="100%"
          type="scroll"
          offsetScrollbars
          styles={styles}
          viewportProps={{ tabIndex: 0 }}
        >
          {children}
        </ScrollArea.Autosize>
      </Stack>
    );
  }
  return (
    <ScrollArea.Autosize
      viewportRef={viewportRef}
      mah={FULLSIZE_MAH}
      type="scroll"
      offsetScrollbars
      styles={styles}
      viewportProps={{ tabIndex: 0 }}
    >
      {children}
    </ScrollArea.Autosize>
  );
}
