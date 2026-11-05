import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A function whose identity never changes and which always calls the latest
 * `fn` passed in (#2928).
 *
 * For handing a callback to a memoized child. The Protocol list's handlers
 * arrive from `App` as new functions on every render, so passing them straight
 * through would defeat `memo` on every row and re-render the whole list each
 * time a message lands. Routing them through this keeps the rows' props equal
 * while still calling the handler the parent rendered last.
 *
 * The returned function is for **event handlers**, not for calling during
 * render: the ref is written in an insertion effect, so a render reading it
 * would see the previous commit's `fn`.
 */
export function useLatestCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
