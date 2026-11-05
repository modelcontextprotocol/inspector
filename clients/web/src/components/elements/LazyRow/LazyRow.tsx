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

// What a Tab can land on inside a row.
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Whether focus reached a stand-in moving forward (Tab) rather than back
// (Shift+Tab): forward when it came from something earlier in the document,
// or from nowhere.
function isFocusArrivingForward(event: FocusEvent<HTMLDivElement>): boolean {
  const from = event.relatedTarget;
  if (!(from instanceof Node)) return true;
  return Boolean(
    from.compareDocumentPosition(event.currentTarget) &
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
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
    const height = rootRef.current?.getBoundingClientRect().height ?? 0;
    // Zero is a row in a collapsed section, not its size (see below).
    if (height > 0) setMeasuredHeight(height);
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
      // A zero height is a row inside a collapsed section, not the row's own
      // size; keep the last real measurement (or the estimate) instead.
      if (!report.near && report.height > 0) setMeasuredHeight(report.height);
    });
  }, [registry]);

  // Keyboard reach: a stand-in is a tab stop, so Tab and Shift+Tab can move
  // past a row too tall to leave its neighbours mounted. Focus landing on one
  // mounts the row and moves on into it — to its first control going
  // forward, its last going back.
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      pendingFocus.current = isFocusArrivingForward(event) ? "first" : "last";
    }
    setFocused(true);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!isFocusLeaving(event)) return;
    captureHeight();
    setFocused(false);
  };

  const mounted = near || forceMount || holds > 0 || focused;

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    const element = rootRef.current;
    if (!mounted || !target || !element) return;
    pendingFocus.current = null;
    const controls = element.querySelectorAll<HTMLElement>(TABBABLE);
    const next =
      target === "first" ? controls[0] : controls[controls.length - 1];
    next?.focus();
  }, [mounted]);

  // A bare `Box`: the only props are per-instance (the ref, a height that is
  // measured, the mount state), so there is nothing static to extract. The
  // stand-in is focusable (see `handleFocus`), so it is not `aria-hidden`.
  return (
    <Box
      ref={rootRef}
      h={mounted ? undefined : (measuredHeight ?? estimatedHeight)}
      tabIndex={mounted ? undefined : 0}
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
