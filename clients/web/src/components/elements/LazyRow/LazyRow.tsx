import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Box } from "@mantine/core";
import { LazyMountContext } from "../../../hooks/useLazyMountRegistry";
import { KeepRowMountedContext } from "../../../hooks/useKeepRowMounted";
import { useValueChange } from "../../../hooks/useValueChange";
import type { LazyMountReport } from "../../../lib/lazyMountRegistry";

export interface LazyRowProps {
  /** The real row, rendered while it is near the viewport. */
  children: ReactNode;
  /**
   * Height of the stand-in, in px, for a row that has never been measured. An
   * estimate: it only has to be close enough that the scrollbar does not jump
   * much when the real row first replaces it. Once a row has rendered, its
   * stand-in takes the row's own measured height instead.
   */
  estimatedHeight: number;
  /**
   * Mount now, wherever the row is — for a row about to be scrolled to (a
   * "reveal in Network" target), which has to exist before it can be.
   */
  forceMount?: boolean;
}

// Whether a blur moves focus out of the row altogether, rather than between
// two controls inside it.
function isFocusLeaving(event: FocusEvent<HTMLDivElement>): boolean {
  const next = event.relatedTarget;
  return !(next instanceof Node && event.currentTarget.contains(next));
}

/**
 * A list row that is mounted only while it is near the visible part of its
 * scroll region (#2932).
 *
 * The monitoring sidebar's Protocol and Network lists hold up to 1,000 rows.
 * Rendering each one in full capped the load test at ~150 calls/s with the
 * sidebar open, against ~1,300 with it closed, falling as the log grew: a
 * mounted row costs about 3 ms of Mantine to mount, and then a walk of its
 * whole subtree on every render of the page, because the `AppShell` and
 * `ScrollArea` above it hand down a fresh context value each time. Behind
 * this, only the rows near the viewport exist; the rest are an empty box of
 * the row's own height (or an estimate, before it has ever rendered), so the
 * scroll position and the scrollbar stay where they were.
 *
 * Unmounting is lossless for a row whose state is what its props would give
 * it. A row that holds more stays mounted, wherever it is scrolled:
 *
 * - one whose content calls `useKeepRowMounted(true)` — an entry expanded or
 *   collapsed against the list's setting, or with its edit-and-replay modal
 *   open;
 * - one holding keyboard focus, so a burst of new rows pushing it out of view
 *   does not drop the focus to the page;
 * - one with `forceMount`.
 *
 * Outside a scroll region that provides a registry (see
 * `useLazyMountRegistry`), the row mounts immediately and stays mounted.
 */
export function LazyRow({
  children,
  estimatedHeight,
  forceMount = false,
}: LazyRowProps) {
  const registry = useContext(LazyMountContext);
  const [near, setNear] = useState(registry === null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [holds, setHolds] = useState(0);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A new estimate means the rows changed shape (the list's compact toggle),
  // so a height measured in the old shape no longer holds the row's place.
  useValueChange(estimatedHeight, () => setMeasuredHeight(null));

  // The row's current height, taken as it is released: a row held off-screen
  // may have changed size since the observer last reported (a response
  // landing in an expanded body), and its stand-in must match what it was.
  const captureHeight = useCallback(() => {
    const element = rootRef.current;
    if (element) setMeasuredHeight(element.getBoundingClientRect().height);
  }, []);

  const hold = useCallback(() => {
    setHolds((count) => count + 1);
    return () => {
      captureHeight();
      setHolds((count) => count - 1);
    };
  }, [captureHeight]);

  // On the list's first render, a row in view mounts before the first paint
  // rather than showing its stand-in for a frame (see `checkOnFirstLayout`).
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!registry || !element) return;
    return registry.checkOnFirstLayout(element, () => setNear(true));
  }, [registry]);

  // A row that was force-mounted is being scrolled to: assume it arrives, and
  // let the observer's next report correct that if it does not.
  useValueChange(forceMount, (next) => {
    if (!next) setNear(true);
  });

  useEffect(() => {
    const element = rootRef.current;
    if (!registry || !element) return;
    return registry.observe(element, (report: LazyMountReport) => {
      setNear(report.near);
      if (!report.near) setMeasuredHeight(report.height);
    });
  }, [registry]);

  const handleFocus = () => setFocused(true);
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!isFocusLeaving(event)) return;
    captureHeight();
    setFocused(false);
  };

  const mounted = near || forceMount || holds > 0 || focused;

  // A bare `Box`: the only props are per-instance (the ref, a height that is
  // measured, the mount state), so there is nothing static to extract.
  return (
    <Box
      ref={rootRef}
      h={mounted ? undefined : (measuredHeight ?? estimatedHeight)}
      aria-hidden={mounted ? undefined : true}
      data-lazy-row={mounted ? "mounted" : "placeholder"}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {mounted && (
        <KeepRowMountedContext.Provider value={hold}>
          {children}
        </KeepRowMountedContext.Provider>
      )}
    </Box>
  );
}
