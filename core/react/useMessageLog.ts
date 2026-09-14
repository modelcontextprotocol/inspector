import type { MessageEntry } from "../mcp/types.js";
import type { MessageLogState } from "../mcp/state/messageLogState.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

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
 * request entry mutates that entry in place and dispatches. The snapshot is
 * cached against the store's dispatch count rather than the list's contents
 * precisely so that case still produces a new list identity and re-renders —
 * see `TypedEventTarget.getEventRevision`.
 */
export function useMessageLog(
  messageLogState: MessageLogState | null,
): UseMessageLogResult {
  const messages = useStoreSnapshot(
    messageLogState,
    "messagesChange",
    readMessages,
    NO_MESSAGES,
  );

  return { messages };
}
