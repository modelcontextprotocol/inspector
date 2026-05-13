/**
 * MessageLogState: holds the message log, subscribes to the protocol "message"
 * event. Protocol emits per-entry; this manager owns the list and emits both
 * `message` (single entry) and `messagesChange` (full list) on append/update,
 * and `messagesChange` on clear. Clears on connect (new session) and on
 * disconnect.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { MessageEntry } from "../types.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";

export interface MessageLogStateEventMap {
  message: MessageEntry;
  messagesChange: MessageEntry[];
}

export interface MessageLogStateOptions {
  /**
   * Maximum number of messages to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000.
   */
  maxMessages?: number;
}

export class MessageLogState extends TypedEventTarget<MessageLogStateEventMap> {
  private messages: MessageEntry[] = [];
  /** Pending request entries by JSON-RPC message id for matching responses. */
  private pendingRequestEntries = new Map<string | number, MessageEntry>();
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxMessages: number;

  constructor(
    client: InspectorClientProtocol,
    options: MessageLogStateOptions = {},
  ) {
    super();
    this.maxMessages = options.maxMessages ?? 1000;
    this.client = client;

    const pushEntry = (entry: MessageEntry): void => {
      if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
        this.messages.shift();
      }
      this.messages.push(entry);
      this.dispatchTypedEvent("message", entry);
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    };

    const onMessage = (
      event: TypedEventGeneric<InspectorClientEventMap, "message">,
    ): void => {
      const entry = event.detail;
      if (entry.direction === "request") {
        const reqId =
          "id" in entry.message
            ? (entry.message as { id?: string | number }).id
            : undefined;
        if (reqId !== undefined) {
          this.pendingRequestEntries.set(reqId, entry);
        }
        pushEntry(entry);
        return;
      }
      if (entry.direction === "response") {
        const messageId =
          "id" in entry.message
            ? (entry.message as { id?: string | number }).id
            : undefined;
        const requestEntry =
          messageId !== undefined
            ? this.pendingRequestEntries.get(messageId)
            : undefined;
        if (requestEntry) {
          this.pendingRequestEntries.delete(messageId!);
          requestEntry.response = entry.message as MessageEntry["response"];
          requestEntry.duration =
            entry.timestamp.getTime() - requestEntry.timestamp.getTime();
          this.dispatchTypedEvent("message", requestEntry);
          this.dispatchTypedEvent("messagesChange", this.getMessages());
          return;
        }
      }
      pushEntry(entry);
    };

    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.messages = [];
        this.pendingRequestEntries.clear();
        this.dispatchTypedEvent("messagesChange", []);
      }
    };
    const onConnect = (): void => {
      this.messages = [];
      this.pendingRequestEntries.clear();
      this.dispatchTypedEvent("messagesChange", []);
    };
    this.client.addEventListener("message", onMessage);
    this.client.addEventListener("statusChange", onStatusChange);
    this.client.addEventListener("connect", onConnect);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("message", onMessage);
        this.client.removeEventListener("statusChange", onStatusChange);
        this.client.removeEventListener("connect", onConnect);
      }
      this.client = null;
    };
  }

  getMessages(predicate?: (entry: MessageEntry) => boolean): MessageEntry[] {
    if (predicate) {
      return this.messages.filter(predicate);
    }
    return [...this.messages];
  }

  /**
   * Remove messages from history. When `predicate` is provided, removes only
   * entries for which predicate returns true. When omitted, clears all messages.
   * Dispatches messagesChange only if the list actually changed.
   */
  clearMessages(predicate?: (entry: MessageEntry) => boolean): void {
    const before = this.messages.length;
    this.messages = predicate
      ? this.messages.filter((m) => !predicate(m))
      : [];
    // Drop pending-request bookkeeping for any entry that was just removed.
    // Without this, a later response matching an evicted request id would
    // mutate a Map-only entry that is no longer reachable from `messages`,
    // silently dropping the response.
    if (predicate) {
      const survivors = new Set(this.messages);
      for (const [id, entry] of this.pendingRequestEntries) {
        if (!survivors.has(entry)) {
          this.pendingRequestEntries.delete(id);
        }
      }
    } else {
      this.pendingRequestEntries.clear();
    }
    if (this.messages.length !== before) {
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.messages = [];
    this.pendingRequestEntries.clear();
  }
}
