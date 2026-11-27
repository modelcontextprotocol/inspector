import type {
  EventLogEntry,
  EventSubscription,
  EventSubscriptionsState,
} from "../mcp/state/eventSubscriptionsState.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import type { NotifyScheduler } from "./notifyScheduler.js";

/**
 * Shared stable empty lists for the no-server case. Module scope so the
 * snapshot does not change identity every render — see `useStoreSnapshot`.
 * Read-only by contract.
 */
const NO_SUBSCRIPTIONS: EventSubscription[] = [];
const NO_LOG: EventLogEntry[] = [];

const readSubscriptions = (
  state: EventSubscriptionsState,
): EventSubscription[] => state.getSubscriptions();

const readLog = (state: EventSubscriptionsState): EventLogEntry[] =>
  state.getLog();

/**
 * The Events subscription registry's subscriptions (#3029): mode, status,
 * cursor, granted heartbeat or `nextPollMs`, counts and how each one ended.
 * Each subscription object is replaced on change, so a row can memoize on it.
 */
export function useEventSubscriptions(
  state: EventSubscriptionsState | null,
): EventSubscription[] {
  return useStoreSnapshot(
    state,
    "subscriptionsChange",
    readSubscriptions,
    NO_SUBSCRIPTIONS,
  );
}

/**
 * The occurrence log across every subscription: events (with any payload
 * validation flag) and the gap, error, reconnect and termination markers.
 * `data` in an event entry is untrusted — render it as inert JSON only.
 *
 * `schedule` (optional, module-scope) coalesces the per-entry notifications,
 * as for the message log (#2928): a backlog drain appends many at once.
 */
export function useEventLog(
  state: EventSubscriptionsState | null,
  schedule?: NotifyScheduler,
): EventLogEntry[] {
  return useStoreSnapshot(state, "logChange", readLog, NO_LOG, schedule);
}
