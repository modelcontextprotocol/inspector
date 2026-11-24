/**
 * Pure helpers behind the Events tab (SEP-3415, #3030): which delivery modes
 * the tab can subscribe with, how the subscribe form's fields become engine
 * options, and how cursors, intervals and log entries read in the UI.
 *
 * **The subscribable modes are the seam for webhook management (#3031).** The
 * subscription engine runs `poll` and `push`; `webhook` is managed by a later
 * phase. {@link SUBSCRIBABLE_DELIVERY_MODES} is the one list the mode picker is
 * built from, so offering webhook is adding it here plus the form fields it
 * needs, not finding every place the picker filters. An event type that
 * advertises only webhook still lists, with its badge, and says why it cannot
 * be subscribed to yet.
 */

import { convertParametersForSchema } from "@inspector/core/json/jsonUtils.js";
import {
  MCP_PARAM_HEADER_PREFIX,
  scanXMcpHeaderDeclarations,
} from "@inspector/core/json/xMcpHeader.js";
import { eventsErrorName } from "@inspector/core/extension/events/constants.js";
import type { EventsErrorInfo } from "@inspector/core/extension/events/termination.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import { knownDeliveryModes } from "@inspector/core/extension/events/schemas.js";
import type {
  EventLogEntry,
  EventSubscribeOptions,
  EventSubscription,
  EventSubscriptionMode,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";

/** The modes the Events tab can subscribe with today, in picker order. */
export const SUBSCRIBABLE_DELIVERY_MODES: readonly EventSubscriptionMode[] = [
  "poll",
  "push",
];

/** The subscribable modes `eventType` advertises, in the server's order. */
export function subscribableModes(
  eventType: EventType,
): EventSubscriptionMode[] {
  const offered: ReadonlySet<string> = new Set(SUBSCRIBABLE_DELIVERY_MODES);
  return knownDeliveryModes(eventType).filter(
    (mode): mode is EventSubscriptionMode => offered.has(mode),
  );
}

/**
 * The mode the form should show: the user's pick when this type offers it,
 * otherwise the first one it does, or `undefined` when it offers none.
 */
export function resolveSubscribeMode(
  eventType: EventType,
  preferred: EventSubscriptionMode | undefined,
): EventSubscriptionMode | undefined {
  const modes = subscribableModes(eventType);
  if (preferred !== undefined && modes.includes(preferred)) return preferred;
  return modes[0];
}

/** The subscribe form's numeric fields, as the screen holds them. */
export interface SubscribeTuning {
  maxAgeMs?: number;
  maxEvents?: number;
  heartbeatMs?: number;
}

/**
 * The engine options for a subscribe: the arguments, and only the tuning the
 * chosen mode accepts — `maxEvents` is a poll parameter and `heartbeatMs` a
 * push one, so neither is sent where the spec does not define it.
 */
export function buildSubscribeOptions(
  mode: EventSubscriptionMode,
  args: Record<string, unknown>,
  tuning: SubscribeTuning,
): EventSubscribeOptions {
  return {
    mode,
    arguments: args,
    ...(tuning.maxAgeMs !== undefined && { maxAgeMs: tuning.maxAgeMs }),
    ...(mode === "poll" &&
      tuning.maxEvents !== undefined && { maxEvents: tuning.maxEvents }),
    ...(mode === "push" &&
      tuning.heartbeatMs !== undefined && { heartbeatMs: tuning.heartbeatMs }),
  };
}

/**
 * The form's values as the `arguments` a subscription is sent with.
 *
 * Two things differ from the raw form state, both because a subscription's
 * arguments are a **filter**: an empty field is dropped rather than sent as
 * `""` (which would filter on the empty string, and — for an `x-mcp-header`
 * argument — send an empty `Mcp-Param-*` header); and a string a widget handed
 * over for a typed field is converted to the declared type, by the same
 * conversion `tools/call` arguments go through (`convertParametersForSchema`),
 * so `"3"` for an integer is sent as `3`.
 */
export function eventArguments(
  inputSchema: Record<string, unknown>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const present: Record<string, unknown> = {};
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    present[key] = value;
    if (typeof value === "string") strings[key] = value;
  }
  return { ...present, ...convertParametersForSchema(inputSchema, strings) };
}

/**
 * A Mantine `NumberInput` value as an optional whole number: its `onChange`
 * hands back a string while the field is empty or mid-edit, which means "not
 * set" here rather than zero.
 */
export function optionalWholeNumber(
  value: number | string,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

/** One argument mirrored into an `Mcp-Param-*` request header. */
export interface MirroredEventHeader {
  /** The argument's dotted path in `arguments`. */
  path: string;
  /** The full header name, e.g. `Mcp-Param-Region`. */
  header: string;
}

/**
 * The `Mcp-Param-*` headers an event type's arguments mirror into (SEP-2243,
 * applied to `events/*` by SEP-3415). Empty for an invalid annotation set — a
 * type carrying one is excluded from the list before it reaches the tab.
 */
export function mirroredEventHeaders(
  eventType: EventType,
): MirroredEventHeader[] {
  const scan = scanXMcpHeaderDeclarations(eventType.inputSchema);
  if (!scan.valid) return [];
  return scan.declarations.map((declaration) => ({
    path: declaration.path.join("."),
    header: `${MCP_PARAM_HEADER_PREFIX}${declaration.headerName}`,
  }));
}

/** Event types matching `query` (name or description), sorted by name. */
export function filterEventTypes(
  eventTypes: EventType[],
  query: string,
): EventType[] {
  const needle = query.trim().toLowerCase();
  return eventTypes
    .filter(
      (eventType) =>
        needle === "" ||
        eventType.name.toLowerCase().includes(needle) ||
        (eventType.description?.toLowerCase().includes(needle) ?? false),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A cursor as the UI shows it. `null` is a real state with a meaning of its
 * own ("start from now" / nothing to resume from), not an empty string.
 */
export function formatCursor(cursor: string | null): string {
  return cursor === null ? "none (from now)" : cursor;
}

/** A millisecond interval for a status line: `750 ms`, `30 s`, `1.5 min`. */
export function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`;
  return `${Number((ms / 60_000).toFixed(1))} min`;
}

/**
 * The interval a subscription's status line reports: the heartbeat the server
 * granted a push stream, or the `nextPollMs` it last recommended to a poll.
 * `undefined` until the server has said.
 */
export function subscriptionInterval(
  subscription: EventSubscription,
): { label: string; ms: number } | undefined {
  if (
    subscription.mode === "push" &&
    subscription.grantedHeartbeatMs !== undefined
  ) {
    return { label: "Heartbeat", ms: subscription.grantedHeartbeatMs };
  }
  if (subscription.mode === "poll" && subscription.nextPollMs !== undefined) {
    return { label: "Next poll", ms: subscription.nextPollMs };
  }
  return undefined;
}

/**
 * Whether a subscription is running (a stop is meaningful) as opposed to
 * stopped or terminated (a resume or a remove is).
 */
export function isSubscriptionLive(subscription: EventSubscription): boolean {
  return (
    subscription.status === "starting" ||
    subscription.status === "active" ||
    subscription.status === "reconnecting"
  );
}

/**
 * Whether the user can start a non-live subscription again. A termination is
 * resumable only when the engine offered it (a re-list still lists the type in
 * this mode); a user stop always is.
 */
export function canResumeSubscription(
  subscription: EventSubscription,
): boolean {
  if (isSubscriptionLive(subscription)) return false;
  return subscription.termination?.canResubscribe ?? true;
}

/** A subscription's arguments, compact, for a card or a log line. */
export function formatSubscriptionArguments(
  args: Record<string, unknown>,
): string {
  return Object.keys(args).length === 0 ? "no arguments" : JSON.stringify(args);
}

/**
 * The occurrence payload as inert, indented JSON text. Payloads are untrusted
 * (spec, Security), so the log never renders them as anything but text.
 */
export function formatPayload(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}

/** The log entries to show: every subscription's, or one's. */
export function filterEventLog(
  log: EventLogEntry[],
  subscriptionId: string | undefined,
): EventLogEntry[] {
  return subscriptionId === undefined
    ? log
    : log.filter((entry) => entry.subscription === subscriptionId);
}

/**
 * An Events error as one line: `-32023 NotFound: message`, with the spec name
 * when the code is one SEP-3415 defines and the bare code otherwise.
 */
export function describeEventsError(error: EventsErrorInfo): string {
  const name = eventsErrorName(error.code);
  return `${error.code}${name ? ` ${name}` : ""}: ${error.message}`;
}
