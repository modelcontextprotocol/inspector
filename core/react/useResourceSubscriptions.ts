import type { ResourceSubscriptionsState } from "../mcp/state/resourceSubscriptionsState.js";
import type {
  InspectorResourceSubscription,
  ResourceSubscriptionStreamState,
} from "../mcp/types.js";
import { INACTIVE_SUBSCRIPTION_STREAM_STATE } from "../mcp/types.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_SUBSCRIPTIONS: InspectorResourceSubscription[] = [];

const readSubscriptions = (
  state: ResourceSubscriptionsState,
): InspectorResourceSubscription[] => state.getSubscriptions();
const readStreamState = (
  state: ResourceSubscriptionsState,
): ResourceSubscriptionStreamState => state.getStreamState();

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
  const subscriptions = useStoreSnapshot(
    state,
    "subscriptionsChange",
    readSubscriptions,
    NO_SUBSCRIPTIONS,
  );
  const streamState = useStoreSnapshot(
    state,
    "streamStateChange",
    readStreamState,
    INACTIVE_SUBSCRIPTION_STREAM_STATE,
  );

  return { subscriptions, streamState };
}
