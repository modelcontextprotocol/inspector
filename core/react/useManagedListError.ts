import { useState, useEffect } from "react";
import type { ManagedListEventMap } from "../mcp/state/managedListState.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

/**
 * The slice of a managed list state this hook needs. Declared structurally
 * rather than as `ManagedListState<T, M>` so the four list hooks can share it
 * without threading their item type through — the error is the same shape for
 * all of them.
 */
export interface ManagedListErrorSource {
  getError(): Error | null;
  addEventListener(
    type: "errorChange",
    listener: (
      event: TypedEventGeneric<ManagedListEventMap, "errorChange">,
    ) => void,
  ): void;
  removeEventListener(
    type: "errorChange",
    listener: (
      event: TypedEventGeneric<ManagedListEventMap, "errorChange">,
    ) => void,
  ): void;
}

/**
 * Subscribe to a managed list state's last-fetch error (#1953).
 *
 * Shared by the four `useManaged*` hooks so a list load that fails — including
 * the connect-time one, which has no caller to await it — reaches the UI
 * instead of only the console. `null` means the last fetch succeeded.
 */
export function useManagedListError(
  state: ManagedListErrorSource | null,
): Error | null {
  const [error, setError] = useState<Error | null>(state?.getError() ?? null);

  useEffect(() => {
    if (!state) {
      setError(null);
      return;
    }
    setError(state.getError());
    const onErrorChange = (
      event: TypedEventGeneric<ManagedListEventMap, "errorChange">,
    ) => {
      setError(event.detail);
    };
    state.addEventListener("errorChange", onErrorChange);
    return () => {
      state.removeEventListener("errorChange", onErrorChange);
    };
  }, [state]);

  return error;
}
