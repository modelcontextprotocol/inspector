import type { StderrLogEntry } from "../mcp/types.js";
import type { StderrLogState } from "../mcp/state/stderrLogState.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import type { NotifyScheduler } from "./notifyScheduler.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_STDERR_LOGS: StderrLogEntry[] = [];

const readStderrLogs = (state: StderrLogState): StderrLogEntry[] =>
  state.getStderrLogs();

export interface UseStderrLogResult {
  stderrLogs: StderrLogEntry[];
}

/**
 * React hook that subscribes to StderrLogState and returns the stderr log list.
 *
 * `schedule` (optional, module-scope) coalesces the store's per-entry
 * notifications — see `notifyScheduler.ts` (#2928). Without it every append
 * re-renders the caller.
 */
export function useStderrLog(
  stderrLogState: StderrLogState | null,
  schedule?: NotifyScheduler,
): UseStderrLogResult {
  const stderrLogs = useStoreSnapshot(
    stderrLogState,
    "stderrLogsChange",
    readStderrLogs,
    NO_STDERR_LOGS,
    schedule,
  );

  return { stderrLogs };
}
