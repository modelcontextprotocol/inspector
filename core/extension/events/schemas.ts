/**
 * Events extension wire schemas (`io.modelcontextprotocol/events`, SEP-3415).
 *
 * The SDK has no Events API, so the Inspector sends every `events/*` request
 * itself through `client.request(…, Schema)`, the way Skills did before its SDK
 * support landed. These are the schemas it decodes with. The spec text they
 * follow is the Beta `events.mdx`.
 *
 * **Permissive where a defect should be shown, strict where the client acts on
 * the value.** Every object is a `looseObject`, so a server that adds a field
 * the Beta does not define is not refused. `delivery` is an array of strings
 * rather than of the three known modes: an event type advertising a mode this
 * client does not know is still worth listing (see {@link knownDeliveryModes}),
 * and refusing the parse would hide the whole list. The fields a subscription
 * engine branches on (`cursor`, `hasMore`, `nextPollMs`, `heartbeatMs`, the
 * subscription id) are typed exactly, because a wrong type there is a server bug
 * to surface as a decode failure rather than to guess around.
 *
 * **`cursor` is nullable and optional everywhere** — the spec's "absent means
 * `null`" rule. {@link normalizeCursor} folds the two into `null` so a consumer
 * never branches on the difference.
 *
 * **`resultType` is not modelled.** On a modern connection the SDK codec checks
 * `resultType: "complete"` and removes it before a caller's schema runs (#2373),
 * and this extension exists only on modern connections.
 */

import { z } from "zod/v4";
import {
  EVENT_DELIVERY_MODES,
  EVENTS_SUBSCRIPTION_ID_META_KEY,
  type EventDeliveryMode,
} from "./constants.js";

/** A JSON-RPC request id, as echoed in a push notification's `_meta`. */
const RequestIdSchema = z.union([z.string(), z.number()]);

/** Opaque subscription position; absent is the same as `null`. */
export const EventCursorSchema = z.string().nullable().optional();

/** A JSON Schema object (`inputSchema`, `payloadSchema`). */
const JsonSchemaObjectSchema = z.record(z.string(), z.unknown());

/** `_meta`, same semantics as on Tool/Resource/Prompt. */
const MetaSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// events/list
// ---------------------------------------------------------------------------

/** One event type as `events/list` describes it. */
export const EventTypeSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  /** Any non-empty subset of the delivery modes; unknown modes are kept. */
  delivery: z.array(z.string()).min(1),
  inputSchema: JsonSchemaObjectSchema,
  payloadSchema: JsonSchemaObjectSchema.optional(),
  _meta: MetaSchema.optional(),
});
export type EventType = z.infer<typeof EventTypeSchema>;

export const ListEventsResultSchema = z.looseObject({
  events: z.array(EventTypeSchema),
  nextCursor: z.string().optional(),
  _meta: MetaSchema.optional(),
});
export type ListEventsResult = z.infer<typeof ListEventsResultSchema>;

/** The modes in `delivery` this client knows, in the server's order. */
export function knownDeliveryModes(eventType: EventType): EventDeliveryMode[] {
  const known: ReadonlySet<string> = new Set(EVENT_DELIVERY_MODES);
  return eventType.delivery.filter((mode): mode is EventDeliveryMode =>
    known.has(mode),
  );
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

/**
 * One event occurrence: an entry of a poll result's `events`, the params of
 * `notifications/events/event`, or a webhook delivery body. `data` conforms to
 * the event type's `payloadSchema` and is untrusted (spec, Security).
 */
export const EventOccurrenceSchema = z.looseObject({
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()),
  cursor: EventCursorSchema,
  _meta: MetaSchema.optional(),
});
export type EventOccurrence = z.infer<typeof EventOccurrenceSchema>;

// ---------------------------------------------------------------------------
// Request params (outbound — typed for the caller, not parsed)
// ---------------------------------------------------------------------------

/** Fields every subscription request shares: which event, and with what. */
export interface EventSubscriptionKey {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface PollEventsParams extends EventSubscriptionKey {
  cursor?: string | null;
  maxAgeMs?: number;
  maxEvents?: number;
}

export interface StreamEventsParams extends EventSubscriptionKey {
  cursor?: string | null;
  maxAgeMs?: number;
  heartbeatMs?: number;
}

export interface WebhookDelivery {
  mode: "webhook";
  url: string;
  secret: string;
}

export interface SubscribeEventsParams extends EventSubscriptionKey {
  delivery: WebhookDelivery;
  cursor?: string | null;
  maxAgeMs?: number;
  /** Omitted = server default; `null` = request no expiry. */
  ttlMs?: number | null;
}

export interface UnsubscribeEventsParams extends EventSubscriptionKey {
  delivery: { url: string };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const PollEventsResultSchema = z.looseObject({
  events: z.array(EventOccurrenceSchema),
  cursor: EventCursorSchema,
  truncated: z.boolean(),
  hasMore: z.boolean(),
  nextPollMs: z.number().int().nonnegative(),
  _meta: MetaSchema.optional(),
});
export type PollEventsResult = z.infer<typeof PollEventsResultSchema>;

/** The final frame of a push stream: empty but for the subscription id. */
export const StreamEventsResultSchema = z.looseObject({
  _meta: MetaSchema.optional(),
});
export type StreamEventsResult = z.infer<typeof StreamEventsResultSchema>;

/** The `lastError` categories a webhook delivery status may name. */
export const WEBHOOK_ERROR_CATEGORIES = [
  "connection_refused",
  "timeout",
  "tls_error",
  "http_4xx",
  "http_5xx",
  "challenge_failed",
] as const;

export const DeliveryStatusSchema = z.looseObject({
  active: z.boolean(),
  lastDeliveryAt: z.string().nullable().optional(),
  /** A category string; kept as a string so an unknown one is shown, not refused. */
  lastError: z.string().nullable().optional(),
  failedSince: z.string().nullable().optional(),
  throttled: z.boolean().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const SubscribeEventsResultSchema = z.looseObject({
  id: z.string(),
  /** ISO 8601 expiry, or `null` for no expiry. Always present. */
  refreshBefore: z.string().nullable(),
  cursor: EventCursorSchema,
  truncated: z.boolean(),
  deliveryStatus: DeliveryStatusSchema.optional(),
  _meta: MetaSchema.optional(),
});
export type SubscribeEventsResult = z.infer<typeof SubscribeEventsResultSchema>;

/** `events/unsubscribe` returns an empty result. */
export const UnsubscribeEventsResultSchema = z.looseObject({
  _meta: MetaSchema.optional(),
});

// ---------------------------------------------------------------------------
// Notifications (params)
// ---------------------------------------------------------------------------

/** `_meta` on a push-stream notification: carries the subscription id. */
const SubscriptionMetaSchema = z.looseObject({
  [EVENTS_SUBSCRIPTION_ID_META_KEY]: RequestIdSchema,
});

/** The nested error shared by `notifications/events/{error,terminated}`. */
export const EventsErrorObjectSchema = z.looseObject({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const EventsActiveNotificationParamsSchema = z.looseObject({
  cursor: EventCursorSchema,
  truncated: z.boolean(),
  heartbeatMs: z.number().int().positive(),
  _meta: SubscriptionMetaSchema,
});

export const EventsEventNotificationParamsSchema = EventOccurrenceSchema.extend(
  { _meta: SubscriptionMetaSchema },
);

export const EventsHeartbeatNotificationParamsSchema = z.looseObject({
  cursor: EventCursorSchema,
  _meta: SubscriptionMetaSchema,
});

export const EventsErrorNotificationParamsSchema = z.looseObject({
  error: EventsErrorObjectSchema,
  _meta: SubscriptionMetaSchema,
});

export const EventsTerminatedNotificationParamsSchema =
  EventsErrorNotificationParamsSchema;

/** `notifications/events/list_changed` carries nothing but optional `_meta`. */
export const EventsListChangedNotificationParamsSchema = z
  .looseObject({ _meta: MetaSchema.optional() })
  .optional();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fold an absent cursor into `null` (spec: absent means `null`). */
export function normalizeCursor(
  cursor: string | null | undefined,
): string | null {
  return cursor ?? null;
}

/**
 * The subscription id a push notification's params carry, or `undefined` when
 * they carry none (a notification that cannot be routed to a stream).
 */
export function subscriptionIdOf(params: unknown): string | number | undefined {
  if (params === null || typeof params !== "object") return undefined;
  const meta = (params as { _meta?: unknown })._meta;
  if (meta === null || typeof meta !== "object") return undefined;
  const id = (meta as Record<string, unknown>)[EVENTS_SUBSCRIPTION_ID_META_KEY];
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}
