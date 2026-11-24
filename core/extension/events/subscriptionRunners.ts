/**
 * The poll and push loops of the Events subscription engine (SEP-3415, #3029).
 *
 * Each runner owns one subscription's wire activity and nothing else: when to
 * send the next `events/poll`, when to open, abandon and re-open an
 * `events/stream`, and where the cursor stands. What happens to what they
 * receive — deduplication, payload validation, the occurrence log, termination
 * handling, the store the UI reads — is the registry's
 * (`core/mcp/state/eventSubscriptionsState.ts`), reached through
 * {@link RunnerCallbacks}. The split keeps the timing rules, which are what the
 * spec is most specific about, testable on their own with fake timers.
 *
 * Both runners are UI-agnostic and transport-agnostic: they are handed a
 * function that sends one request, and an `AbortSignal` is the only way they
 * cancel one. The SDK turns that abort into the transport's own cancellation
 * (an aborted SSE response on Streamable HTTP, `notifications/cancelled` on
 * stdio), which is exactly the spec's kill switch for push.
 *
 * **No floating promises.** Every request's promise is settled with a
 * two-handler `.then`, and neither handler can throw: they only compare the
 * settling request against the current one and schedule the next step. A
 * request this runner has abandoned (stopped, or replaced after a dead stream)
 * still settles — usually as an abort rejection — and is ignored by identity.
 */

import {
  EVENTS_ACTIVE_NOTIFICATION,
  EVENTS_ERROR_NOTIFICATION,
  EVENTS_EVENT_NOTIFICATION,
  EVENTS_HEARTBEAT_NOTIFICATION,
  EVENTS_TERMINATED_NOTIFICATION,
  type EventsStreamNotificationMethod,
} from "./constants.js";
import {
  EventsActiveNotificationParamsSchema,
  EventsErrorNotificationParamsSchema,
  EventsEventNotificationParamsSchema,
  EventsHeartbeatNotificationParamsSchema,
  EventsTerminatedNotificationParamsSchema,
  normalizeCursor,
  type EventOccurrence,
  type PollEventsResult,
} from "./schemas.js";
import {
  eventsErrorOf,
  isTerminalRequestError,
  transportErrorInfo,
  type EventsErrorInfo,
} from "./termination.js";

/** The client's poll-interval floor when none is configured (spec default). */
export const DEFAULT_POLL_FLOOR_MS = 1000;
/**
 * The heartbeat interval assumed before a stream's `active` grants one: the
 * spec's recommended server default. Until the grant arrives the liveness
 * check runs against three times this, so a server that never confirms a
 * stream is not waited on forever.
 */
export const DEFAULT_HEARTBEAT_MS = 30_000;
/** The spec's liveness rule: dead after this many heartbeat intervals of silence. */
export const HEARTBEAT_LIVENESS_MULTIPLIER = 3;
/** Upper bound of the random wait before the first reconnect or retry. */
export const DEFAULT_RECONNECT_JITTER_MS = 1000;
/** Ceiling on the backed-off wait before a reconnect or retry. */
export const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

/** What a runner reports while it is live. */
export type RunnerStatus = "active" | "reconnecting";

/** The runner-owned fields of a subscription, as they change. */
export interface RunnerUpdate {
  status?: RunnerStatus;
  /** The position to resume from; `null` when there is nothing to persist. */
  cursor?: string | null;
  /** Push: the JSON-RPC id of the current `events/stream`. */
  subscriptionId?: string | number;
  /** Push: the interval the last `active` granted. */
  grantedHeartbeatMs?: number;
  /** Poll: the interval the server last recommended. */
  nextPollMs?: number;
  /** When the last poll result or stream notification arrived. */
  lastMessageAt?: Date;
}

/** How a runner reports to its registry. None of these may throw. */
export interface RunnerCallbacks {
  update(update: RunnerUpdate): void;
  occurrences(occurrences: EventOccurrence[]): void;
  /** Delivery started later than the cursor: events may have been skipped. */
  gap(cursor: string | null): void;
  /** A recoverable failure; the subscription stays live. */
  error(error: EventsErrorInfo): void;
  /** The runner is about to wait and try again. */
  reconnect(reason: string): void;
  /** The subscription is over; the runner has already stopped itself. */
  terminated(error: EventsErrorInfo): void;
}

/** Timing knobs shared by both runners; every field has a default. */
export interface RunnerTiming {
  reconnectJitterMs?: number;
  maxReconnectDelayMs?: number;
  /** Source of the jitter, `[0, 1)`. Injectable for deterministic tests. */
  random?: () => number;
}

/** The common shape: start it once, stop it any number of times. */
export interface SubscriptionRunner {
  start(): void;
  stop(): void;
  readonly cursor: string | null;
}

/**
 * The wait before the next attempt after `attempt` consecutive failures: a
 * random fraction (the spec's jitter, so a server restart does not bring every
 * client back at once) of a window that doubles per failure, up to a ceiling.
 */
function backoffDelay(
  attempt: number,
  floorMs: number,
  timing: Required<RunnerTiming>,
): number {
  const window = Math.min(
    timing.maxReconnectDelayMs,
    timing.reconnectJitterMs * 2 ** attempt,
  );
  return floorMs + Math.floor(timing.random() * window);
}

function withDefaults(timing: RunnerTiming = {}): Required<RunnerTiming> {
  return {
    reconnectJitterMs: timing.reconnectJitterMs ?? DEFAULT_RECONNECT_JITTER_MS,
    maxReconnectDelayMs:
      timing.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
    random: timing.random ?? Math.random,
  };
}

function describeFailure(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

/** The parameters of every poll a runner sends, cursor aside. */
export interface PollRunnerRequest {
  arguments: Record<string, unknown>;
  maxAgeMs?: number;
  maxEvents?: number;
}

export interface PollRunnerOptions extends RunnerTiming {
  request: PollRunnerRequest;
  /** Where to start; `null` is "start from now". */
  cursor: string | null;
  /** Never poll sooner than this after a non-draining result. */
  pollFloorMs?: number;
  /** Send one `events/poll`; abort `signal` to cancel it. */
  poll(
    params: PollRunnerRequest & { cursor: string | null },
    signal: AbortSignal,
  ): Promise<PollEventsResult>;
  callbacks: RunnerCallbacks;
}

/**
 * One poll subscription (spec, Poll-Based Delivery): poll, then either poll
 * again at once (`hasMore` — drain the backlog, ignoring `nextPollMs`) or wait
 * `nextPollMs`, never less than the floor, so a server answering `0` cannot
 * induce a tight loop. The cursor is persisted from every result, including an
 * empty one; a `null` cursor means the type does not replay, and the runner
 * keeps polling with `null`.
 *
 * A JSON-RPC error that says the subscription is invalid ends it (poll's
 * termination signal is "an error response to the next poll"). Anything else
 * is logged and retried with backoff.
 */
export class PollRunner implements SubscriptionRunner {
  private current: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private stopped = false;
  private started = false;
  private readonly floorMs: number;
  private readonly timing: Required<RunnerTiming>;
  cursor: string | null;
  private readonly options: PollRunnerOptions;

  constructor(options: PollRunnerOptions) {
    this.options = options;
    this.cursor = options.cursor;
    this.floorMs = options.pollFloorMs ?? DEFAULT_POLL_FLOOR_MS;
    this.timing = withDefaults(options);
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.send();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const current = this.current;
    this.current = undefined;
    current?.abort();
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.send();
    }, delayMs);
  }

  private send(): void {
    const controller = new AbortController();
    this.current = controller;
    this.options
      .poll({ ...this.options.request, cursor: this.cursor }, controller.signal)
      .then(
        (result) => this.onResult(controller, result),
        (err: unknown) => this.onFailure(controller, err),
      );
  }

  private onResult(controller: AbortController, result: PollEventsResult) {
    if (this.stopped || controller !== this.current) return;
    this.current = undefined;
    this.failures = 0;
    this.cursor = normalizeCursor(result.cursor);
    const { callbacks } = this.options;
    callbacks.update({
      status: "active",
      cursor: this.cursor,
      nextPollMs: result.nextPollMs,
      lastMessageAt: new Date(),
    });
    if (result.events.length > 0) callbacks.occurrences(result.events);
    // A type with no replay has no position to have advanced past; the spec
    // says such a `truncated` SHOULD be false and clients SHOULD ignore it.
    if (result.truncated && this.cursor !== null) callbacks.gap(this.cursor);
    // A callback may have stopped the runner (the registry removing it).
    if (this.stopped) return;
    this.schedule(
      result.hasMore ? 0 : Math.max(this.floorMs, result.nextPollMs),
    );
  }

  private onFailure(controller: AbortController, err: unknown) {
    if (this.stopped || controller !== this.current) return;
    this.current = undefined;
    const rpc = eventsErrorOf(err);
    if (rpc && isTerminalRequestError(rpc.code)) {
      this.stop();
      this.options.callbacks.terminated(rpc);
      return;
    }
    const { callbacks } = this.options;
    callbacks.error(rpc ?? transportErrorInfo(err));
    callbacks.update({ status: "reconnecting" });
    callbacks.reconnect(`poll failed: ${describeFailure(err)}`);
    if (this.stopped) return;
    this.schedule(backoffDelay(this.failures, this.floorMs, this.timing));
    this.failures += 1;
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** The parameters of every `events/stream` a runner opens, cursor aside. */
export interface PushRunnerRequest {
  arguments: Record<string, unknown>;
  maxAgeMs?: number;
  /** A suggestion; the server's grant on `active` is authoritative. */
  heartbeatMs?: number;
}

/** Where push notifications for a subscription id are delivered. */
export interface PushRoutes {
  bind(subscriptionId: string | number, runner: PushRunner): void;
  unbind(subscriptionId: string | number, runner: PushRunner): void;
}

export interface PushRunnerOptions extends RunnerTiming {
  request: PushRunnerRequest;
  cursor: string | null;
  /**
   * Open one `events/stream`; abort `signal` to cancel it. Must call
   * `onSubscriptionId` with the request's id as it goes out.
   */
  stream(
    params: PushRunnerRequest & { cursor: string | null },
    options: {
      signal: AbortSignal;
      onSubscriptionId: (id: string | number) => void;
    },
  ): Promise<unknown>;
  routes: PushRoutes;
  callbacks: RunnerCallbacks;
}

/**
 * One push subscription (spec, Push-Based Delivery): an `events/stream` held
 * open with no request timeout, its notifications routed here by subscription
 * id, and the cursor advanced by every `active`, `event` and `heartbeat`.
 *
 * **Liveness.** Any message on the stream restarts a timer of three times the
 * granted `heartbeatMs` (before the first `active`, three times the suggestion
 * or the 30 s default). When it fires the stream is treated as dead: it is
 * aborted and a new one opened with the last cursor after a random jitter.
 *
 * **Reconnection.** Also after a transport failure, and after the server ends
 * the stream with no `terminated` — the spec makes `terminated` the only thing
 * that ends a subscription, and lets the empty final result be omitted, so a
 * close without one is a dropped connection. The reconnect waits on a timer and
 * the old id stays routed until then, so a `terminated` that lands just after
 * the final result still ends the subscription instead of being reconnected
 * past.
 *
 * **Termination.** `notifications/events/terminated`, or a JSON-RPC error
 * answering the request, stops the runner and reports the error.
 * `notifications/events/error` is reported and the stream stays open.
 */
export class PushRunner implements SubscriptionRunner {
  private current: AbortController | undefined;
  private subscriptionId: string | number | undefined;
  private livenessTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private grantedHeartbeatMs: number | undefined;
  private failures = 0;
  private stopped = false;
  private started = false;
  private readonly timing: Required<RunnerTiming>;
  cursor: string | null;
  private readonly options: PushRunnerOptions;

  constructor(options: PushRunnerOptions) {
    this.options = options;
    this.cursor = options.cursor;
    this.timing = withDefaults(options);
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.unbind();
    const current = this.current;
    this.current = undefined;
    current?.abort();
  }

  /** A notification the registry routed here by subscription id. */
  handleNotification(
    method: EventsStreamNotificationMethod,
    params: Record<string, unknown>,
  ): void {
    if (this.stopped) return;
    const { callbacks } = this.options;
    const now = new Date();
    // Any message on the stream is proof of life, whatever it decodes to.
    if (this.current) this.armLiveness();
    switch (method) {
      case EVENTS_ACTIVE_NOTIFICATION: {
        const parsed = EventsActiveNotificationParamsSchema.safeParse(params);
        if (!parsed.success) return this.malformed(method, parsed.error);
        this.failures = 0;
        this.grantedHeartbeatMs = parsed.data.heartbeatMs;
        this.cursor = normalizeCursor(parsed.data.cursor);
        if (this.current) this.armLiveness();
        callbacks.update({
          status: "active",
          cursor: this.cursor,
          grantedHeartbeatMs: parsed.data.heartbeatMs,
          lastMessageAt: now,
        });
        if (parsed.data.truncated && this.cursor !== null) {
          callbacks.gap(this.cursor);
        }
        return;
      }
      case EVENTS_EVENT_NOTIFICATION: {
        const parsed = EventsEventNotificationParamsSchema.safeParse(params);
        if (!parsed.success) return this.malformed(method, parsed.error);
        this.cursor = normalizeCursor(parsed.data.cursor);
        callbacks.update({ cursor: this.cursor, lastMessageAt: now });
        callbacks.occurrences([parsed.data]);
        return;
      }
      case EVENTS_HEARTBEAT_NOTIFICATION: {
        const parsed =
          EventsHeartbeatNotificationParamsSchema.safeParse(params);
        if (!parsed.success) return this.malformed(method, parsed.error);
        this.cursor = normalizeCursor(parsed.data.cursor);
        callbacks.update({ cursor: this.cursor, lastMessageAt: now });
        return;
      }
      case EVENTS_ERROR_NOTIFICATION: {
        const parsed = EventsErrorNotificationParamsSchema.safeParse(params);
        if (!parsed.success) return this.malformed(method, parsed.error);
        callbacks.update({ lastMessageAt: now });
        callbacks.error(parsed.data.error);
        return;
      }
      case EVENTS_TERMINATED_NOTIFICATION: {
        const parsed =
          EventsTerminatedNotificationParamsSchema.safeParse(params);
        if (!parsed.success) return this.malformed(method, parsed.error);
        this.stop();
        callbacks.terminated(parsed.data.error);
        return;
      }
    }
  }

  private malformed(method: string, error: Error): void {
    this.options.callbacks.error({
      code: -32603,
      message: `Malformed ${method}: ${error.message}`,
      data: { client: true },
    });
  }

  private clearTimers(): void {
    if (this.livenessTimer !== undefined) clearTimeout(this.livenessTimer);
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.livenessTimer = undefined;
    this.reconnectTimer = undefined;
  }

  private unbind(): void {
    if (this.subscriptionId === undefined) return;
    this.options.routes.unbind(this.subscriptionId, this);
    this.subscriptionId = undefined;
  }

  private armLiveness(): void {
    if (this.livenessTimer !== undefined) clearTimeout(this.livenessTimer);
    const interval =
      this.grantedHeartbeatMs ??
      this.options.request.heartbeatMs ??
      DEFAULT_HEARTBEAT_MS;
    const deadMs = interval * HEARTBEAT_LIVENESS_MULTIPLIER;
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = undefined;
      // Abandon the stream before aborting it, so its rejection is ignored.
      const dead = this.current;
      this.current = undefined;
      dead?.abort();
      this.scheduleReconnect(`no message on the stream for ${deadMs} ms`);
    }, deadMs);
  }

  private open(): void {
    this.unbind();
    this.grantedHeartbeatMs = undefined;
    const controller = new AbortController();
    this.current = controller;
    this.armLiveness();
    this.options
      .stream(
        { ...this.options.request, cursor: this.cursor },
        {
          signal: controller.signal,
          onSubscriptionId: (id) => {
            if (this.stopped || controller !== this.current) return;
            this.subscriptionId = id;
            this.options.routes.bind(id, this);
            this.options.callbacks.update({ subscriptionId: id });
          },
        },
      )
      .then(
        () => this.onEnded(controller, undefined),
        (err: unknown) => this.onEnded(controller, err),
      );
  }

  private onEnded(controller: AbortController, err: unknown): void {
    if (this.stopped || controller !== this.current) return;
    this.current = undefined;
    if (this.livenessTimer !== undefined) clearTimeout(this.livenessTimer);
    this.livenessTimer = undefined;
    const rpc = eventsErrorOf(err);
    if (rpc && isTerminalRequestError(rpc.code)) {
      this.stop();
      this.options.callbacks.terminated(rpc);
      return;
    }
    if (err !== undefined) {
      this.options.callbacks.error(rpc ?? transportErrorInfo(err));
    }
    this.scheduleReconnect(
      err === undefined
        ? "the server closed the stream without terminating it"
        : `the stream failed: ${describeFailure(err)}`,
    );
  }

  private scheduleReconnect(reason: string): void {
    const { callbacks } = this.options;
    callbacks.update({ status: "reconnecting" });
    callbacks.reconnect(reason);
    if (this.stopped) return;
    const delay = backoffDelay(this.failures, 0, this.timing);
    this.failures += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }
}
