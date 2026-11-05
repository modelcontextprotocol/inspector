/**
 * MessageLogState: holds the message log, subscribes to the protocol "message"
 * event. Protocol emits per-entry; this manager owns the list and emits both
 * `message` (single entry) and `messagesChange` (full list) on append/update,
 * and `messagesChange` on clear. Clears on disconnect — the disconnect handler
 * is the canonical session boundary. We do NOT clear on the subsequent
 * `connect` event because state managers (Tools/Prompts/Resources/Templates)
 * fire their initial list requests *synchronously* inside their own connect
 * listeners; clearing here too would wipe `pendingRequestEntries` after those
 * requests were tracked but before their responses came back, leaving the
 * history with unmatched responses.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { MessageEntry } from "../types.js";
import { isTerminalStatus } from "../types.js";
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

    // Entries are never mutated once they are in the list: an update replaces
    // the entry with a copy (#2928). A renderer can then tell a changed row
    // from an unchanged one by identity alone, which is what lets the
    // Protocol list skip re-rendering every row it already shows each time a
    // message arrives. Searched newest-first: the entry being updated is, by
    // construction, a recent one. Returns the copy, or `undefined` when the
    // entry has already been evicted from the list.
    const replaceEntry = (
      entry: MessageEntry,
      changes: Partial<MessageEntry>,
    ): MessageEntry | undefined => {
      const index = this.messages.lastIndexOf(entry);
      if (index < 0) return undefined;
      const updated: MessageEntry = { ...entry, ...changes };
      this.messages[index] = updated;
      return updated;
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
          const updated = replaceEntry(requestEntry, {
            response: entry.message as MessageEntry["response"],
            duration:
              entry.timestamp.getTime() - requestEntry.timestamp.getTime(),
          });
          // The request was evicted while pending: its response has no row
          // to fold into, and is not worth one of its own.
          if (!updated) return;
          this.dispatchTypedEvent("message", updated);
          this.dispatchTypedEvent("messagesChange", this.getMessages());
          return;
        }
      }
      pushEntry(entry);
    };

    // A response the client rejected after the fact (the wire frame was valid
    // JSON-RPC, but the SDK codec refused the result). Annotate the entry that
    // carries that JSON-RPC id so it stops rendering as a clean success — the
    // request entry when the response was folded into it, otherwise the
    // standalone response entry. Searched newest-first: ids are unique within
    // a session, and the failing exchange is by construction a recent one.
    const onResponseRejected = (
      event: TypedEventGeneric<InspectorClientEventMap, "responseRejected">,
    ): void => {
      const { id, reason } = event.detail;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const entry = this.messages[i]!;
        const entryId = (entry.message as { id?: string | number }).id;
        if (entryId !== id) continue;
        if (entry.direction === "notification") continue;
        // A request entry with no response yet isn't the one being rejected —
        // keep looking for the standalone response frame.
        if (entry.direction === "request" && !entry.response) continue;
        const updated: MessageEntry = { ...entry, clientError: reason };
        this.messages[i] = updated;
        this.dispatchTypedEvent("message", updated);
        this.dispatchTypedEvent("messagesChange", this.getMessages());
        return;
      }
    };

    // A request whose send failed gets no response frame, ever — the server
    // either never saw it or refused it at the HTTP layer (a bare 403). Close
    // its entry as a client-side error so it stops rendering as "Pending"
    // (#2721). Only a still-pending entry is resolved: one already answered,
    // or evicted from the log, is left as it is.
    const onRequestFailed = (
      event: TypedEventGeneric<InspectorClientEventMap, "requestFailed">,
    ): void => {
      const { id, reason } = event.detail;
      const requestEntry = this.pendingRequestEntries.get(id);
      if (!requestEntry) return;
      this.pendingRequestEntries.delete(id);
      const updated = replaceEntry(requestEntry, {
        clientError: reason,
        duration: Date.now() - requestEntry.timestamp.getTime(),
      });
      if (!updated) return;
      this.dispatchTypedEvent("message", updated);
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    };

    const onStatusChange = (): void => {
      if (isTerminalStatus(this.client?.getStatus())) {
        this.messages = [];
        this.pendingRequestEntries.clear();
        this.dispatchTypedEvent("messagesChange", []);
      }
    };
    this.client.addEventListener("message", onMessage);
    this.client.addEventListener("responseRejected", onResponseRejected);
    this.client.addEventListener("requestFailed", onRequestFailed);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("message", onMessage);
        this.client.removeEventListener("responseRejected", onResponseRejected);
        this.client.removeEventListener("requestFailed", onRequestFailed);
        this.client.removeEventListener("statusChange", onStatusChange);
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
    this.messages = predicate ? this.messages.filter((m) => !predicate(m)) : [];
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
