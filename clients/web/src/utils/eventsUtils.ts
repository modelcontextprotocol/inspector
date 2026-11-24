/**
 * Pure helpers behind the Events tab (SEP-3415, #3030): which delivery modes
 * the tab can subscribe with, how the subscribe form's fields become engine
 * options, and how cursors, intervals and log entries read in the UI.
 *
 * {@link SUBSCRIBABLE_DELIVERY_MODES} is the one list the mode picker is built
 * from. All three modes are offered; webhook is subscription management only
 * (#3031) — the Inspector subscribes, refreshes and unsubscribes, and shows
 * the `deliveryStatus` the server reports, but never receives a delivery.
 */

import { convertParametersForSchema } from "@inspector/core/json/jsonUtils.js";
import {
  MCP_PARAM_HEADER_PREFIX,
  scanXMcpHeaderDeclarations,
} from "@inspector/core/json/xMcpHeader.js";
import {
  EVENTS_ERROR_CODES,
  eventsErrorName,
} from "@inspector/core/extension/events/constants.js";
import type { EventsErrorInfo } from "@inspector/core/extension/events/termination.js";
import type {
  DeliveryStatus,
  EventType,
} from "@inspector/core/extension/events/schemas.js";
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
  "webhook",
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

/**
 * The subscribe form's option fields, as the screen holds them. The webhook
 * signing secret is deliberately not one of them: this object is lifted to App
 * and snapshotted into `sessionStorage` across an OAuth redirect, and the
 * secret must never be written anywhere (#3031).
 */
export interface SubscribeTuning {
  maxAgeMs?: number;
  maxEvents?: number;
  heartbeatMs?: number;
  /** Webhook: where the server should POST deliveries. */
  callbackUrl?: string;
  /** Webhook: suggested lifetime; ignored while {@link noExpiry} is set. */
  ttlMs?: number;
  /** Webhook: ask for no expiry (`ttlMs: null`). */
  noExpiry?: boolean;
}

/**
 * The engine options for a subscribe: the arguments, and only the tuning the
 * chosen mode accepts — `maxEvents` is a poll parameter, `heartbeatMs` a push
 * one, and the callback URL, secret and TTL webhook ones, so none is sent
 * where the spec does not define it. A webhook `ttlMs` is sent only when set:
 * absent asks for the server's default, and `null` (no expiry) is a request of
 * its own.
 */
export function buildSubscribeOptions(
  mode: EventSubscriptionMode,
  args: Record<string, unknown>,
  tuning: SubscribeTuning,
  webhookSecret?: string,
): EventSubscribeOptions {
  const ttlMs = tuning.noExpiry ? null : tuning.ttlMs;
  return {
    mode,
    arguments: args,
    ...(tuning.maxAgeMs !== undefined && { maxAgeMs: tuning.maxAgeMs }),
    ...(mode === "poll" &&
      tuning.maxEvents !== undefined && { maxEvents: tuning.maxEvents }),
    ...(mode === "push" &&
      tuning.heartbeatMs !== undefined && { heartbeatMs: tuning.heartbeatMs }),
    ...(mode === "webhook" && {
      webhook: {
        url: (tuning.callbackUrl ?? "").trim(),
        ...(webhookSecret !== undefined && { secret: webhookSecret }),
        ...(ttlMs !== undefined && { ttlMs }),
      },
    }),
  };
}

/**
 * Why a callback URL cannot be subscribed with, or `undefined` when it can.
 * An empty field is not an error to show — just not yet subscribable — so it
 * is `undefined` here and refused by {@link isTuningValid}.
 */
export function callbackUrlError(url: string | undefined): string | undefined {
  const trimmed = (url ?? "").trim();
  if (trimmed === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Not a valid URL.";
  }
  return parsed.protocol === "https:"
    ? undefined
    : "The callback URL must use https:// (the server rejects anything else).";
}

/**
 * Whether the tuning the chosen mode sends is acceptable: a `maxEvents` (poll)
 * or `heartbeatMs` (push) below 1 is refused, since neither a batch of zero
 * nor a zero interval is something a server can honor. A restored or typed 0
 * would otherwise reach the server and end the subscription on InvalidParams.
 * A webhook needs an `https://` callback URL.
 */
export function isTuningValid(
  mode: EventSubscriptionMode | undefined,
  tuning: SubscribeTuning,
): boolean {
  if (mode === "poll") return (tuning.maxEvents ?? 1) >= 1;
  if (mode === "push") return (tuning.heartbeatMs ?? 1) >= 1;
  if (mode === "webhook") {
    return (
      (tuning.callbackUrl ?? "").trim() !== "" &&
      callbackUrlError(tuning.callbackUrl) === undefined
    );
  }
  return true;
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
  // Null-prototype collectors, so an argument named `__proto__` is an own
  // property rather than a call to the inherited setter that drops it. The
  // spread below copies own keys as data properties, so it survives that too.
  const present: Record<string, unknown> = Object.create(null);
  const strings: Record<string, string> = Object.create(null);
  // An empty string is kept for a field the schema requires (a `const: ""`
  // the form seeded, say): dropping it would send arguments that violate the
  // schema with no way for the user to correct them.
  const required = new Set(
    Array.isArray(inputSchema.required) ? inputSchema.required : [],
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || (value === "" && !required.has(key))) continue;
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
  // A webhook resubscribe waits for its in-flight unsubscribe (the engine
  // refuses it until then).
  if (subscription.webhook?.unsubscribe?.status === "pending") return false;
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

/**
 * The webhook failure categories — a `deliveryStatus.lastError`, or the
 * `data.reason` of a `CallbackEndpointError` — as a plain sentence. The spec
 * makes these the server's only report on the endpoint (never its raw
 * response), so the sentence says what to check.
 */
export const WEBHOOK_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  connection_refused:
    "the endpoint refused the connection; check that something is listening at that URL",
  timeout: "the endpoint did not answer in time",
  tls_error:
    "the TLS handshake failed; check the endpoint's certificate and hostname",
  http_4xx: "the endpoint answered with a 4xx status",
  http_5xx: "the endpoint answered with a 5xx status",
  challenge_failed:
    'the endpoint did not echo the verification challenge; it must verify the signature with this secret and answer {"challenge": "<nonce>"} in a 2xx body',
};

/** A failure category as a sentence; an unknown one is shown verbatim. */
export function describeWebhookFailure(category: string): string {
  return WEBHOOK_FAILURE_MESSAGES[category] ?? category;
}

function reasonOf(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * A webhook subscription's error, with the two the spec gives a meaning of
 * their own spelled out: `CallbackEndpointError` names the endpoint failure
 * its `data.reason` categorises, and `Forbidden` says webhook delivery needs
 * an authenticated principal (an unauthenticated server may offer poll and
 * push, but not webhook). Anything else reads as {@link describeEventsError}.
 */
export function describeWebhookError(error: EventsErrorInfo): string {
  if (error.code === EVENTS_ERROR_CODES.CallbackEndpointError) {
    const reason = reasonOf(error.data);
    return reason === undefined
      ? `${describeEventsError(error)}. The server could not verify the callback endpoint.`
      : `The server could not verify the callback endpoint (${reason}): ${describeWebhookFailure(reason)}.`;
  }
  if (error.code === EVENTS_ERROR_CODES.Forbidden) {
    return `${describeEventsError(error)}. Webhook subscriptions need an authenticated principal: connect with OAuth or a bearer token. A server may refuse webhook delivery to an unauthenticated caller while still offering poll and push.`;
  }
  return describeEventsError(error);
}

/** A grant's expiry as the card shows it: `null` is "no expiry". */
export function formatRefreshBefore(
  refreshBefore: string | null | undefined,
): string {
  if (refreshBefore === undefined) return "not granted yet";
  return refreshBefore === null ? "never (no expiry)" : refreshBefore;
}

/** The suggested TTL a webhook subscription was sent with. */
export function formatTtlSuggestion(ttlMs: number | null | undefined): string {
  if (ttlMs === undefined) return "server default";
  return ttlMs === null ? "no expiry" : formatInterval(ttlMs);
}

/**
 * A webhook `deliveryStatus` as short lines for the card: whether the server
 * is delivering, the last failure category, since when, and active
 * rate-limiting — each only when the server reported it.
 */
export function describeDeliveryStatus(status: DeliveryStatus): string[] {
  const lines = [
    status.active
      ? "Delivering"
      : "Suspended after repeated failures (this refresh reactivated it)",
  ];
  if (status.lastError) {
    lines.push(
      `Last error: ${status.lastError} — ${describeWebhookFailure(status.lastError)}`,
    );
  }
  if (status.failedSince) lines.push(`Failing since ${status.failedSince}`);
  if (status.lastDeliveryAt) {
    lines.push(`Last delivery ${status.lastDeliveryAt}`);
  }
  if (status.throttled) {
    lines.push(
      status.retryAfterMs !== undefined
        ? `Throttled: deliveries delayed, not failing (about ${formatInterval(status.retryAfterMs)})`
        : "Throttled: deliveries delayed, not failing",
    );
  }
  return lines;
}
