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
  return parts.join(" · ");
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
  return `Terminated (${termination.reason}): ${redactErrorText(termination.error.message)}${relist}`;
}

export interface LogLine {
  text: string;
  color?: string;
}

function clock(at: Date): string {
  return at.toISOString().slice(11, 19);
}

/** One occurrence-log entry as a single display line. */
export function eventLogLine(entry: EventLogEntry): LogLine {
  const time = clock(entry.at);
  switch (entry.kind) {
    case "event":
      return entry.payloadError === undefined
        ? {
            text: `${time} ${entry.occurrence.eventId} ${JSON.stringify(entry.occurrence.data)}`,
          }
        : {
            text: `${time} ${entry.occurrence.eventId} ${JSON.stringify(entry.occurrence.data)} — payload does not match its schema: ${entry.payloadError}`,
            color: "yellow",
          };
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
