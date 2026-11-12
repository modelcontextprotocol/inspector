/**
 * Coalescing of store-change notifications (#2928).
 *
 * A log store (`MessageLogState`, `FetchRequestLogState`, `StderrLogState`)
 * dispatches once per entry, and `useSyncExternalStore` renders synchronously
 * on every notification — so a burst of N messages costs N full renders of
 * whatever subscribes. In the web client that subscriber is `App`, which put
 * the browser's main thread at ~95% busy during a load test and capped the
 * page at ~10 calls/s with the monitoring sidebar open (~67 closed): calls were
 * serialized behind rendering rather than behind the transport.
 *
 * A {@link NotifyScheduler} decouples the two rates. The subscription records
 * that *something* changed and lets the scheduler decide when to tell React; any
 * number of dispatches before that point collapse into one render.
 *
 * This defers the **signal**, never the **data**: `useStoreSnapshot` re-reads
 * the live store when React asks, so the render that eventually happens sees
 * every entry, in the store's own order, and a render that happens earlier for
 * an unrelated reason already sees the latest list. Nothing is queued here, so
 * nothing can be dropped or reordered.
 */

/**
 * Schedule `flush` to run later; return a function that cancels it if it has
 * not run yet. One pending flush per subscription is all a caller ever holds.
 */
export type NotifyScheduler = (flush: () => void) => () => void;

/**
 * Fallback delay when no animation frame exists (Node, a test environment
 * without one): one 60 Hz frame, so the cadence matches the browser path.
 */
export const FRAME_FALLBACK_MS = 16;

/**
 * Coalesce to the next animation frame — the rate a browser can show a change
 * at, so a render any sooner would paint nothing new. Falls back to a ~16 ms
 * timer where `requestAnimationFrame` does not exist (the TUI runs in Node).
 *
 * In a hidden tab the browser suspends animation frames, so the notification
 * waits until the tab is visible again. That is the point rather than a cost:
 * the store keeps every entry, and the first visible frame renders them all.
 */
export const animationFrameScheduler: NotifyScheduler = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(() => flush());
    return () => cancelAnimationFrame(handle);
  }
  const timer = setTimeout(flush, FRAME_FALLBACK_MS);
  return () => clearTimeout(timer);
};

/**
 * Wrap `onChange` so that any number of calls before the scheduler fires
 * produce exactly one call to it. The returned `cancel` drops a pending call —
 * used on unsubscribe, so a notification never reaches a listener React has
 * already detached.
 */
export function coalesce(
  onChange: () => void,
  schedule: NotifyScheduler,
): { notify: () => void; cancel: () => void } {
  let cancelPending: (() => void) | null = null;
  return {
    notify: () => {
      if (cancelPending) return;
      cancelPending = schedule(() => {
        cancelPending = null;
        onChange();
      });
    },
    cancel: () => {
      cancelPending?.();
      cancelPending = null;
    },
  };
}
