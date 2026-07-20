import { useState, useEffect } from "react";
import type {
  ResourceSubscriptionsState,
  ResourceSubscriptionsStateEventMap,
} from "../mcp/state/resourceSubscriptionsState.js";
import type {
  InspectorResourceSubscription,
  ResourceSubscriptionStreamState,
} from "../mcp/types.js";
import { INACTIVE_SUBSCRIPTION_STREAM_STATE } from "../mcp/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseResourceSubscriptionsResult {
  subscriptions: InspectorResourceSubscription[];
  /**
   * Modern-era (2026-07-28) `subscriptions/listen` stream state (#1630).
   * `active: false` on the legacy era (and with no active server), so the
   * Resources screen renders no stream chrome there.
   */
  streamState: ResourceSubscriptionStreamState;
}

/**
 * React hook that subscribes to ResourceSubscriptionsState and returns the
 * current InspectorResourceSubscription[] plus the modern listen-stream state.
 * When the state is null (no active server), returns an empty array and an
 * inactive stream state.
 */
export function useResourceSubscriptions(
  state: ResourceSubscriptionsState | null,
): UseResourceSubscriptionsResult {
  const [subscriptions, setSubscriptions] = useState<
    InspectorResourceSubscription[]
  >(state?.getSubscriptions() ?? []);
  const [streamState, setStreamState] =
    useState<ResourceSubscriptionStreamState>(
      state?.getStreamState() ?? INACTIVE_SUBSCRIPTION_STREAM_STATE,
    );

  useEffect(() => {
    if (!state) {
      setSubscriptions([]);
      setStreamState(INACTIVE_SUBSCRIPTION_STREAM_STATE);
      return;
    }
    setSubscriptions(state.getSubscriptions());
    setStreamState(state.getStreamState());
    const onSubscriptionsChange = (
      event: TypedEventGeneric<
        ResourceSubscriptionsStateEventMap,
        "subscriptionsChange"
      >,
    ) => {
      setSubscriptions(event.detail);
    };
    const onStreamStateChange = (
      event: TypedEventGeneric<
        ResourceSubscriptionsStateEventMap,
        "streamStateChange"
      >,
    ) => {
      setStreamState(event.detail);
    };
    state.addEventListener("subscriptionsChange", onSubscriptionsChange);
    state.addEventListener("streamStateChange", onStreamStateChange);
    return () => {
      state.removeEventListener("subscriptionsChange", onSubscriptionsChange);
      state.removeEventListener("streamStateChange", onStreamStateChange);
    };
  }, [state]);

  return { subscriptions, streamState };
}
