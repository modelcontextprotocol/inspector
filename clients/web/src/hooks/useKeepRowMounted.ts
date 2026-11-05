import { createContext, useContext, useEffect } from "react";

/**
 * Hold/release for the `LazyRow` a component sits in. `null` outside one.
 * `hold` returns its own release, so two holders in one row do not cancel.
 */
export const KeepRowMountedContext = createContext<(() => () => void) | null>(
  null,
);

/**
 * Keep the enclosing `LazyRow` mounted while `keep` is true, even when it is
 * scrolled far from the viewport (#2932).
 *
 * A lazy row unmounts when it leaves the viewport and remounts from its props
 * when it comes back, which is lossless only for a row whose state is what its
 * props would give it anyway. A row the user has changed — expanded on its own,
 * or with an edit-and-replay draft open — calls this so the change survives a
 * scroll away and back, and a burst of new rows pushing it out of view. A
 * no-op outside a `LazyRow`.
 */
export function useKeepRowMounted(keep: boolean): void {
  const hold = useContext(KeepRowMountedContext);
  useEffect(() => {
    if (!keep || !hold) return;
    return hold();
  }, [keep, hold]);
}
