import type { InspectorClient } from "../../mcp/index.js";
import type { MethodArgs } from "./method-types.js";
import { summarizeLatency, LatencyRecorder } from "./load-latency.js";
import {
  ErrorTally,
  realClock,
  runLoadTest,
  sleepUnlessAborted,
  stopFromAbort,
  type LoadClock,
  type LoadConnection,
  type LoadLatency,
  type LoadOptions,
  type LoadRunExtras,
  type LoadSample,
  type LoadSummary,
} from "./load-test.js";

/**
 * `--load-subscribe <uri>` (#2913): notification fan-out load. Instead of
 * timing request/response pairs only, open `subscribers` sessions, subscribe
 * each to one resource, and measure how the server fans
 * `notifications/resources/updated` out to all of them:
 *
 * - **Triggered** (a tool or scenario is given): the ordinary `--load` run
 *   is the trigger — each successful call is expected to update the resource
 *   once — and a notification's delivery latency is measured from the start
 *   of the call that caused it. Triggers run one at a time
 *   (`--load-concurrency 1`), so the k-th notification a session receives is
 *   attributed to the k-th successful trigger.
 * - **Passive** (no tool): nothing is called; the run listens for
 *   `--load-duration` to the server's own updates, and delivery latency is
 *   measured from the first subscriber's receipt of each update — the spread
 *   of the fan-out rather than its absolute cost.
 *
 * After the run, sessions get `settleMs` to catch up before a missing
 * notification is counted as missed. Session opening and subscribing happen
 * before the clock starts and are reported on their own (`connectMs`,
 * `subscribeMs`), so none of it is in the trigger calls' latency.
 *
 * A module of its own, depending on `load-test.ts` and not the reverse, so
 * the engine stays free of subscription concerns; the front ends call
 * {@link runLoadOrFanout}, which picks this or the plain run.
 */

/** Fan-out bounds, carried in `LoadOptions.fanout`. */
export type LoadFanoutOptions = {
  /** The resource every session subscribes to. */
  uri: string;
  /** Sessions subscribing, the caller's own connection included. */
  subscribers: number;
  /** How long sessions get to catch up after the run, before counting misses. */
  settleMs: number;
};

/** What a fan-out run reports in `LoadSummary.fanout`. */
export type LoadFanoutSummary = {
  uri: string;
  mode: "triggered" | "passive";
  /** Sessions asked for, the caller's own included. */
  requested: number;
  /** Sessions that opened and subscribed: the ones every figure below covers. */
  subscribed: number;
  /** Sessions that failed to open, or opened and failed to subscribe. */
  failed: number;
  /** Time to open each extra session; `null` if none opened. */
  connectMs: LoadLatency | null;
  /** Time each `resources/subscribe` took; `null` if none succeeded. */
  subscribeMs: LoadLatency | null;
  /** Open and subscribe failure messages by frequency. */
  errorMessages: { message: string; count: number }[];
  /**
   * Updates each subscriber should have seen: the successful triggers, or,
   * passive, the most any subscriber received.
   */
  updates: number;
  /** Notifications delivered, over all subscribers, up to `updates` each. */
  delivered: number;
  /** `updates × subscribed − delivered`. */
  missed: number;
  /** Subscribers that missed at least one update. */
  sessionsMissed: number;
  /** Notifications past `updates` on a session: the server's own, or repeats. */
  unexpected: number;
  /**
   * Delivery latency of each delivered notification: from its trigger's
   * start, or, passive, from the first subscriber's receipt. `null` if none.
   */
  deliveryMs: LoadLatency | null;
};

/** Poll step while waiting for subscribers to settle. */
const SETTLE_STEP_MS = 10;

/**
 * A session the fan-out run can subscribe and listen on. An
 * {@link InspectorClient} is adapted to it by {@link subscriberOf}; tests
 * pass fakes.
 */
export type LoadSubscriber = LoadConnection & {
  subscribeToResource: (uri: string) => Promise<void>;
  unsubscribeFromResource: (uri: string) => Promise<void>;
  isSubscribedToResource: (uri: string) => boolean;
  /** Listen for `notifications/resources/updated`; returns the remover. */
  onResourceUpdated: (listener: (uri: string) => void) => () => void;
};

/** The {@link LoadSubscriber} view of a live client. */
export function subscriberOf(client: InspectorClient): LoadSubscriber {
  return {
    disconnect: () => client.disconnect(),
    subscribeToResource: (uri) => client.subscribeToResource(uri),
    unsubscribeFromResource: async (uri) => {
      // Teardown runs while an interrupted run's aborted request signal may
      // still be the client's ambient one (mcpdo's daemon restores it only
      // after the run returns), which would refuse the unsubscribe and leave
      // the connection subscribed. So it runs with none.
      const restore = client.setAmbientRequestSignal(undefined);
      try {
        await client.unsubscribeFromResource(uri);
      } finally {
        restore();
      }
    },
    isSubscribedToResource: (uri) => client.isSubscribedToResource(uri),
    onResourceUpdated: (listener) => {
      const handler = (event: CustomEvent<{ uri: string }>): void =>
        listener(event.detail.uri);
      client.addEventListener("resourceUpdated", handler);
      return () => client.removeEventListener("resourceUpdated", handler);
    },
  };
}

/**
 * The plain load run, or — with `options.fanout` — {@link runFanoutLoadTest}.
 * The one entry point both CLIs call.
 */
export function runLoadOrFanout(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  extra: LoadRunExtras = {},
): Promise<LoadSummary> {
  return options.fanout
    ? runFanoutLoadTest(inspectorClient, args, options, options.fanout, extra)
    : runLoadTest(inspectorClient, args, options, extra);
}

/**
 * Fan-out over live clients: the caller's `inspectorClient` subscribes and
 * runs the triggers; `extra.openConnection` opens the other subscribers.
 */
export async function runFanoutLoadTest(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  fanout: LoadFanoutOptions,
  extra: LoadRunExtras = {},
): Promise<LoadSummary> {
  const triggered =
    args.toolName !== undefined || options.scenario !== undefined;
  // A passive run makes no calls, so only a duration can bound it.
  if (
    !triggered &&
    (options.durationMs === undefined || options.requests !== undefined)
  ) {
    throw new Error(
      "--load-subscribe without a tool listens for --load-duration; --load-requests has no calls to count.",
    );
  }
  const clients = new Map<LoadSubscriber, InspectorClient>();
  const { openConnection } = extra;
  const summary = await runFanout(
    subscriberOf(inspectorClient),
    openConnection &&
      (async () => {
        const client = await openConnection();
        const subscriber = subscriberOf(client);
        clients.set(subscriber, client);
        return subscriber;
      }),
    fanout,
    options,
    triggered
      ? (onSample) => {
          const rest = { ...options };
          delete rest.fanout;
          return runLoadTest(inspectorClient, args, rest, {
            ...extra,
            onSample: (sample) => {
              extra.onSample?.(sample);
              onSample(sample);
            },
          });
        }
      : undefined,
    extra.clock,
    extra.signal,
    (subscriber) => {
      const client = clients.get(subscriber);
      if (client) extra.onConnectionClosed?.(client);
    },
  );
  return summary;
}

/** Runs the triggers, reporting each measured call to `onSample`. */
export type LoadFanoutTriggers = (
  onSample: (sample: LoadSample) => void,
) => Promise<LoadSummary>;

/**
 * The fan-out run over any {@link LoadSubscriber}s. `triggers` absent means
 * a passive run of `options.durationMs`.
 */
export async function runFanout<S extends LoadSubscriber>(
  primary: S,
  open: (() => Promise<S>) | undefined,
  fanout: LoadFanoutOptions,
  options: LoadOptions,
  triggers: LoadFanoutTriggers | undefined,
  clock: LoadClock = realClock,
  signal?: AbortSignal,
  onClosed?: (subscriber: S) => void,
): Promise<LoadSummary> {
  const { uri, subscribers: requested, settleMs } = fanout;
  if (requested > 1 && !open) {
    throw new Error("--load-subscribers above 1 needs a way to open sessions.");
  }
  const errors = new ErrorTally();
  const connectTimes: number[] = [];
  const subscribeTimes: number[] = [];
  const extras: S[] = [];
  const listening: { subscriber: S; stop: () => void; unsubscribe: boolean }[] =
    [];
  // Receipts are only counted once a session is in `listening`; until then
  // a notification on it goes nowhere.
  const tally = new FanoutTally(triggers !== undefined);
  const failure = (err: unknown): void =>
    errors.add(err instanceof Error ? err.message : String(err));

  // Subscribe one session and start listening; a failure is tallied.
  const subscribe = async (subscriber: S): Promise<void> => {
    // A session already subscribed (an mcpdo connection someone is
    // streaming) is listened on as it is, and left subscribed afterwards.
    const already = subscriber.isSubscribedToResource(uri);
    let index: number | undefined;
    const stop = subscriber.onResourceUpdated((updated) => {
      if (updated === uri && index !== undefined) {
        tally.receive(index, clock.now());
      }
    });
    try {
      if (!already) {
        const t0 = clock.now();
        await subscriber.subscribeToResource(uri);
        subscribeTimes.push(clock.now() - t0);
      }
      index = tally.addSession();
      listening.push({ subscriber, stop, unsubscribe: !already });
    } catch (err) {
      stop();
      failure(err);
    }
  };

  try {
    await Promise.allSettled(
      Array.from({ length: requested - 1 }, async () => {
        const t0 = clock.now();
        try {
          const subscriber = await open!();
          extras.push(subscriber);
          connectTimes.push(clock.now() - t0);
        } catch (err) {
          failure(err);
        }
      }),
    );
    await Promise.all([primary, ...extras].map(subscribe));
    if (listening.length === 0) {
      const [first] = errors.entries();
      throw new Error(
        `--load-subscribe: no session could subscribe to ${uri}${first ? ` (${first.message})` : ""}.`,
      );
    }

    // The run: the triggers, or a passive listen.
    let summary: LoadSummary;
    if (triggers) {
      summary = await triggers((sample) => {
        // A sample arrives as its call completes, so its start is now minus
        // its latency. Only successful triggers are expected to update.
        if (sample.outcome === "ok") {
          tally.addTrigger(clock.now() - sample.latencyMs);
        }
      });
    } else {
      // Setup is over: what arrived before now is not measured.
      tally.startPassive(clock.now());
      summary = await listenPassively(options, clock, signal);
    }
    // What arrives from here on can only catch a subscriber up, never add
    // an update to wait for.
    tally.freeze();

    // Give every subscriber `settleMs` to receive what it should have.
    const settleUntil = clock.now() + settleMs;
    while (!signal?.aborted && !tally.done() && clock.now() < settleUntil) {
      await sleepUnlessAborted(
        clock,
        Math.min(SETTLE_STEP_MS, settleUntil - clock.now()),
        signal,
      );
    }
    // An interrupt while settling still ends the run as one (exit 130).
    if (signal?.aborted && summary.stoppedEarly === undefined) {
      summary = { ...summary, stoppedEarly: stopFromAbort(signal.reason) };
    }

    return {
      ...summary,
      fanout: tally.summarize({
        uri,
        requested,
        failed: requested - listening.length,
        connectMs: summarizeLatency(connectTimes),
        subscribeMs: summarizeLatency(subscribeTimes),
        errorMessages: errors.entries(),
      }),
    };
  } finally {
    for (const l of listening) l.stop();
    await Promise.allSettled(
      listening
        .filter((l) => l.unsubscribe && l.subscriber === primary)
        .map((l) => l.subscriber.unsubscribeFromResource(uri)),
    );
    await Promise.allSettled(
      extras.map((s) => s.disconnect().finally(() => onClosed?.(s))),
    );
  }
}

/**
 * A passive run's summary: no calls, just the window it listened for, ended
 * early by `signal` with the stop it names.
 */
async function listenPassively(
  options: LoadOptions,
  clock: LoadClock,
  signal: AbortSignal | undefined,
): Promise<LoadSummary> {
  const start = clock.now();
  // `runFanoutLoadTest` refuses a passive run without one.
  const durationMs = options.durationMs!;
  await sleepUnlessAborted(clock, durationMs, signal);
  const elapsedMs = clock.now() - start;
  return {
    concurrency: options.concurrency,
    durationMs,
    requests: 0,
    ok: 0,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    throughput: 0,
    okThroughput: 0,
    latencyMs: null,
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
    ...(signal?.aborted && { stoppedEarly: stopFromAbort(signal.reason) }),
  };
}

/**
 * Most unmatched receipts a session holds, and most passive updates tracked
 * for their first receipt. Past it a receipt is counted but not timed, so a
 * server flooding notifications nobody asked for cannot grow memory.
 */
export const MAX_FANOUT_PENDING = 10_000;

type SessionTally = {
  /** Receipts matched to an update: delivered. */
  matched: number;
  /** Triggered: receipts waiting for their trigger's start to be known. */
  pending: number[];
  /** Receipts that matched no update: early, extra, or past the cap. */
  unexpected: number;
};

/**
 * The fan-out measurement, folded in as notifications arrive so memory stays
 * bounded however long the run: delivery latencies go to a
 * {@link LatencyRecorder}, and only what cannot be matched yet is held.
 *
 * - **Triggered**: a session's k-th notification belongs to the k-th
 *   successful trigger and is timed from its start. A notification can
 *   arrive before its trigger's sample does (the server notifies before it
 *   answers), so it waits in `pending` until then. One that predates the
 *   start of the trigger it would match — a notification from setup, or the
 *   server's own — cannot have been caused by it, and is counted as
 *   unexpected instead.
 * - **Passive**: a session's k-th notification is update k, timed from the
 *   first receipt of update k on any session. Only notifications after
 *   {@link startPassive} count.
 *
 * {@link freeze} fixes the number of updates when the run ends, so the
 * catch-up wait only lets subscribers reach it.
 */
export class FanoutTally {
  private readonly sessions: SessionTally[] = [];
  private readonly delivery = new LatencyRecorder();
  /** Triggered: starts of successful triggers, from ordinal `startBase`. */
  private starts: number[] = [];
  private startBase = 0;
  private triggerCount = 0;
  /** Passive: first receipt of each update still being received. */
  private readonly firsts = new Map<number, { at: number; seen: number }>();
  /** Passive: updates seen so far; any below it without a `firsts` entry was evicted. */
  private passiveUpdates = 0;
  private passiveFrom = Infinity;
  private frozen: number | undefined;

  private readonly triggered: boolean;

  constructor(triggered: boolean) {
    this.triggered = triggered;
  }

  /** Register a subscribed session; returns its index. */
  addSession(): number {
    this.sessions.push({ matched: 0, pending: [], unexpected: 0 });
    return this.sessions.length - 1;
  }

  /** Triggered: a successful trigger started at `at`. */
  addTrigger(at: number): void {
    this.starts.push(at);
    this.triggerCount++;
    for (const s of this.sessions) this.drain(s);
    this.trimStarts();
  }

  /** Passive: measure from `at` on. */
  startPassive(at: number): void {
    this.passiveFrom = at;
  }

  /** The run is over: no more updates to wait for. */
  freeze(): void {
    this.frozen = this.updates;
  }

  /** A notification reached session `index` at `at`. */
  receive(index: number, at: number): void {
    const s = this.sessions[index]!;
    if (this.triggered) {
      if (s.pending.length >= MAX_FANOUT_PENDING) {
        s.unexpected++;
        return;
      }
      s.pending.push(at);
      this.drain(s);
      return;
    }
    const k = s.matched;
    if (
      at < this.passiveFrom ||
      (this.frozen !== undefined && k >= this.frozen)
    ) {
      s.unexpected++;
      return;
    }
    s.matched++;
    const first = this.firsts.get(k);
    if (first === undefined && k < this.passiveUpdates) {
      // Its first receipt was evicted (another subscriber ran more than
      // MAX_FANOUT_PENDING updates ahead): delivered, but with nothing to
      // time it from.
      return;
    }
    if (first === undefined) {
      this.passiveUpdates = k + 1;
      this.delivery.add(0);
      this.firsts.set(k, { at, seen: 1 });
      // Bounded: the oldest update (lowest k, inserted first) goes.
      if (this.firsts.size > MAX_FANOUT_PENDING) {
        this.firsts.delete(this.firsts.keys().next().value!);
      }
      return;
    }
    this.delivery.add(Math.max(0, at - first.at));
    if (++first.seen === this.sessions.length) this.firsts.delete(k);
  }

  /** Updates each subscriber should receive. */
  get updates(): number {
    if (this.frozen !== undefined) return this.frozen;
    return this.triggered
      ? this.triggerCount
      : Math.max(0, ...this.sessions.map((s) => s.matched));
  }

  /** Every subscriber has received every update. */
  done(): boolean {
    const updates = this.updates;
    return this.sessions.every((s) => s.matched >= updates);
  }

  summarize(
    base: Pick<
      LoadFanoutSummary,
      | "uri"
      | "requested"
      | "failed"
      | "connectMs"
      | "subscribeMs"
      | "errorMessages"
    >,
  ): LoadFanoutSummary {
    const updates = this.updates;
    let delivered = 0;
    let unexpected = 0;
    let sessionsMissed = 0;
    for (const s of this.sessions) {
      delivered += s.matched;
      // Still pending once every trigger is known: matches no update.
      unexpected += s.unexpected + s.pending.length;
      if (s.matched < updates) sessionsMissed++;
    }
    return {
      uri: base.uri,
      mode: this.triggered ? "triggered" : "passive",
      requested: base.requested,
      subscribed: this.sessions.length,
      failed: base.failed,
      connectMs: base.connectMs,
      subscribeMs: base.subscribeMs,
      errorMessages: base.errorMessages,
      updates,
      delivered,
      missed: updates * this.sessions.length - delivered,
      sessionsMissed,
      unexpected,
      deliveryMs: this.delivery.summarize(),
    };
  }

  /** Match a session's pending receipts to the triggers known so far. */
  private drain(s: SessionTally): void {
    while (s.pending.length > 0 && s.matched < this.triggerCount) {
      const at = s.pending.shift()!;
      if (s.matched < this.startBase) {
        // That trigger's start was evicted (see `trimStarts`): delivered,
        // but with nothing to time it from.
        s.matched++;
        continue;
      }
      const start = this.starts[s.matched - this.startBase]!;
      if (at < start) {
        s.unexpected++;
        continue;
      }
      this.delivery.add(at - start);
      s.matched++;
    }
  }

  /**
   * Drop trigger starts every session has matched past, and — so a silent
   * subscriber cannot hold them all — any beyond the newest
   * {@link MAX_FANOUT_PENDING}; a receipt for an evicted one is delivered
   * but untimed.
   */
  private trimStarts(): void {
    const passed = Math.max(
      Math.min(...this.sessions.map((s) => s.matched)),
      this.triggerCount - MAX_FANOUT_PENDING,
    );
    const drop = passed - this.startBase;
    if (drop >= 1024) {
      this.starts = this.starts.slice(drop);
      this.startBase = passed;
    }
  }
}
