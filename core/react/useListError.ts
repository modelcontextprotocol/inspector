import { useCallback, useSyncExternalStore } from "react";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

/**
 * The single event both list-state families expose for this. Declared here
 * rather than imported from either so the hook depends on neither: the managed
 * (aggregate) states and the paged states each carry an `errorChange` of this
 * shape, and this is the whole contract the hook needs.
 */
interface ListErrorEventMap {
  errorChange: Error | null;
}

/**
 * The slice of a list state this hook needs. Declared structurally rather than
 * as a concrete state class so every list hook can share it without threading
 * its item type through — the error is the same shape for all of them.
 */
export interface ListErrorSource {
  getError(): Error | null;
  addEventListener(
    type: "errorChange",
    listener: (
      event: TypedEventGeneric<ListErrorEventMap, "errorChange">,
    ) => void,
  ): void;
  removeEventListener(
    type: "errorChange",
    listener: (
      event: TypedEventGeneric<ListErrorEventMap, "errorChange">,
    ) => void,
  ): void;
}

/**
 * Subscribe to a list state's last-fetch error (#1953, #1998).
 *
 * Shared by the four `useManaged*` hooks and the three `usePaged*` hooks so a
 * list load that fails — including the connect-time one, which has no caller
 * to await it — reaches the UI instead of only the console. `null` means the
 * last fetch succeeded. Both families need it because the paged stores are the
 * display source in paginated mode, where the managed stores deliberately
 * never fetch (#1998).
 *
 * Built on `useSyncExternalStore` rather than the `useState` + `useEffect`
 * subscribe pattern the sibling hooks use. Re-syncing state from the `state`
 * prop inside an effect would render one frame carrying the PREVIOUS store's
 * error after `state` changes (switching servers) before the effect corrects
 * it — the "don't derive state from props in an effect" rule in AGENTS.md.
 * `useSyncExternalStore` has no such window: the snapshot is read during
 * render, so a store swap is reflected in the same frame, and it also closes
 * the gap where an error recorded between render and subscribe would be missed.
 *
 * The snapshot must be referentially stable across reads that mean "no change",
 * which it is: it returns the stored `Error` instance itself (or `null`), never
 * a fresh object.
 */
export function useListError(state: ListErrorSource | null): Error | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!state) return () => {};
      const listener = () => onStoreChange();
      state.addEventListener("errorChange", listener);
      return () => {
        state.removeEventListener("errorChange", listener);
      };
    },
    [state],
  );

  const getSnapshot = useCallback(() => state?.getError() ?? null, [state]);

  // Server snapshot: same read. The stores are browser/Node runtime objects
  // with no SSR path, and passing the same getter keeps hydration consistent
  // rather than throwing on a server render.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
