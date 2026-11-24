/**
 * EventSubscriptionsState: the client-owned Events subscription registry
 * (SEP-3415, #3029), UI-agnostic, in core so the web client, the TUI and mcpdo
 * share one engine.
 *
 * "The client owns all subscription state, in all three delivery modes. There
 * is no method that lists subscriptions on the server" (spec, Client-Owned
 * Subscription State). This store is that state for poll and push: which
 * subscriptions exist, the cursor each one would resume from, whether it is
 * live, and how it ended. Webhook subscription management is a later phase.
 *
 * **Identity.** A subscription is keyed by `(name, canonical-JSON arguments,
 * mode)` ({@link eventSubscriptionKey}). Subscribing again with the same three
 * returns the live subscription rather than opening a second stream; a
 * different mode for the same event and arguments is a different subscription.
 *
 * **What the store adds over the runners** (`subscriptionRunners.ts`, which own
 * the wire timing):
 *
 * - push notifications routed to their stream by `_meta.subscriptionId`;
 * - per-subscription `eventId` deduplication (the spec scopes dedup to a
 *   subscription, so the same id on two subscriptions is two deliveries), over
 *   a bounded window of recent ids;
 * - optional `payloadSchema` validation, flagged on the log entry rather than
 *   refusing the occurrence (the tool-output-validation contract);
 * - one occurrence log across every subscription, capped like the message log,
 *   which also carries the gap, error, reconnect and termination markers — so
 *   every outcome is visible, not just the happy path;
 * - termination handling: `NotFound`, `Unsupported` with `schema_changed` and
 *   `HeaderMismatch` re-list the event types and offer a resubscribe when the
 *   type is still there; `Forbidden` (and any other refusal) ends the
 *   subscription with no offer.
 *
 * **Lifetime.** Cleared on the client's `disconnect` (the session boundary the
 * other stores use): a push stream does not survive its connection, and
 * persisting subscriptions across sessions is out of scope for #3026.
 *
 * **Snapshots are immutable.** A change replaces the subscription object, so a
 * renderer can tell a changed row by identity; `subscriptionsChange` carries
 * the whole list, `logChange` the whole log and `logEntry` the newest entry.
 */

import type { jsonSchemaValidator } from "@modelcontextprotocol/client";
import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";
import { LinearPatternJsonSchemaValidator } from "../linearPatternValidator.js";
import {
  knownDeliveryModes,
  subscriptionIdOf,
  type EventOccurrence,
  type EventType,
} from "../../extension/events/schemas.js";
import { eventSubscriptionKey } from "../../extension/events/canonicalJson.js";
import {
  createEventPayloadValidator,
  type EventPayloadValidator,
} from "../../extension/events/payloadValidation.js";
import {
  classifyTermination,
  type EventsErrorInfo,
  type EventsTerminationReason,
} from "../../extension/events/termination.js";
import {
  PollRunner,
  PushRunner,
  type PushRoutes,
  type RunnerCallbacks,
  type RunnerTiming,
  type RunnerUpdate,
  type SubscriptionRunner,
} from "../../extension/events/subscriptionRunners.js";

/** The modes this engine runs. Webhook management is #3026 phase 4. */
export type EventSubscriptionMode = "poll" | "push";

/**
 * - `starting` — the first poll or stream is in flight.
 * - `active` — polling, or the stream has been confirmed by `active`.
 * - `reconnecting` — a stream died or a poll failed; waiting to try again.
 * - `terminated` — the server ended it (see `termination`).
 * - `stopped` — the user stopped it; it can be resumed from its cursor.
 */
export type EventSubscriptionStatus =
  | "starting"
  | "active"
  | "reconnecting"
  | "terminated"
  | "stopped";

/** How a subscription ended, and what the client can do about it. */
export interface EventSubscriptionTermination {
  reason: EventsTerminationReason;
  error: EventsErrorInfo;
  at: Date;
  /**
   * The re-list a contract change triggers: `pending` while `events/list` is
   * in flight, then `done` or `failed`; `skipped` when the reason calls for
   * none (`forbidden`, `rejected`).
   */
  relist: "pending" | "done" | "failed" | "skipped";
  /**
   * Whether {@link EventSubscriptionsState.resubscribe} is offered: only after
   * a re-list that still lists the type with this mode.
   */
  canResubscribe: boolean;
}

/** Per-subscription tallies, for a status line. */
export interface EventSubscriptionCounts {
  /** Occurrences delivered and logged (duplicates excluded). */
  events: number;
  /** Occurrences dropped as a repeat of an `eventId` already delivered. */
  duplicates: number;
  /** Occurrences whose `data` failed the type's `payloadSchema`. */
  invalidPayloads: number;
  gaps: number;
  errors: number;
  reconnects: number;
}

/** Options a subscription is created with; all optional but `mode`. */
export interface EventSubscribeOptions {
  mode: EventSubscriptionMode;
  arguments?: Record<string, unknown>;
  /** Where to start; default `null` ("start from now"). */
  cursor?: string | null;
  /** Bound replay to this window (spec, Cursor Lifecycle). */
  maxAgeMs?: number;
  /** Poll only: cap the events per poll. */
  maxEvents?: number;
  /** Push only: suggested heartbeat interval; the server's grant wins. */
  heartbeatMs?: number;
}

/** One subscription, as the store reports it. Replaced, never mutated. */
export interface EventSubscription {
  /** The registry key: `(name, canonical arguments, mode)`. */
  id: string;
  name: string;
  mode: EventSubscriptionMode;
  arguments: Record<string, unknown>;
  /** The descriptor it runs against (refreshed by a re-list). */
  eventType: EventType;
  maxAgeMs?: number;
  maxEvents?: number;
  heartbeatMs?: number;
  status: EventSubscriptionStatus;
  /** The position it would resume from; `null` when there is none to keep. */
  cursor: string | null;
  /** Push: the JSON-RPC id of the current `events/stream`. */
  subscriptionId?: string | number;
  /** Push: the heartbeat interval the server last granted. */
  grantedHeartbeatMs?: number;
  /** Poll: the interval the server last recommended. */
  nextPollMs?: number;
  startedAt: Date;
  lastMessageAt?: Date;
  counts: EventSubscriptionCounts;
  /** The most recent error, recoverable or not. */
  lastError?: EventsErrorInfo;
  termination?: EventSubscriptionTermination;
}

interface EventLogEntryBase {
  /** Monotonic within one store. */
  seq: number;
  at: Date;
  /** The {@link EventSubscription.id} it belongs to. */
  subscription: string;
}

/** One line of the occurrence log. `data` is untrusted: render it inert. */
export type EventLogEntry =
  | (EventLogEntryBase & {
      kind: "event";
      occurrence: EventOccurrence;
      /** Set when `data` failed the type's `payloadSchema`. */
      payloadError?: string;
    })
  | (EventLogEntryBase & { kind: "gap"; cursor: string | null })
  | (EventLogEntryBase & { kind: "error"; error: EventsErrorInfo })
  | (EventLogEntryBase & { kind: "reconnect"; reason: string })
  | (EventLogEntryBase & {
      kind: "terminated";
      reason: EventsTerminationReason;
      error: EventsErrorInfo;
    });

/** Distributes `Omit` over the log-entry union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface EventSubscriptionsStateEventMap {
  subscriptionsChange: EventSubscription[];
  logChange: EventLogEntry[];
  /** The entry just appended. */
  logEntry: EventLogEntry;
}

export interface EventSubscriptionsStateOptions extends RunnerTiming {
  /** Most log entries kept; the oldest are dropped. Default 1000, 0 = no cap. */
  maxLogEntries?: number;
  /** Recent `eventId`s remembered per subscription for dedup. Default 10000. */
  dedupWindow?: number;
  /** Validate `data` against `payloadSchema`. Default true. */
  validatePayloads?: boolean;
  /** The JSON Schema provider for payload validation. */
  validator?: jsonSchemaValidator;
  /** Poll interval floor in ms (spec default 1000). */
  pollFloorMs?: number;
  /**
   * Re-list the event types after a contract-changing termination. Defaults to
   * a full `listAllEvents()` walk; a host with a managed events list passes its
   * refresh, so the list it shows is the one the offer was based on.
   */
  relist?: () => Promise<EventType[]>;
}

export const DEFAULT_MAX_EVENT_LOG_ENTRIES = 1000;
export const DEFAULT_EVENT_DEDUP_WINDOW = 10_000;

/** The live, mutable half of a registry entry. */
interface Entry {
  snapshot: EventSubscription;
  runner: SubscriptionRunner | undefined;
  /** Recent `eventId`s in arrival order, for a bounded dedup window. */
  seen: Set<string>;
}

export class EventSubscriptionsState extends TypedEventTarget<EventSubscriptionsStateEventMap> {
  private readonly entries = new Map<string, Entry>();
  private readonly routes = new Map<string, PushRunner>();
  private log: EventLogEntry[] = [];
  private seq = 0;
  private client: InspectorClientProtocol | null;
  private unsubscribe: (() => void) | null = null;
  private readonly maxLogEntries: number;
  private readonly dedupWindow: number;
  private readonly validatePayload: EventPayloadValidator | undefined;

  private readonly options: EventSubscriptionsStateOptions;

  constructor(
    client: InspectorClientProtocol,
    options: EventSubscriptionsStateOptions = {},
  ) {
    super();
    this.options = options;
    this.client = client;
    this.maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_EVENT_LOG_ENTRIES;
    this.dedupWindow = options.dedupWindow ?? DEFAULT_EVENT_DEDUP_WINDOW;
    this.validatePayload =
      options.validatePayloads === false
        ? undefined
        : createEventPayloadValidator(
            options.validator ?? new LinearPatternJsonSchemaValidator(),
          );

    const onNotification = (
      event: TypedEventGeneric<
        InspectorClientEventMap,
        "eventsStreamNotification"
      >,
    ): void => {
      const { method, params } = event.detail;
      const id = subscriptionIdOf(params);
      // Unroutable (no id), or for a stream this store does not hold.
      if (id === undefined) return;
      this.routes.get(String(id))?.handleNotification(method, params);
    };
    const onDisconnect = (): void => this.reset();
    client.addEventListener("eventsStreamNotification", onNotification);
    client.addEventListener("disconnect", onDisconnect);
    this.unsubscribe = () => {
      client.removeEventListener("eventsStreamNotification", onNotification);
      client.removeEventListener("disconnect", onDisconnect);
    };
  }

  /** Every subscription, in creation order. */
  getSubscriptions(): EventSubscription[] {
    return [...this.entries.values()].map((entry) => entry.snapshot);
  }

  getSubscription(id: string): EventSubscription | undefined {
    return this.entries.get(id)?.snapshot;
  }

  /** The occurrence log, oldest first; optionally one subscription's. */
  getLog(subscription?: string): EventLogEntry[] {
    return subscription === undefined
      ? [...this.log]
      : this.log.filter((entry) => entry.subscription === subscription);
  }

  /** Empty the log (subscriptions and their counts are untouched). */
  clearLog(): void {
    if (this.log.length === 0) return;
    this.log = [];
    this.dispatchTypedEvent("logChange", []);
  }

  /**
   * Start a subscription, or return the live one with the same key. A stopped
   * or terminated one with the same key is started again from its cursor.
   * Throws when the connection cannot run it: Events not offered, the client
   * lacking the method, or a mode the event type does not advertise.
   */
  subscribe(
    eventType: EventType,
    options: EventSubscribeOptions,
  ): EventSubscription {
    const client = this.requireClient();
    const { mode } = options;
    if (!client.getEventsExtension?.()) {
      throw new Error(
        "The server does not offer the Events extension on this connection.",
      );
    }
    if (!knownDeliveryModes(eventType).includes(mode)) {
      throw new Error(
        `Event type "${eventType.name}" does not advertise ${mode} delivery.`,
      );
    }
    const method = mode === "poll" ? client.pollEvents : client.streamEvents;
    if (!method) {
      throw new Error(`This client cannot run ${mode} subscriptions.`);
    }
    const args = options.arguments ?? {};
    const id = eventSubscriptionKey(eventType.name, args, mode);
    const existing = this.entries.get(id);
    if (existing?.runner) return existing.snapshot;

    const snapshot: EventSubscription = {
      id,
      name: eventType.name,
      mode,
      arguments: args,
      eventType,
      ...(options.maxAgeMs !== undefined && { maxAgeMs: options.maxAgeMs }),
      ...(mode === "poll" &&
        options.maxEvents !== undefined && { maxEvents: options.maxEvents }),
      ...(mode === "push" &&
        options.heartbeatMs !== undefined && {
          heartbeatMs: options.heartbeatMs,
        }),
      status: "starting",
      cursor: options.cursor ?? existing?.snapshot.cursor ?? null,
      startedAt: new Date(),
      counts: existing?.snapshot.counts ?? {
        events: 0,
        duplicates: 0,
        invalidPayloads: 0,
        gaps: 0,
        errors: 0,
        reconnects: 0,
      },
    };
    const entry: Entry = {
      snapshot,
      runner: undefined,
      seen: existing?.seen ?? new Set(),
    };
    this.entries.set(id, entry);
    this.run(entry);
    this.dispatchSubscriptions();
    return entry.snapshot;
  }

  /**
   * Start a stopped or terminated subscription again from its cursor, against
   * the descriptor the last re-list returned. Refused for a termination with
   * no resubscribe offer (`forbidden`, `rejected`, or a type that is gone).
   */
  resubscribe(id: string): EventSubscription {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`No event subscription ${id}`);
    if (entry.runner) return entry.snapshot;
    const { termination } = entry.snapshot;
    if (termination && !termination.canResubscribe) {
      throw new Error(
        `Subscription to "${entry.snapshot.name}" ended (${termination.reason}) and cannot be resumed.`,
      );
    }
    const { snapshot } = entry;
    return this.subscribe(snapshot.eventType, {
      mode: snapshot.mode,
      arguments: snapshot.arguments,
      cursor: snapshot.cursor,
      maxAgeMs: snapshot.maxAgeMs,
      maxEvents: snapshot.maxEvents,
      heartbeatMs: snapshot.heartbeatMs,
    });
  }

  /** Stop a subscription, keeping it (and its cursor) in the registry. */
  stop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry?.runner) return;
    entry.runner.stop();
    entry.runner = undefined;
    this.patch(entry, { status: "stopped" });
  }

  /** Stop a subscription and forget it. */
  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.runner?.stop();
    this.entries.delete(id);
    this.dispatchSubscriptions();
  }

  /** Stop everything and drop the client. The store is unusable after. */
  destroy(): void {
    this.reset();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client = null;
  }

  private requireClient(): InspectorClientProtocol {
    if (!this.client) throw new Error("EventSubscriptionsState is destroyed");
    return this.client;
  }

  /** Stop every runner and clear the registry and the log. */
  private reset(): void {
    for (const entry of this.entries.values()) entry.runner?.stop();
    const hadEntries = this.entries.size > 0;
    const hadLog = this.log.length > 0;
    this.entries.clear();
    this.routes.clear();
    this.log = [];
    if (hadEntries) this.dispatchSubscriptions();
    if (hadLog) this.dispatchTypedEvent("logChange", []);
  }

  private run(entry: Entry): void {
    const client = this.requireClient();
    const { snapshot } = entry;
    const callbacks = this.callbacksFor(entry);
    const timing: RunnerTiming = {
      reconnectJitterMs: this.options.reconnectJitterMs,
      maxReconnectDelayMs: this.options.maxReconnectDelayMs,
      random: this.options.random,
    };
    const eventType = snapshot.eventType;
    if (snapshot.mode === "poll") {
      entry.runner = new PollRunner({
        ...timing,
        request: {
          arguments: snapshot.arguments,
          ...(snapshot.maxAgeMs !== undefined && {
            maxAgeMs: snapshot.maxAgeMs,
          }),
          ...(snapshot.maxEvents !== undefined && {
            maxEvents: snapshot.maxEvents,
          }),
        },
        cursor: snapshot.cursor,
        pollFloorMs: this.options.pollFloorMs,
        // `subscribe` checked the method exists before creating the entry.
        poll: (params, signal) =>
          client.pollEvents!(eventType, params, undefined, { signal }),
        callbacks,
      });
    } else {
      const routes: PushRoutes = {
        bind: (id, runner) => this.routes.set(String(id), runner),
        unbind: (id, runner) => {
          if (this.routes.get(String(id)) === runner) {
            this.routes.delete(String(id));
          }
        },
      };
      entry.runner = new PushRunner({
        ...timing,
        request: {
          arguments: snapshot.arguments,
          ...(snapshot.maxAgeMs !== undefined && {
            maxAgeMs: snapshot.maxAgeMs,
          }),
          ...(snapshot.heartbeatMs !== undefined && {
            heartbeatMs: snapshot.heartbeatMs,
          }),
        },
        cursor: snapshot.cursor,
        stream: (params, { signal, onSubscriptionId }) =>
          client.streamEvents!(eventType, params, {
            signal,
            onSubscriptionId,
          }),
        routes,
        callbacks,
      });
    }
    entry.runner.start();
  }

  /**
   * The callbacks one runner reports through, bound to its entry. A runner
   * never reports after it is stopped, and an entry's runner is stopped before
   * the entry is replaced or removed, so these always speak for a live entry.
   */
  private callbacksFor(entry: Entry): RunnerCallbacks {
    return {
      update: (update) => this.patch(entry, update),
      occurrences: (occurrences) => this.deliver(entry, occurrences),
      gap: (cursor) => {
        this.bump(entry, "gaps");
        this.append(entry, { kind: "gap", cursor });
      },
      error: (error) => {
        this.bump(entry, "errors", { lastError: error });
        this.append(entry, { kind: "error", error });
      },
      reconnect: (reason) => {
        this.bump(entry, "reconnects");
        this.append(entry, { kind: "reconnect", reason });
      },
      terminated: (error) => this.terminate(entry, error),
    };
  }

  private deliver(entry: Entry, occurrences: EventOccurrence[]): void {
    for (const occurrence of occurrences) {
      if (entry.seen.has(occurrence.eventId)) {
        this.bump(entry, "duplicates");
        continue;
      }
      entry.seen.add(occurrence.eventId);
      if (entry.seen.size > this.dedupWindow) {
        // Sets iterate in insertion order: the first is the oldest, and the
        // set is non-empty here, having just grown past the window.
        entry.seen.delete(entry.seen.values().next().value!);
      }
      const payloadError = this.validatePayload?.(
        entry.snapshot.eventType,
        occurrence.data,
      );
      this.bump(entry, "events");
      if (payloadError !== undefined) this.bump(entry, "invalidPayloads");
      this.append(entry, {
        kind: "event",
        occurrence,
        ...(payloadError !== undefined && { payloadError }),
      });
    }
  }

  private terminate(entry: Entry, error: EventsErrorInfo): void {
    entry.runner = undefined;
    const { reason, relist } = classifyTermination(error);
    this.patch(entry, {
      status: "terminated",
      lastError: error,
      termination: {
        reason,
        error,
        at: new Date(),
        relist: relist ? "pending" : "skipped",
        canResubscribe: false,
      },
    });
    this.append(entry, { kind: "terminated", reason, error });
    if (relist) this.relistAfter(entry);
  }

  /** Re-list, then offer a resubscribe when the type is still there. */
  private relistAfter(entry: Entry): void {
    const relist =
      this.options.relist ??
      (async () => (await this.requireClient().listAllEvents!()).events);
    let pending: Promise<EventType[]>;
    try {
      pending = relist();
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (eventTypes) => {
        const current = this.currentTermination(entry);
        if (!current) return;
        const found = eventTypes.find((t) => t.name === entry.snapshot.name);
        const offered =
          found !== undefined &&
          knownDeliveryModes(found).includes(entry.snapshot.mode);
        this.patch(entry, {
          ...(found && { eventType: found }),
          termination: { ...current, relist: "done", canResubscribe: offered },
        });
      },
      () => {
        const current = this.currentTermination(entry);
        if (!current) return;
        this.patch(entry, { termination: { ...current, relist: "failed" } });
      },
    );
  }

  /** The termination still pending a re-list, if the entry is still that one. */
  private currentTermination(
    entry: Entry,
  ): EventSubscriptionTermination | undefined {
    if (this.entries.get(entry.snapshot.id) !== entry || entry.runner) {
      return undefined;
    }
    return entry.snapshot.termination;
  }

  private bump(
    entry: Entry,
    count: keyof EventSubscriptionCounts,
    extra: Partial<EventSubscription> = {},
  ): void {
    const counts = {
      ...entry.snapshot.counts,
      [count]: entry.snapshot.counts[count] + 1,
    };
    this.patch(entry, { ...extra, counts });
  }

  private patch(
    entry: Entry,
    changes: RunnerUpdate | Partial<EventSubscription>,
  ): void {
    const next: EventSubscription = { ...entry.snapshot, ...changes };
    // A status change to anything but terminated clears the last outcome.
    if (changes.status !== undefined && changes.status !== "terminated") {
      delete next.termination;
    }
    entry.snapshot = next;
    this.dispatchSubscriptions();
  }

  private append(
    entry: Entry,
    line: DistributiveOmit<EventLogEntry, "seq" | "at" | "subscription">,
  ): void {
    this.seq += 1;
    const logged: EventLogEntry = {
      ...line,
      seq: this.seq,
      at: new Date(),
      subscription: entry.snapshot.id,
    };
    if (this.maxLogEntries > 0 && this.log.length >= this.maxLogEntries) {
      this.log.shift();
    }
    this.log.push(logged);
    this.dispatchTypedEvent("logEntry", logged);
    this.dispatchTypedEvent("logChange", [...this.log]);
  }

  private dispatchSubscriptions(): void {
    this.dispatchTypedEvent("subscriptionsChange", this.getSubscriptions());
  }
}
