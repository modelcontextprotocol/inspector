import { useState, useEffect } from "react";
import type { MessageEntry } from "../mcp/types.js";
import type { MessageLogState } from "../mcp/state/messageLogState.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { MessageLogStateEventMap } from "../mcp/state/messageLogState.js";

export interface UseMessageLogResult {
  messages: MessageEntry[];
}

/**
 * React hook that subscribes to MessageLogState and returns the message list.
 */
export function useMessageLog(
  messageLogState: MessageLogState | null,
): UseMessageLogResult {
  const [messages, setMessages] = useState<MessageEntry[]>(
    messageLogState?.getMessages() ?? [],
  );

  useEffect(() => {
    if (!messageLogState) {
      setMessages([]);
      return;
    }
    setMessages(messageLogState.getMessages());
    const onMessagesChange = (
      event: TypedEventGeneric<MessageLogStateEventMap, "messagesChange">,
    ) => {
      setMessages(event.detail);
    };
    messageLogState.addEventListener("messagesChange", onMessagesChange);
    return () => {
      messageLogState.removeEventListener("messagesChange", onMessagesChange);
    };
  }, [messageLogState]);

  return { messages };
}
