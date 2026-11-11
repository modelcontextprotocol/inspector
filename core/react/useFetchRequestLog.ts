import type { FetchRequestEntry } from "../mcp/types.js";
import type { FetchRequestLogState } from "../mcp/state/fetchRequestLogState.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import type { NotifyScheduler } from "./notifyScheduler.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_FETCH_REQUESTS: FetchRequestEntry[] = [];

const readFetchRequests = (state: FetchRequestLogState): FetchRequestEntry[] =>
  state.getFetchRequests();

export interface UseFetchRequestLogResult {
  fetchRequests: FetchRequestEntry[];
}

/**
 * React hook that subscribes to FetchRequestLogState and returns the fetch
 * request list.
 *
 * `schedule` (optional, module-scope) coalesces the store's per-entry
 * notifications — see `notifyScheduler.ts` (#2928). Without it every append
 * re-renders the caller.
 */
export function useFetchRequestLog(
  fetchRequestLogState: FetchRequestLogState | null,
  schedule?: NotifyScheduler,
): UseFetchRequestLogResult {
  const fetchRequests = useStoreSnapshot(
    fetchRequestLogState,
    "fetchRequestsChange",
    readFetchRequests,
    NO_FETCH_REQUESTS,
    schedule,
  );

  return { fetchRequests };
}
