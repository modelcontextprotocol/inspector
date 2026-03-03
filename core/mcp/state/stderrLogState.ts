/**
 * StderrLogState: holds stderr log, subscribes to protocol "stderrLog" events.
 * Takes InspectorClient (will become InspectorClientProtocol in Stage 5).
 * Protocol emits only per-entry "stderrLog" (with payload); this manager owns the list
 * and emits stderrLog + stderrLogsChange on append, stderrLogsChange on clear.
 * Mirrors InspectorClient: maxStderrLogEvents trim, getStderrLogs(), clearStderrLogs().
 * Does not clear on connect/disconnect (client does not clear stderr - they persist across reconnects).
 */

import type { InspectorClient } from "../inspectorClient.js";
import type { StderrLogEntry } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface StderrLogStateEventMap {
  stderrLog: StderrLogEntry;
  stderrLogsChange: StderrLogEntry[];
}

export interface StderrLogStateOptions {
  /**
   * Maximum number of stderr log entries to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000, matching InspectorClient.
   */
  maxStderrLogEvents?: number;
}

/**
 * State manager that holds the stderr log. Subscribes to the protocol's "stderrLog"
 * event (per-entry with payload); appends to its list (trimming to maxStderrLogEvents when set),
 * then dispatches "stderrLog" (payload) and "stderrLogsChange" (full list).
 * getStderrLogs() and clearStderrLogs() match InspectorClient API.
 * Does not clear on connect or disconnect: pre-connect and post-connect entries both remain.
 */
export class StderrLogState extends TypedEventTarget<StderrLogStateEventMap> {
  private stderrLogs: StderrLogEntry[] = [];
  private client: InspectorClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxStderrLogEvents: number;

  constructor(client: InspectorClient, options: StderrLogStateOptions = {}) {
    super();
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
    this.client = client;
    const onStderrLog = (event: Event): void => {
      const entry = (event as CustomEvent<StderrLogEntry>).detail;
      if (
        this.maxStderrLogEvents > 0 &&
        this.stderrLogs.length >= this.maxStderrLogEvents
      ) {
        this.stderrLogs.shift();
      }
      this.stderrLogs.push(entry);
      this.dispatchTypedEvent("stderrLog", entry);
      this.dispatchTypedEvent("stderrLogsChange", this.getStderrLogs());
    };
    this.client.addEventListener("stderrLog", onStderrLog);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("stderrLog", onStderrLog);
      }
      this.client = null;
    };
  }

  getStderrLogs(): StderrLogEntry[] {
    return [...this.stderrLogs];
  }

  /**
   * Clear all stderr log entries. Dispatches stderrLogsChange only if the list was non-empty.
   */
  clearStderrLogs(): void {
    if (this.stderrLogs.length === 0) return;
    this.stderrLogs = [];
    this.dispatchTypedEvent("stderrLogsChange", []);
  }

  /**
   * Stop listening to the client and clear state. Call when switching clients.
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stderrLogs = [];
  }
}
