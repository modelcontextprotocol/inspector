/**
 * StderrLogState: holds the stderr log, subscribes to the protocol "stderrLog"
 * event. Protocol emits per-entry; this manager owns the list and emits both
 * `stderrLog` (single entry) and `stderrLogsChange` (full list) on append,
 * and `stderrLogsChange` on clear. Does not clear on connect/disconnect —
 * pre-connect and post-connect entries both remain.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { StderrLogEntry } from "../types.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";

export interface StderrLogStateEventMap {
  stderrLog: StderrLogEntry;
  stderrLogsChange: StderrLogEntry[];
}

export interface StderrLogStateOptions {
  /**
   * Maximum number of stderr log entries to store (0 = unlimited, not recommended).
   * When exceeded, oldest entries are dropped. Default 1000.
   */
  maxStderrLogEvents?: number;
}

export class StderrLogState extends TypedEventTarget<StderrLogStateEventMap> {
  private stderrLogs: StderrLogEntry[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxStderrLogEvents: number;

  constructor(
    client: InspectorClientProtocol,
    options: StderrLogStateOptions = {},
  ) {
    super();
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
    this.client = client;
    const onStderrLog = (
      event: TypedEventGeneric<InspectorClientEventMap, "stderrLog">,
    ): void => {
      const entry = event.detail;
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
   * Clear all stderr log entries. Dispatches stderrLogsChange only if the
   * list was non-empty.
   */
  clearStderrLogs(): void {
    if (this.stderrLogs.length === 0) return;
    this.stderrLogs = [];
    this.dispatchTypedEvent("stderrLogsChange", []);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stderrLogs = [];
  }
}
