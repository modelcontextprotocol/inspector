/**
 * Events extension identifiers (`io.modelcontextprotocol/events`, SEP-3415).
 *
 * **Restated here, not re-exported, because nothing upstream owns them yet.**
 * The Tasks and Skills constants are re-exported from their SDK packages so a
 * spec revision lands with a dependency bump. There is no ext-events package and
 * `@modelcontextprotocol/client` has no Events API, so this module is the single
 * owner of every string the extension adds. When an upstream package lands, these
 * become re-exports and the SDK watch (`scripts/sdk-watch.mjs`) gains a group for
 * it (#3026).
 *
 * Everything here is a plain value: no I/O, no SDK runtime, safe in the browser
 * bundle and in the CLI alike.
 */

/** The extension identifier, a key in `capabilities.extensions` (SEP-2133). */
export const EVENTS_EXTENSION_KEY = "io.modelcontextprotocol/events";

/**
 * The `_meta` key every `notifications/events/*` message on a push stream carries,
 * holding the JSON-RPC id of its parent `events/stream` request. It is the core
 * protocol's subscription-stream correlation key, so it is the same string the SDK
 * exports as `SUBSCRIPTION_ID_META_KEY`; a test pins the two together.
 */
export const EVENTS_SUBSCRIPTION_ID_META_KEY =
  "io.modelcontextprotocol/subscriptionId";

/** The request methods the extension defines. All are client-initiated. */
export const EVENTS_LIST_METHOD = "events/list";
export const EVENTS_POLL_METHOD = "events/poll";
export const EVENTS_STREAM_METHOD = "events/stream";
export const EVENTS_SUBSCRIBE_METHOD = "events/subscribe";
export const EVENTS_UNSUBSCRIBE_METHOD = "events/unsubscribe";

/** The notification methods the extension defines. All are server-to-client. */
export const EVENTS_LIST_CHANGED_NOTIFICATION =
  "notifications/events/list_changed";
export const EVENTS_ACTIVE_NOTIFICATION = "notifications/events/active";
export const EVENTS_EVENT_NOTIFICATION = "notifications/events/event";
export const EVENTS_HEARTBEAT_NOTIFICATION = "notifications/events/heartbeat";
export const EVENTS_ERROR_NOTIFICATION = "notifications/events/error";
export const EVENTS_TERMINATED_NOTIFICATION = "notifications/events/terminated";

/**
 * The notifications a push stream (`events/stream`) carries, each tagged with
 * its stream's subscription id. `list_changed` is not one of them: it arrives
 * on the `subscriptions/listen` stream instead.
 */
export const EVENTS_STREAM_NOTIFICATIONS = [
  EVENTS_ACTIVE_NOTIFICATION,
  EVENTS_EVENT_NOTIFICATION,
  EVENTS_HEARTBEAT_NOTIFICATION,
  EVENTS_ERROR_NOTIFICATION,
  EVENTS_TERMINATED_NOTIFICATION,
] as const;
export type EventsStreamNotificationMethod =
  (typeof EVENTS_STREAM_NOTIFICATIONS)[number];

/** The method prefix the extension reserves (spec, Reservations). */
export const EVENTS_METHOD_PREFIX = "events/";

/**
 * The requests that carry `Mcp-Name` (= `params.name`) and the `Mcp-Param-*`
 * headers on Streamable HTTP — every `events/*` request except `events/list`,
 * which has no `params.name` (spec, Streamable HTTP: Routing Headers).
 */
export const EVENTS_NAMED_METHODS: ReadonlySet<string> = new Set([
  EVENTS_POLL_METHOD,
  EVENTS_STREAM_METHOD,
  EVENTS_SUBSCRIBE_METHOD,
  EVENTS_UNSUBSCRIBE_METHOD,
]);

/** The `subscriptions/listen` filter field this extension adds. */
export const EVENTS_LIST_CHANGED_FILTER_KEY = "eventsListChanged";

/** The three delivery modes an event type may advertise. */
export const EVENT_DELIVERY_MODES = ["poll", "push", "webhook"] as const;
export type EventDeliveryMode = (typeof EVENT_DELIVERY_MODES)[number];

/**
 * The general-purpose error codes SEP-3415 allocates (spec, Error Handling).
 * They are named for reuse across MCP rather than scoped to events, which is why
 * the Protocol tab names them wherever they appear, not only on `events/*`.
 */
export const EVENTS_ERROR_CODES = {
  NotFound: -32023,
  Forbidden: -32024,
  ResourceExhausted: -32025,
  Unsupported: -32026,
  CallbackEndpointError: -32027,
} as const;

export type EventsErrorName = keyof typeof EVENTS_ERROR_CODES;

/** Display name and one-line meaning for each code, keyed by the number. */
export const EVENTS_ERROR_META: Readonly<
  Record<number, { name: EventsErrorName; description: string }>
> = {
  [EVENTS_ERROR_CODES.NotFound]: {
    name: "NotFound",
    description:
      "A referenced entity does not exist: an unknown event name, or no subscription matching the key. data.kind may say which.",
  },
  [EVENTS_ERROR_CODES.Forbidden]: {
    name: "Forbidden",
    description:
      "The authenticated principal is not permitted for this event and arguments, or its access was revoked.",
  },
  [EVENTS_ERROR_CODES.ResourceExhausted]: {
    name: "ResourceExhausted",
    description:
      "A server-imposed limit or quota was reached. data.limit names it, and data.max may give the ceiling.",
  },
  [EVENTS_ERROR_CODES.Unsupported]: {
    name: "Unsupported",
    description:
      "The request is well-formed, but a requested capability or option is not supported here. data identifies it.",
  },
  [EVENTS_ERROR_CODES.CallbackEndpointError]: {
    name: "CallbackEndpointError",
    description:
      "A webhook callback endpoint failed verification or could not be reached. data.reason is the failure category.",
  },
};

/** The spec name of one of the codes above, or `undefined` for any other code. */
export function eventsErrorName(code: number): EventsErrorName | undefined {
  return EVENTS_ERROR_META[code]?.name;
}
