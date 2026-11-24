/**
 * EventSubscriptionsState: the client-owned Events subscription registry
 * (SEP-3415, #3029), UI-agnostic, in core so the web client, the TUI and mcpdo
 * share one engine.
 *
 * "The client owns all subscription state, in all three delivery modes. There
 * is no method that lists subscriptions on the server" (spec, Client-Owned
 * Subscription State). This store is that state for every mode: which
 * subscriptions exist, the cursor each one would resume from, whether it is
 * live, and how it ended.
 *
 * **Identity.** A subscription is keyed by `(name, canonical-JSON arguments,
 * mode)` ({@link eventSubscriptionKey}), plus the callback URL for a webhook.
 * Subscribing again with the same key returns the live subscription rather
 * than opening a second stream; a different mode for the same event and
 * arguments is a different subscription.
 *
 * **Webhook is management only (#3031).** The server POSTs deliveries to a
 * callback URL the user supplies, which the Inspector does not receive; what
 * this store runs is the subscribe-and-refresh loop (`WebhookRunner`), the
 * `deliveryStatus` each refresh reports, and `events/unsubscribe` on stop or
 * remove. The signing secret is generated here unless the caller supplies one,
 * is held on the private entry, and appears in a snapshot only masked —
 * {@link EventSubscriptionsState.getWebhookSecret} is the one way to read it,
 * for copying into the receiver. A webhook subscription is not unsubscribed on
 * disconnect (there is no connection left to send it on): a finite grant
 * lapses at its TTL, and a no-expiry one stays until unsubscribed.
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
  WebhookRunner,
  type PushRoutes,
  type RunnerCallbacks,
  type RunnerTiming,
  type RunnerUpdate,
  type SubscriptionRunner,
  type WebhookRunnerUpdate,
} from "../../extension/events/subscriptionRunners.js";
import {
  eventsErrorOf,
  transportErrorInfo,
} from "../../extension/events/termination.js";
import { EVENTS_ERROR_CODES } from "../../extension/events/constants.js";
import {
  generateWebhookSecret,
  isWebhookSecret,
  MASKED_WEBHOOK_SECRET,
} from "../../extension/events/webhookSecret.js";

/** The modes this engine runs; webhook is management only (#3031). */
export type EventSubscriptionMode = "poll" | "push" | "webhook";

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
  /** Webhook only, and required for it: where and how to deliver. */
  webhook?: EventWebhookOptions;
}

/** What a webhook subscription is created with. */
export interface EventWebhookOptions {
  /** The callback URL; must be `https://` (the server rejects anything else). */
  url: string;
  /**
   * A `whsec_` secret the receiver already holds. Omitted, one is generated
   * from the CSPRNG — and on a resume, the one the subscription already had
   * is kept, so the receiver's copy keeps verifying.
   */
  secret?: string;
  /** Suggested lifetime. Omitted = server default; `null` = no expiry. */
  ttlMs?: number | null;
}

/** Where `events/unsubscribe` stands after a stop or a remove. */
export interface EventWebhookUnsubscribe {
  /**
   * `gone` — the server answered `NotFound`: there was nothing to tear down
   * (it had lapsed, or the server had dropped it), which is the outcome an
   * unsubscribe asks for.
   */
  status: "pending" | "done" | "gone" | "failed";
  error?: EventsErrorInfo;
}

/** A webhook subscription's management state. Never holds the raw secret. */
export interface EventWebhookState extends WebhookRunnerUpdate {
  url: string;
  /** Always {@link MASKED_WEBHOOK_SECRET}; the value is `getWebhookSecret`'s. */
  secret: string;
  /** The suggestion sent; absent = server default, `null` = no expiry. */
  ttlMs?: number | null;
  refreshes: number;
  unsubscribe?: EventWebhookUnsubscribe;
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
  /** Webhook: the callback, the grant and the reported delivery status. */
  webhook?: EventWebhookState;
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
      /**
       * The payload check as it ran when the occurrence arrived: `unchecked`
       * when validation is off, the type has no schema, or the schema would
       * not compile — so a badge never claims a check that did not happen,
       * and a later re-list cannot rewrite an earlier verdict (#3030).
       */
      payload: "valid" | "invalid" | "unchecked";
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
  /** Webhook: the signing secret, kept off the snapshot. */
  secret?: string;
}

export class EventSubscriptionsState extends TypedEventTarget<EventSubscriptionsStateEventMap> {
  private readonly entries = new Map<string, Entry>();
  private readonly routes = new Map<string, PushRunner>();
  /**
   * Webhook keys with an `events/unsubscribe` in flight. A subscribe with the
   * same key waits for it to settle: sent alongside, the server could apply
   * the unsubscribe last and delete the subscription the card reports live.
   */
  private readonly tearingDown = new Set<string>();
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
    const method =
      mode === "poll"
        ? client.pollEvents
        : mode === "push"
          ? client.streamEvents
          : client.unsubscribeEvents && client.subscribeEvents;
    if (!method) {
      throw new Error(`This client cannot run ${mode} subscriptions.`);
    }
    const webhook =
      mode === "webhook" ? checkWebhookOptions(options.webhook) : undefined;
    const args = options.arguments ?? {};
    const id = eventSubscriptionKey(eventType.name, args, mode, webhook?.url);
    const existing = this.entries.get(id);
    if (existing?.runner) return existing.snapshot;
    if (this.tearingDown.has(id)) {
      throw new Error(
        "This webhook subscription is still being unsubscribed; try again once that finishes.",
      );
    }
    // Checked here, once the existing entry is known: a resume keeps the
    // secret the receiver already verifies with.
    const secret =
      webhook &&
      (webhook.secret ?? existing?.secret ?? generateWebhookSecret());
    if (secret !== undefined && !isWebhookSecret(secret)) {
      throw new Error(
        "The webhook secret must be whsec_ followed by the base64 of 24 to 64 random bytes.",
      );
    }

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
      ...(webhook && {
        webhook: {
          url: webhook.url,
          secret: MASKED_WEBHOOK_SECRET,
          ...(webhook.ttlMs !== undefined && { ttlMs: webhook.ttlMs }),
          refreshes: 0,
        },
      }),
      status: "starting",
      // An explicit `null` ("start from now") wins over a saved cursor; only
      // an omitted one resumes from where a stopped subscription left off.
      cursor:
        options.cursor !== undefined
          ? options.cursor
          : (existing?.snapshot.cursor ?? null),
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
      ...(secret !== undefined && { secret }),
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
      ...(snapshot.webhook && {
        webhook: {
          url: snapshot.webhook.url,
          secret: entry.secret,
          ...(snapshot.webhook.ttlMs !== undefined && {
            ttlMs: snapshot.webhook.ttlMs,
          }),
        },
      }),
    });
  }

  /**
   * Stop a subscription, keeping it (and its cursor) in the registry. A
   * webhook one is also torn down on the server with `events/unsubscribe`;
   * its outcome is reported on {@link EventWebhookState.unsubscribe}, and
   * stopping it again after a failed unsubscribe retries the teardown.
   */
  stop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!entry.runner) {
      // A teardown that failed is retried: the server may still hold it.
      if (entry.snapshot.webhook?.unsubscribe?.status === "failed") {
        this.unsubscribeWebhook(entry, Promise.resolve());
      }
      return;
    }
    const idle = whenIdle(entry.runner);
    entry.runner.stop();
    entry.runner = undefined;
    // Reserved before any notification: a listener resuming it from the
    // `stopped` dispatch must be refused, not have its new grant deleted by
    // this teardown.
    if (entry.snapshot.mode === "webhook") this.tearingDown.add(id);
    this.patch(entry, { status: "stopped" });
    if (entry.snapshot.mode === "webhook") this.unsubscribeWebhook(entry, idle);
  }

  /**
   * Stop a subscription and forget it. A webhook one the server may still
   * hold is unsubscribed on the way out (best effort — the entry is gone, so
   * the outcome is not reported): a live one, and one that was granted and
   * ended without a confirmed teardown (a failed unsubscribe, or a refresh
   * refused after an earlier grant).
   */
  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const unsubscribe = needsTeardown(entry);
    const idle = whenIdle(entry.runner);
    entry.runner?.stop();
    entry.runner = undefined;
    this.entries.delete(id);
    if (unsubscribe) this.unsubscribeWebhook(entry, idle);
    this.dispatchSubscriptions();
  }

  /**
   * Refresh a live webhook subscription now rather than at its scheduled
   * time — the way to read a fresh `deliveryStatus`, or to keep a no-expiry
   * grant's cursor moving. `false` when there is nothing to refresh (not a
   * live webhook subscription, or a subscribe already in flight).
   */
  refreshWebhook(id: string): boolean {
    const runner = this.entries.get(id)?.runner;
    return runner instanceof WebhookRunner && runner.refreshNow();
  }

  /**
   * A webhook subscription's signing secret, for copying into the receiver
   * that verifies its deliveries. The snapshot only ever carries it masked.
   */
  getWebhookSecret(id: string): string | undefined {
    return this.entries.get(id)?.secret;
  }

  /** Stop everything and drop the client. The store is unusable after. */
  destroy(): void {
    this.reset();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client = null;
  }

  /**
   * Send `events/unsubscribe` for a webhook entry the caller has just stopped
   * or removed, reporting the outcome on the entry while it is still the
   * registry's. Sent once `idle` settles — after any subscribe still in
   * flight — so the server cannot apply a late grant after the teardown.
   */
  private unsubscribeWebhook(entry: Entry, idle: Promise<void>): void {
    const client = this.client;
    const { webhook } = entry.snapshot;
    /* v8 ignore next -- callers pass only webhook entries of a live store, whose client `subscribe` checked */
    if (!client?.unsubscribeEvents || !webhook) return;
    const report = (unsubscribe: EventWebhookUnsubscribe): void => {
      // A remove meanwhile wins. A resume cannot: `subscribe` refuses the key
      // until this settles.
      if (this.entries.get(entry.snapshot.id) !== entry) return;
      const current = entry.snapshot.webhook!;
      this.patch(entry, { webhook: { ...current, unsubscribe } });
    };
    const key = entry.snapshot.id;
    // Reserved before the `pending` dispatch, for the reason `stop` gives.
    this.tearingDown.add(key);
    report({ status: "pending" });
    const settle = (unsubscribe: EventWebhookUnsubscribe): void => {
      this.tearingDown.delete(key);
      report(unsubscribe);
    };
    const unsubscribeEvents = client.unsubscribeEvents.bind(client);
    const send = (): Promise<void> =>
      unsubscribeEvents(entry.snapshot.eventType, {
        arguments: entry.snapshot.arguments,
        delivery: { url: webhook.url },
      });
    // `then(send)` also turns a synchronous throw into a rejection.
    idle.then(send).then(
      () => settle({ status: "done" }),
      (err: unknown) => {
        const rpc = eventsErrorOf(err);
        settle(
          rpc?.code === EVENTS_ERROR_CODES.NotFound
            ? { status: "gone", error: rpc }
            : { status: "failed", error: rpc ?? transportErrorInfo(err) },
        );
      },
    );
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
    this.tearingDown.clear();
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
    if (snapshot.mode === "webhook") {
      // `subscribe` set both for every webhook entry.
      const webhook = snapshot.webhook!;
      entry.runner = new WebhookRunner({
        ...timing,
        request: {
          arguments: snapshot.arguments,
          delivery: {
            mode: "webhook",
            url: webhook.url,
            secret: entry.secret!,
          },
          ...(snapshot.maxAgeMs !== undefined && {
            maxAgeMs: snapshot.maxAgeMs,
          }),
          ...(webhook.ttlMs !== undefined && { ttlMs: webhook.ttlMs }),
        },
        cursor: snapshot.cursor,
        subscribe: (params, signal) =>
          client.subscribeEvents!(eventType, params, { signal }),
        callbacks,
      });
    } else if (snapshot.mode === "poll") {
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
   * Whether `entry` is still the registry's running entry for its key. Every
   * dispatch runs listeners synchronously, and a listener may stop or remove
   * the subscription, or destroy the store, in the middle of a report — so
   * each report checks this before it touches the entry or the log.
   */
  private isLive(entry: Entry): boolean {
    return (
      this.entries.get(entry.snapshot.id) === entry &&
      entry.runner !== undefined
    );
  }

  /** The callbacks one runner reports through, bound to its entry. */
  private callbacksFor(entry: Entry): RunnerCallbacks {
    return {
      update: (update) => {
        if (this.isLive(entry)) this.patch(entry, update);
      },
      occurrences: (occurrences) => this.deliver(entry, occurrences),
      gap: (cursor) => {
        if (!this.isLive(entry)) return;
        this.bump(entry, "gaps");
        if (this.isLive(entry)) this.append(entry, { kind: "gap", cursor });
      },
      error: (error) => {
        if (!this.isLive(entry)) return;
        this.bump(entry, "errors", { lastError: error });
        if (this.isLive(entry)) this.append(entry, { kind: "error", error });
      },
      reconnect: (reason) => {
        if (!this.isLive(entry)) return;
        this.bump(entry, "reconnects");
        if (this.isLive(entry))
          this.append(entry, { kind: "reconnect", reason });
      },
      terminated: (error) => {
        if (this.isLive(entry)) this.terminate(entry, error);
      },
    };
  }

  private deliver(entry: Entry, occurrences: EventOccurrence[]): void {
    for (const occurrence of occurrences) {
      // Re-checked per occurrence: a listener on the previous one's dispatch
      // may have ended the subscription.
      if (!this.isLive(entry)) return;
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
      const check = this.validatePayload?.(
        entry.snapshot.eventType,
        occurrence.data,
      ) ?? { status: "unchecked" as const };
      const payloadError = check.status === "invalid" ? check.error : undefined;
      const { counts } = entry.snapshot;
      this.patch(entry, {
        counts: {
          ...counts,
          events: counts.events + 1,
          invalidPayloads:
            counts.invalidPayloads + (payloadError === undefined ? 0 : 1),
        },
      });
      if (!this.isLive(entry)) return;
      this.append(entry, {
        kind: "event",
        occurrence,
        payload: check.status,
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
    // A `subscriptionsChange` listener may have removed it meanwhile.
    if (this.entries.get(entry.snapshot.id) !== entry) return;
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
    const { webhook, ...rest } = changes;
    const next: EventSubscription = { ...entry.snapshot, ...rest };
    // The runner reports only the fields it owns; the URL, the masked secret
    // and the unsubscribe outcome are the store's, so the two are merged.
    if (webhook && entry.snapshot.webhook) {
      next.webhook = { ...entry.snapshot.webhook, ...webhook };
    }
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

/**
 * A webhook subscribe's options, checked before anything is sent: present,
 * and with an `https://` URL — the spec makes the server reject anything else
 * with `InvalidParams`, and saying so here names the problem plainly.
 */
function checkWebhookOptions(
  options: EventWebhookOptions | undefined,
): EventWebhookOptions {
  if (!options?.url) {
    throw new Error("A webhook subscription needs a callback URL.");
  }
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new Error(`The callback URL is not a valid URL: ${options.url}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("The callback URL must use https://.");
  }
  // Normalized, so equivalent spellings (`https://h.example` and
  // `https://h.example/`) are one registry key, as they are one server key.
  return { ...options, url: url.href };
}

/** What a stopping runner's teardown must wait for: a webhook subscribe. */
function whenIdle(runner: SubscriptionRunner | undefined): Promise<void> {
  return runner instanceof WebhookRunner
    ? runner.whenIdle()
    : Promise.resolve();
}

/**
 * Whether removing `entry` should send `events/unsubscribe`: it is a webhook
 * subscription the server may still hold — live, or granted at least once
 * and not confirmed torn down (and no teardown already in flight).
 */
function needsTeardown(entry: Entry): boolean {
  const { webhook } = entry.snapshot;
  if (!webhook) return false;
  if (entry.runner) return true;
  const status = webhook.unsubscribe?.status;
  // A failed teardown always needs another: a subscribe that was in flight
  // at the stop may have been granted on the server without being counted.
  if (status === "failed") return true;
  return webhook.refreshes > 0 && status === undefined;
}
