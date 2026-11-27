/**
 * How the Events tab (#3032) words a subscription and a line of its occurrence
 * log. Pure (utils = compute): the tab renders whatever these return.
 *
 * An occurrence's `data` is untrusted (spec, Security), so it is shown only as
 * `JSON.stringify` output — never interpreted, and with every control
 * character escaped, so a payload cannot drive the terminal. Error messages
 * pass through the TUI's display redaction like every other error it shows.
 */

import type {
  EventLogEntry,
  EventSubscription,
  EventSubscriptionStatus,
} from "@inspector/core/mcp/state/index.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import { redactErrorText } from "./errorText.js";

/** Whether the engine is still running it (as opposed to stopped or ended). */
export function isLiveSubscription(subscription: EventSubscription): boolean {
  return (
    subscription.status === "starting" ||
    subscription.status === "active" ||
    subscription.status === "reconnecting"
  );
}

const STATUS_COLOR: Record<EventSubscriptionStatus, string> = {
  starting: "yellow",
  active: "green",
  reconnecting: "yellow",
  terminated: "red",
  stopped: "gray",
};

export function subscriptionStatusColor(
  status: EventSubscriptionStatus,
): string {
  return STATUS_COLOR[status];
}

function cursorText(cursor: string | null): string {
  return cursor === null ? "null" : cursor;
}

/**
 * One line per subscription: mode, status, where it would resume, the server's
 * timing grant, and what it has delivered.
 */
export function subscriptionSummary(subscription: EventSubscription): string {
  const parts = [
    subscription.mode,
    subscription.status,
    `cursor ${cursorText(subscription.cursor)}`,
  ];
  if (subscription.mode === "push" && subscription.grantedHeartbeatMs) {
    parts.push(`heartbeat ${subscription.grantedHeartbeatMs}ms`);
  }
  if (subscription.mode === "poll" && subscription.nextPollMs !== undefined) {
    parts.push(`next poll ${subscription.nextPollMs}ms`);
  }
  const { counts } = subscription;
  parts.push(`${counts.events} event${counts.events === 1 ? "" : "s"}`);
  if (counts.gaps > 0) parts.push(`${counts.gaps} gap(s)`);
  if (counts.errors > 0) parts.push(`${counts.errors} error(s)`);
  if (counts.reconnects > 0) parts.push(`${counts.reconnects} reconnect(s)`);
  if (counts.duplicates > 0) parts.push(`${counts.duplicates} duplicate(s)`);
  if (counts.invalidPayloads > 0) {
    parts.push(`${counts.invalidPayloads} invalid payload(s)`);
  }
  if (Object.keys(subscription.arguments).length > 0) {
    parts.push(`args ${JSON.stringify(subscription.arguments)}`);
  }
  return escapeControls(parts.join(" · "));
}

/** How the subscription ended, or `undefined` while it has not. */
export function terminationText(
  subscription: EventSubscription,
): string | undefined {
  const { termination } = subscription;
  if (!termination) return undefined;
  const relist =
    termination.relist === "pending"
      ? "; re-listing event types…"
      : termination.relist === "failed"
        ? "; re-listing failed"
        : termination.relist === "done" && !termination.canResubscribe
          ? "; the event type is no longer offered"
          : "";
  return escapeControls(
    `Terminated (${termination.reason}): ${redactErrorText(termination.error.message)}${relist}`,
  );
}

export interface LogLine {
  text: string;
  color?: string;
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Escape every C0 and C1 control character (and DEL) as `\\uXXXX`. Applied to
 * each finished log line, because server text reaches it unescaped — an event
 * id, a cursor, an error message — and `JSON.stringify` escapes only C0, so a
 * C1 such as U+009B (CSI) in a payload passes through it. A backslash already
 * in the text is left alone, so the JSON's own escapes read the same.
 */
export function escapeControls(text: string): string {
  return text.replace(
    CONTROLS,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function clock(at: Date): string {
  return at.toISOString().slice(11, 19);
}

/** One occurrence-log entry as a single display line, controls escaped. */
export function eventLogLine(entry: EventLogEntry): LogLine {
  const line = rawLogLine(entry);
  return { ...line, text: escapeControls(line.text) };
}

function rawLogLine(entry: EventLogEntry): LogLine {
  const time = clock(entry.at);
  switch (entry.kind) {
    case "event": {
      // The engine's recorded verdict, not the absence of an error: an
      // `unchecked` payload (no schema, validation off, a schema that would
      // not compile) is said so rather than passing as valid (#3030).
      const head = `${time} ${entry.occurrence.eventId} ${JSON.stringify(entry.occurrence.data)}`;
      if (entry.payload === "invalid") {
        return {
          text: `${head} — payload does not match its schema: ${entry.payloadError ?? ""}`,
          color: "yellow",
        };
      }
      return entry.payload === "unchecked"
        ? { text: `${head} (payload not checked)` }
        : { text: head };
    }
    case "gap":
      return {
        text: `${time} gap: some events were no longer retained (resuming at cursor ${cursorText(entry.cursor)})`,
        color: "yellow",
      };
    case "error":
      return {
        text: `${time} error ${entry.error.code}: ${redactErrorText(entry.error.message)}`,
        color: "red",
      };
    case "reconnect":
      return { text: `${time} reconnecting: ${entry.reason}`, color: "gray" };
    case "terminated":
      return {
        text: `${time} terminated (${entry.reason}): ${redactErrorText(entry.error.message)}`,
        color: "red",
      };
  }
}

/**
 * The rows the Events tab lists: the server's current event types, then any
 * type a subscription still refers to that the catalog no longer has — a type
 * the server removed, which is exactly when its termination and log matter
 * most. `listed` is false for those; they cannot be subscribed to again.
 */
export function eventTypeRows(
  eventTypes: EventType[],
  subscriptions: EventSubscription[],
): { eventType: EventType; listed: boolean }[] {
  const names = new Set(eventTypes.map((eventType) => eventType.name));
  const rows = eventTypes.map((eventType) => ({ eventType, listed: true }));
  for (const subscription of subscriptions) {
    if (names.has(subscription.name)) continue;
    names.add(subscription.name);
    rows.push({ eventType: subscription.eventType, listed: false });
  }
  return rows;
}
