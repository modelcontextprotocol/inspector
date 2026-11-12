import type { MessageEntry } from "../mcp/types.js";
import type { MessageLogState } from "../mcp/state/messageLogState.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import type { NotifyScheduler } from "./notifyScheduler.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_MESSAGES: MessageEntry[] = [];

const readMessages = (state: MessageLogState): MessageEntry[] =>
  state.getMessages();

export interface UseMessageLogResult {
  messages: MessageEntry[];
}

/**
 * React hook that subscribes to MessageLogState and returns the message list.
 *
 * Note this log's changes are not all appends: folding a response into its
 * request entry replaces that entry with an updated copy and dispatches, so a
 * row renderer can memoize on entry identity (#2928). The snapshot is cached
 * against the store's dispatch count rather than the list's contents, so the
 * list identity changes on every dispatch however the store updates — see
 * `TypedEventTarget.getEventRevision`.
 *
 * `schedule` (optional, module-scope) coalesces the store's per-entry
 * notifications — see `notifyScheduler.ts` (#2928). Without it every append
 * re-renders the caller.
 */
export function useMessageLog(
  messageLogState: MessageLogState | null,
  schedule?: NotifyScheduler,
): UseMessageLogResult {
  const messages = useStoreSnapshot(
    messageLogState,
    "messagesChange",
    readMessages,
    NO_MESSAGES,
    schedule,
  );

  return { messages };
}
