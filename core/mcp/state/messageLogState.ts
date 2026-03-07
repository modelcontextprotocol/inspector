/**
 * MessageLogState: holds message log, subscribes to protocol "message" events.
 * Takes InspectorClient (will become InspectorClientProtocol in Stage 5).
 * Protocol emits only per-entry "message" (with payload); this manager owns the list
 * and emits message + messagesChange on append/update, messagesChange on clear.
 * Mirrors InspectorClient message-list behavior: maxMessages trim, getMessages(predicate?), clearMessages(predicate?), clear on connect/disconnect.
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { MessageEntry } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface MessageLogStateEventMap {
  message: MessageEntry;
  messagesChange: MessageEntry[];
}

export interface MessageLogStateOptions {
  /**
   * Maximum number of messages to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000, matching InspectorClient.
   */
  maxMessages?: number;
}

/**
 * State manager that holds the message log. Subscribes to the protocol's "message"
 * event (per-entry with payload); appends or updates the entry in its list (trimming
 * to maxMessages when set), then dispatches "message" (payload) and "messagesChange" (full list).
 * On connect, clears list (fresh session). On disconnect, clears and dispatches messagesChange.
 * getMessages(predicate?) and clearMessages(predicate?) match InspectorClient API.
 */
export class MessageLogState extends TypedEventTarget<MessageLogStateEventMap> {
  private messages: MessageEntry[] = [];
  /** Pending request entries by JSON-RPC message id for matching responses. */
  private pendingRequestEntries = new Map<string | number, MessageEntry>();
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxMessages: number;

  constructor(client: InspectorClient, options: MessageLogStateOptions = {}) {
    super();
    this.maxMessages = options.maxMessages ?? 1000;
    this.client = client;
    const onMessage = (event: Event): void => {
      const entry = (event as CustomEvent<MessageEntry>).detail;
      if (entry.direction === "request") {
        if (
          "id" in entry.message &&
          (entry.message as { id?: string | number }).id !== undefined
        ) {
          this.pendingRequestEntries.set(
            (entry.message as { id: string | number }).id,
            entry,
          );
        }
        if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
          this.messages.shift();
        }
        this.messages.push(entry);
        this.dispatchTypedEvent("message", entry);
        this.dispatchTypedEvent("messagesChange", this.getMessages());
      } else if (entry.direction === "response") {
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
        } else {
          if (
            this.maxMessages > 0 &&
            this.messages.length >= this.maxMessages
          ) {
            this.messages.shift();
          }
          this.messages.push(entry);
          this.dispatchTypedEvent("message", entry);
          this.dispatchTypedEvent("messagesChange", this.getMessages());
        }
      } else {
        if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
          this.messages.shift();
        }
        this.messages.push(entry);
        this.dispatchTypedEvent("message", entry);
        this.dispatchTypedEvent("messagesChange", this.getMessages());
      }
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

  /**
   * Get messages. When predicate is provided, returns only entries for which
   * predicate returns true. When omitted, returns all messages.
   */
  getMessages(predicate?: (entry: MessageEntry) => boolean): MessageEntry[] {
    if (predicate) {
      return this.messages.filter(predicate);
    }
    return [...this.messages];
  }

  /**
   * Remove messages from history. When predicate is provided, removes only entries
   * for which predicate returns true. When omitted, clears all messages.
   * Dispatches messagesChange only if the list actually changed.
   */
  clearMessages(predicate?: (entry: MessageEntry) => boolean): void {
    const before = this.messages.length;
    this.messages = predicate ? this.messages.filter((m) => !predicate(m)) : [];
    if (this.messages.length !== before) {
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    }
  }

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.messages = [];
    this.pendingRequestEntries.clear();
  }
}
