import type { ReactNode, Ref } from "react";
import { ScrollArea, Stack } from "@mantine/core";

// Full-size, the monitor stream panels bound their scroll to the viewport
// minus the header and the panel's own chrome.
const FULLSIZE_MAH =
  "calc(100vh - var(--app-shell-header-height, 0px) - 150px)";

export interface EmbeddableScrollAreaProps {
  /**
   * True when rendered inside the pinned monitoring column (#1616): the scroll
   * region fills its flex parent instead of using the viewport calc. A
   * `flex:1 / mih:0` wrapper caps the inner `ScrollArea` at the space remaining
   * below the column's controls (via `mah:100%`), so no viewport math is needed
   * and the final rows never clip.
   */
  embedded: boolean;
  viewportRef: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * The scroll region shared by the Logs / History / Network stream panels, which
 * render both full-size (their own tab) and embedded (the monitoring column).
 * Centralizes the one layout difference between those two hosts.
 */
export function EmbeddableScrollArea({
  embedded,
  viewportRef,
  children,
}: EmbeddableScrollAreaProps) {
  if (embedded) {
    return (
      <Stack flex={1} mih={0} gap={0}>
        <ScrollArea.Autosize
          viewportRef={viewportRef}
          mah="100%"
          type="scroll"
          offsetScrollbars
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
    >
      {children}
    </ScrollArea.Autosize>
  );
}
