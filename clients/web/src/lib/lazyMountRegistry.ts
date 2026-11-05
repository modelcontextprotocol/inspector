/**
 * One shared `IntersectionObserver` per scroll region, which tells each list
 * row when it comes near the visible area and when it leaves it (#2932).
 *
 * The monitoring sidebar's Protocol and Network lists hold up to 1,000 rows.
 * Every mounted row costs something on every render of the page, not only
 * when it mounts: Mantine's `AppShell` and `ScrollArea` hand their subtrees a
 * fresh context value whenever they re-render, and React answers that by
 * walking the whole subtree of every memoized row that bails out. So rows are
 * mounted only near the viewport (see `LazyRow`), and this is what reports
 * where each one is. One observer serves the whole list: an observer per row
 * would cost an allocation and a registration per message, which is the
 * per-message cost this exists to remove.
 *
 * It is `lib`, not `utils`, because it owns a browser subsystem (the observer)
 * and its lifetime.
 */

/** Where an observed row is, as of the observer's latest report. */
export interface LazyMountReport {
  /** Whether the row is within the root plus its margin. */
  near: boolean;
  /** The row's rendered height in px, so a stand-in can keep its place. */
  height: number;
}

export interface LazyMountRegistry {
  /**
   * The scroll viewport rows are measured against. Set by the region from a
   * layout effect, which React runs after the viewport's ref is attached and
   * after the rows' own layout effects.
   */
  setRoot(root: Element | null): void;
  /**
   * Report every change in whether `element` is near the visible area —
   * including the first, as soon as it is observed. Returns an unsubscribe.
   */
  observe(
    element: Element,
    onChange: (report: LazyMountReport) => void,
  ): () => void;
  /**
   * Queue `element` for a synchronous "is it near?" check at the region's next
   * {@link flushFirstChecks}, calling `onNear` if it is. Returns a cancel.
   *
   * Only until the observer has reported for the first time; a no-op after.
   * It is for the rows of a list's first render — the sidebar opening, a tab
   * switch — so the rows in view mount before the first paint instead of the
   * whole list showing empty stand-ins for a frame. Only then: the check
   * forces a layout, and paying that on every later render, while messages
   * stream in, measured at about a quarter of the load test's throughput. A
   * row added later shows its stand-in for one frame instead.
   */
  checkOnFirstLayout(element: Element, onNear: () => void): () => void;
  /** Run the queued first checks against the root. */
  flushFirstChecks(): void;
  /** Stop watching everything; the registry may be reused afterwards. */
  disconnect(): void;
}

/**
 * How far beyond the visible area a row stays mounted, as a fraction of the
 * region's height each way, so ordinary scrolling reaches rows that are
 * already rendered rather than blank space. A quarter: ahead of a wheel or a
 * keyboard scroll, while a burst of new rows at the top of a newest-first list
 * mounts little more than the rows that can actually be seen.
 */
export const LAZY_MOUNT_MARGIN = 0.25;

/** Whether `element` lies within `root` grown by `margin` of its height. */
function isNear(element: Element, root: Element, margin: number): boolean {
  const area = root.getBoundingClientRect();
  const slack = area.height * margin;
  const box = element.getBoundingClientRect();
  return box.bottom >= area.top - slack && box.top <= area.bottom + slack;
}

/**
 * Build a registry. Its observer is created on first use, against the root
 * set by then: the rows register from passive effects, which React runs after
 * every layout effect, so the region has set its root before the first one.
 */
export function createLazyMountRegistry(
  margin: number = LAZY_MOUNT_MARGIN,
): LazyMountRegistry {
  const callbacks = new Map<Element, (report: LazyMountReport) => void>();
  const firstChecks = new Map<Element, () => void>();
  let root: Element | null = null;
  let observer: IntersectionObserver | null = null;
  let rootResize: ResizeObserver | null = null;
  // The root height the observer's margin was computed from.
  let marginBasis = 0;
  let reported = false;

  // The margin is in px from the root's HEIGHT: a percentage `rootMargin`
  // resolves against the root's width on every side, which in a tall, narrow
  // sidebar would give a fraction of the intended overscan, and would disagree
  // with the first-layout check below.
  const createObserver = (height: number): IntersectionObserver => {
    marginBasis = height;
    const next = new IntersectionObserver(
      (entries) => {
        reported = true;
        for (const entry of entries) {
          callbacks.get(entry.target)?.({
            near: entry.isIntersecting,
            height: entry.boundingClientRect.height,
          });
        }
      },
      { root, rootMargin: `${Math.round(height * margin)}px 0px` },
    );
    for (const element of callbacks.keys()) next.observe(element);
    return next;
  };

  // Watch the root's height, so the margin can follow it.
  const watchRoot = () => {
    if (rootResize || !root || typeof ResizeObserver === "undefined") return;
    rootResize = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) onRootResize(entry.target.getBoundingClientRect().height);
    });
    rootResize.observe(root);
  };

  const ensureObserver = (): IntersectionObserver => {
    watchRoot();
    observer ??= createObserver(root?.getBoundingClientRect().height ?? 0);
    return observer;
  };

  // A root that changes height (a window resize) gets an observer with a
  // margin to match; its rows are re-observed, and each gets a fresh report.
  const onRootResize = (height: number) => {
    if (!observer || height === marginBasis) return;
    observer.disconnect();
    observer = createObserver(height);
  };

  return {
    setRoot(next) {
      if (next === root) return;
      root = next;
      rootResize?.disconnect();
      rootResize = null;
      if (!observer) return;
      // A new root needs an observer of its own.
      observer.disconnect();
      observer = null;
      ensureObserver();
    },
    observe(element, onChange) {
      callbacks.set(element, onChange);
      ensureObserver().observe(element);
      return () => {
        callbacks.delete(element);
        observer?.unobserve(element);
      };
    },
    checkOnFirstLayout(element, onNear) {
      if (reported) return () => {};
      firstChecks.set(element, onNear);
      return () => {
        firstChecks.delete(element);
      };
    },
    flushFirstChecks() {
      if (firstChecks.size === 0) return;
      const pending = [...firstChecks];
      firstChecks.clear();
      for (const [element, onNear] of pending) {
        if (!root || isNear(element, root, margin)) onNear();
      }
    },
    disconnect() {
      rootResize?.disconnect();
      rootResize = null;
      callbacks.clear();
      firstChecks.clear();
      observer?.disconnect();
      observer = null;
      reported = false;
    },
  };
}
