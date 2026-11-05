import type { InspectorClient } from "../../mcp/index.js";
import type { MethodArgs } from "./method-types.js";
import { summarizeLatency, LatencyRecorder } from "./load-latency.js";
import {
  ErrorTally,
  realClock,
  runLoadTest,
  sleepUnlessAborted,
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
    unsubscribeFromResource: (uri) => client.unsubscribeFromResource(uri),
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
  const tally = new ErrorTally();
  const connectTimes: number[] = [];
  const subscribeTimes: number[] = [];
  const extras: S[] = [];
  const listening: {
    subscriber: S;
    receipts: number[];
    stop: () => void;
    unsubscribe: boolean;
  }[] = [];
  const failure = (err: unknown): void =>
    tally.add(err instanceof Error ? err.message : String(err));

  // Subscribe one session and start listening; a failure is tallied.
  const subscribe = async (subscriber: S): Promise<void> => {
    // A session already subscribed (an mcpdo connection someone is
    // streaming) is listened on as it is, and left subscribed afterwards.
    const already = subscriber.isSubscribedToResource(uri);
    const receipts: number[] = [];
    const stop = subscriber.onResourceUpdated((updated) => {
      if (updated === uri) receipts.push(clock.now());
    });
    try {
      if (!already) {
        const t0 = clock.now();
        await subscriber.subscribeToResource(uri);
        subscribeTimes.push(clock.now() - t0);
      }
      listening.push({ subscriber, receipts, stop, unsubscribe: !already });
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
      throw new Error(
        `--load-subscribe: no session could subscribe to ${uri}${
          tally.entries()[0] ? ` (${tally.entries()[0]!.message})` : ""
        }.`,
      );
    }

    // The run: the triggers, or a passive listen.
    const triggerStarts: { seq: number; at: number }[] = [];
    let summary: LoadSummary;
    if (triggers) {
      summary = await triggers((sample) => {
        // A sample arrives as its call completes: its start is now minus
        // its latency. Only successful triggers are expected to update.
        if (sample.outcome === "ok") {
          triggerStarts.push({
            seq: sample.seq,
            at: clock.now() - sample.latencyMs,
          });
        }
      });
    } else {
      summary = await listenPassively(options, clock, signal);
    }
    triggerStarts.sort((a, b) => a.seq - b.seq);

    // Give every subscriber `settleMs` to receive what it should have.
    const expected = (): number =>
      triggers
        ? triggerStarts.length
        : Math.max(...listening.map((l) => l.receipts.length));
    const settleUntil = clock.now() + settleMs;
    while (
      !signal?.aborted &&
      listening.some((l) => l.receipts.length < expected()) &&
      clock.now() < settleUntil
    ) {
      await sleepUnlessAborted(
        clock,
        Math.min(SETTLE_STEP_MS, settleUntil - clock.now()),
        signal,
      );
    }

    return {
      ...summary,
      fanout: tallyFanout(
        listening.map((l) => l.receipts),
        triggers ? triggerStarts.map((t) => t.at) : undefined,
        {
          uri,
          requested,
          failed: requested - listening.length,
          connectMs: summarizeLatency(connectTimes),
          subscribeMs: summarizeLatency(subscribeTimes),
          errorMessages: tally.entries(),
        },
      ),
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
 * early by `signal`.
 */
async function listenPassively(
  options: LoadOptions,
  clock: LoadClock,
  signal: AbortSignal | undefined,
): Promise<LoadSummary> {
  const start = clock.now();
  // Resolved by the CLI layers; a passive run always has a duration.
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
    ...(signal?.aborted && {
      stoppedEarly: {
        reason: "interrupted" as const,
        detail: "the run was interrupted",
      },
    }),
  };
}

/**
 * Match each subscriber's receipts to updates and summarize. The k-th
 * receipt on a session is the k-th update; its reference time is the k-th
 * trigger's start, or (passive, `triggerStarts` absent) the earliest receipt
 * of update k on any session.
 */
export function tallyFanout(
  receipts: number[][],
  triggerStarts: number[] | undefined,
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
  const updates =
    triggerStarts?.length ?? Math.max(0, ...receipts.map((r) => r.length));
  const reference: number[] =
    triggerStarts ??
    Array.from({ length: updates }, (_, k) =>
      Math.min(...receipts.filter((r) => r.length > k).map((r) => r[k]!)),
    );
  const delivery = new LatencyRecorder();
  let delivered = 0;
  let unexpected = 0;
  let sessionsMissed = 0;
  for (const session of receipts) {
    const matched = Math.min(session.length, updates);
    for (let k = 0; k < matched; k++) {
      delivery.add(Math.max(0, session[k]! - reference[k]!));
    }
    delivered += matched;
    unexpected += session.length - matched;
    if (matched < updates) sessionsMissed++;
  }
  return {
    uri: base.uri,
    mode: triggerStarts ? "triggered" : "passive",
    requested: base.requested,
    subscribed: receipts.length,
    failed: base.failed,
    connectMs: base.connectMs,
    subscribeMs: base.subscribeMs,
    errorMessages: base.errorMessages,
    updates,
    delivered,
    missed: updates * receipts.length - delivered,
    sessionsMissed,
    unexpected,
    deliveryMs: delivery.summarize(),
  };
}
