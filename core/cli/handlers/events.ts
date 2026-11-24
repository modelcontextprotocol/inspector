/**
 * The Events extension (`io.modelcontextprotocol/events`, SEP-3415) for the
 * Node runners: the one-shot CLI's `events/list` and `events/poll`, and the
 * connection CLI's `events/stream` (#3032).
 *
 * Shared here rather than written once per client because both clients reach
 * `runMethod`, and the decisions in this file are what a script sees: which
 * failures are usage errors, what an `events/list` result carries, and what one
 * NDJSON line of a push stream looks like.
 *
 * **Nothing here re-implements the protocol.** The wire calls are
 * `InspectorClient`'s (`listAllEvents`, `pollEvents`), and the push stream runs
 * on the shared subscription engine (`EventSubscriptionsState`), so routing by
 * subscription id, `eventId` dedup, payload validation, the heartbeat liveness
 * check and reconnect-from-cursor are the same code the TUI and the web client
 * run. What this module adds is the CLI's framing of them.
 */

import type { InspectorClient, JsonValue } from "../../mcp/index.js";
import type { RequestMetadata } from "../../mcp/types.js";
import {
  EventSubscriptionsState,
  type EventLogEntry,
  type EventSubscription,
  type EventSubscriptionsStateEventMap,
} from "../../mcp/state/eventSubscriptionsState.js";
import type { TypedEventGeneric } from "../../mcp/typedEventTarget.js";
import { EVENTS_EXTENSION_KEY } from "../../extension/events/constants.js";
import { eventSubscriptionKey } from "../../extension/events/canonicalJson.js";
import {
  knownDeliveryModes,
  type EventType,
} from "../../extension/events/schemas.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { McpResponse, MethodOutcome } from "./method-types.js";

/**
 * Refuse an `events/*` method against a connection that does not offer the
 * extension — a server that never advertised it, or a legacy-era connection
 * (the extension is defined for 2026-07-28 and later only).
 *
 * Checked here as a usage error rather than left to `InspectorClient`'s own
 * gate, for the reason `skills/*` gives: "this server has no event types" and
 * "this connection cannot carry Events at all" are different answers a script
 * has to tell apart, and the client's gate throws a plain error that reads as a
 * failed request.
 */
export function assertEventsSupported(
  client: InspectorClient,
  method: string,
): void {
  if (!client.getEventsExtension()) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      `Server does not offer the ${EVENTS_EXTENSION_KEY} extension on this connection, so ${method} is not available. The extension needs a modern-era connection (--protocol-era modern) to a server that advertises it.`,
      { code: "events_unsupported" },
    );
  }
}

/**
 * The `events/list` result: every page walked, plus the event types the client
 * left out for an invalid `x-mcp-header` annotation, each with its reason.
 *
 * `excluded` is always present (an empty array when nothing was dropped) so a
 * script reads one shape. Without it, a type the server listed and the client
 * refused would simply be missing, and "the server does not have it" would be
 * the only reading available.
 */
export async function listEventsResult(
  client: InspectorClient,
  metadata?: RequestMetadata,
): Promise<McpResponse> {
  const { events } = await client.listAllEvents({ metadata });
  const excluded = client.getExcludedEventTypes().map((entry) => ({
    name: entry.eventType.name,
    reason: entry.reason,
  }));
  return { events, excluded };
}

/**
 * Find the named event type, checking it advertises `mode`.
 *
 * A poll or stream needs the descriptor, not just the name: the `Mcp-Param-*`
 * headers are derived from its `inputSchema` annotations. A type the client
 * excluded for an invalid annotation is reported as such rather than as
 * unknown, since the server does list it.
 */
export async function resolveEventType(
  client: InspectorClient,
  name: string | undefined,
  mode: "poll" | "push",
  method: string,
  metadata?: RequestMetadata,
): Promise<EventType> {
  if (!name) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      `Event type name is required for ${method}. Use --event-name to specify it.`,
      { code: "usage" },
    );
  }
  const { events } = await client.listAllEvents({ metadata });
  const eventType = events.find((candidate) => candidate.name === name);
  if (!eventType) {
    const excluded = client
      .getExcludedEventTypes()
      .find((entry) => entry.eventType.name === name);
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      excluded
        ? `Event type '${name}' was excluded from events/list: ${excluded.reason}`
        : `Event type '${name}' not found on server.`,
      { code: "event_type_not_found" },
    );
  }
  if (!knownDeliveryModes(eventType).includes(mode)) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      `Event type '${name}' does not advertise ${mode} delivery (it offers: ${eventType.delivery.join(", ")}).`,
      { code: "delivery_mode_unsupported" },
    );
  }
  return eventType;
}

/**
 * One NDJSON line of `events/stream` for a log entry of the subscription
 * engine. `type` is the entry's kind; the bookkeeping fields (`seq`, the
 * registry key) are dropped, since they mean nothing outside the store.
 *
 * An occurrence's `data` is passed through as the server sent it — JSON in,
 * JSON out, never interpreted (spec, Security: payloads are untrusted).
 */
export function eventStreamLine(entry: EventLogEntry): Record<string, unknown> {
  const at = entry.at.toISOString();
  switch (entry.kind) {
    case "event":
      // The occurrence is spread first so the Inspector-owned fields win:
      // `EventOccurrenceSchema` is loose, so a server-sent `type`, `at` or
      // `payloadError` survives parsing and would otherwise relabel the line.
      return {
        ...entry.occurrence,
        type: "event",
        // Always the engine's verdict: a server-sent `payloadError` on a valid
        // occurrence must not read as an Inspector diagnostic. `undefined` is
        // dropped when the line is serialized.
        payloadError: entry.payloadError,
        at,
      };
    case "gap":
      return { type: "gap", cursor: entry.cursor, at };
    case "error":
      return { type: "error", error: entry.error, at };
    case "reconnect":
      return { type: "reconnect", reason: entry.reason, at };
    case "terminated":
      return {
        type: "terminated",
        reason: entry.reason,
        error: entry.error,
        at,
      };
  }
}

/** The line written when the stream is confirmed (`notifications/events/active`). */
function activeLine(subscription: EventSubscription): Record<string, unknown> {
  return {
    type: "active",
    name: subscription.name,
    cursor: subscription.cursor,
    ...(subscription.grantedHeartbeatMs !== undefined && {
      heartbeatMs: subscription.grantedHeartbeatMs,
    }),
  };
}

/**
 * `events/stream`: one push subscription on the subscription engine, written
 * as NDJSON until the caller stops it or the server terminates it.
 *
 * Lines, in the order they can arrive:
 *
 * - `subscribed` — written once, as the stream is requested;
 * - `active` — each time the server confirms the stream (again after a
 *   reconnect), with the cursor and the granted heartbeat;
 * - `event`, `gap`, `error`, `reconnect` — the engine's log, as it happens;
 * - `terminated` — the server ended the subscription. It is the last line: the
 *   stream ends after it (through `end`), so a script reading to EOF learns
 *   that it is over rather than waiting forever on a subscription that cannot
 *   deliver again.
 *
 * The engine is created in `start` and destroyed by the returned stop, so its
 * stream lives exactly as long as the caller is attached.
 */
export function eventsStreamOutcome(
  client: InspectorClient,
  eventType: EventType,
  args: { arguments?: Record<string, JsonValue>; cursor?: string },
): MethodOutcome {
  return {
    kind: "stream",
    label: "events/stream",
    start: (writeLine, end) => {
      const engine = new EventSubscriptionsState(client);
      const eventArgs = args.arguments ?? {};
      // The registry key, known before subscribing, so no report can arrive
      // for this subscription before the listeners can recognise it.
      const subscriptionId = eventSubscriptionKey(
        eventType.name,
        eventArgs,
        "push",
      );
      let closed = false;
      let wasActive = false;
      const stop = (): void => {
        if (closed) return;
        closed = true;
        engine.removeEventListener("logEntry", onEntry);
        engine.removeEventListener("subscriptionsChange", onSubscriptions);
        engine.destroy();
      };
      const onEntry = (
        event: TypedEventGeneric<EventSubscriptionsStateEventMap, "logEntry">,
      ): void => {
        const entry = event.detail;
        writeLine(eventStreamLine(entry));
        if (entry.kind === "terminated") {
          stop();
          end?.();
        }
      };
      const onSubscriptions = (
        event: TypedEventGeneric<
          EventSubscriptionsStateEventMap,
          "subscriptionsChange"
        >,
      ): void => {
        const current = event.detail.find((s) => s.id === subscriptionId);
        const active = current?.status === "active";
        if (current && active && !wasActive) writeLine(activeLine(current));
        wasActive = active;
      };
      engine.addEventListener("logEntry", onEntry);
      engine.addEventListener("subscriptionsChange", onSubscriptions);
      writeLine({
        type: "subscribed",
        name: eventType.name,
        mode: "push",
        arguments: eventArgs,
      });
      try {
        engine.subscribe(eventType, {
          mode: "push",
          arguments: eventArgs,
          // Omitted → the engine's `null` ("start from now").
          ...(args.cursor !== undefined && { cursor: args.cursor }),
        });
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    },
  };
}
