import { useLayoutEffect, useRef } from "react";

// Scroll positions survive a screen unmount by living in this module-scope map
// rather than React state: the screens unmount on tab switch (#1417), so a
// component-local ref would be lost, and threading every scroll position up to
// App would balloon the prop surface for what is purely ephemeral DOM state.
// Keyed by a caller-supplied stable region id (e.g. "logs-stream").
const scrollPositions = new Map<string, { x: number; y: number }>();

/**
 * Forget all remembered scroll positions. App calls this on disconnect so a new
 * session's screens start at the top, matching the clear-on-disconnect rule the
 * lifted selection/filter state follows (#1417).
 */
export function clearScrollMemory(): void {
  scrollPositions.clear();
}

/**
 * Remember and restore a scroll container's position across unmount/remount.
 * Returns a ref to attach to a Mantine `ScrollArea`/`ScrollArea.Autosize` via
 * its `viewportRef` prop. On mount the saved offset (if any) is restored before
 * paint; on unmount the current offset is captured. The captured viewport node
 * is closed over so the offset is still readable during the cleanup phase.
 */
export function useScrollMemory(key: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const saved = scrollPositions.get(key);
    if (saved) {
      viewport.scrollTo({ left: saved.x, top: saved.y });
    }
    return () => {
      scrollPositions.set(key, {
        x: viewport.scrollLeft,
        y: viewport.scrollTop,
      });
    };
  }, [key]);
  return viewportRef;
}
