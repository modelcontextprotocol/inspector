import { useState, useEffect } from "react";
import type {
  ResourceSubscriptionsState,
  ResourceSubscriptionsStateEventMap,
} from "../mcp/state/resourceSubscriptionsState.js";
import type { InspectorResourceSubscription } from "../mcp/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseResourceSubscriptionsResult {
  subscriptions: InspectorResourceSubscription[];
}

/**
 * React hook that subscribes to ResourceSubscriptionsState and returns the
 * current InspectorResourceSubscription[]. When the state is null (no active
 * server), returns an empty array.
 */
export function useResourceSubscriptions(
  state: ResourceSubscriptionsState | null,
): UseResourceSubscriptionsResult {
  const [subscriptions, setSubscriptions] = useState<
    InspectorResourceSubscription[]
  >(state?.getSubscriptions() ?? []);

  useEffect(() => {
    if (!state) {
      setSubscriptions([]);
      return;
    }
    setSubscriptions(state.getSubscriptions());
    const onSubscriptionsChange = (
      event: TypedEventGeneric<
        ResourceSubscriptionsStateEventMap,
        "subscriptionsChange"
      >,
    ) => {
      setSubscriptions(event.detail);
    };
    state.addEventListener("subscriptionsChange", onSubscriptionsChange);
    return () => {
      state.removeEventListener("subscriptionsChange", onSubscriptionsChange);
    };
  }, [state]);

  return { subscriptions };
}
