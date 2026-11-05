import {
  createContext,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import {
  createLazyMountRegistry,
  type LazyMountRegistry,
} from "../lib/lazyMountRegistry";

/**
 * The registry of the scroll region a `LazyRow` sits in (#2932). `null` —
 * outside any region, or where there is no `IntersectionObserver` — means
 * "mount immediately", so a row rendered on its own (a story, a test) behaves
 * exactly as it did before rows were lazy.
 */
export const LazyMountContext = createContext<LazyMountRegistry | null>(null);

/**
 * One lazy-mount registry for the scroll region whose viewport `rootRef`
 * points at, disconnected when the region unmounts.
 *
 * Every render it hands the registry the viewport and runs the first checks
 * the rows queued from their own layout effects. Those run first — React runs
 * a child's layout effects before its parent's, and attaches the viewport's
 * ref in between — so this is the earliest point where both the rows and the
 * viewport they are measured against exist, and it is still before paint.
 *
 * Returns `null` where `IntersectionObserver` does not exist. The unit tests'
 * DOM is one such place on purpose: happy-dom ships a stub that never reports,
 * which would leave every row unmounted, so the test setup removes it and rows
 * there mount eagerly — the honest model of a DOM with no layout to observe.
 */
export function useLazyMountRegistry(
  rootRef: RefObject<Element | null>,
): LazyMountRegistry | null {
  const [registry] = useState(() =>
    typeof IntersectionObserver === "undefined"
      ? null
      : createLazyMountRegistry(),
  );
  useLayoutEffect(() => {
    registry?.setRoot(rootRef.current);
    registry?.flushFirstChecks();
  });
  useEffect(() => () => registry?.disconnect(), [registry]);
  return registry;
}
