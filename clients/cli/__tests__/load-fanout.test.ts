import { describe, it, expect } from "vitest";
import {
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
  type TestServerContext,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";
import { fakeClock } from "./helpers/load-clock.js";
import {
  DEFAULT_LOAD_SUBSCRIBE_WAIT_SEC,
  resolveLoadOptions,
  type LoadOptions,
  type LoadSample,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  runFanout,
  FanoutTally,
  MAX_FANOUT_PENDING,
  type LoadFanoutOptions,
  type LoadFanoutSummary,
  type LoadSubscriber,
} from "@inspector/core/cli/handlers/load-fanout.js";
import { formatLoadSummaryHuman } from "@inspector/core/cli/handlers/load-format.js";
import { compareLoadToBaseline } from "@inspector/core/cli/handlers/load-baseline.js";

/**
 * `--load-subscribe` (#2913): notification fan-out across subscribed
 * sessions, triggered by the load run or passive.
 */

const URI = "test://fanout";

type FakeSubscriber = LoadSubscriber & {
  id: number;
  subscribed: boolean;
  closed: boolean;
  /** Deliver an update to this session's listeners. */
  deliver: (uri?: string) => void;
};

function fakeSubscriber(
  id: number,
  options: { failSubscribe?: boolean; alreadySubscribed?: boolean } = {},
): FakeSubscriber {
  const listeners = new Set<(uri: string) => void>();
  const s: FakeSubscriber = {
    id,
    subscribed: options.alreadySubscribed === true,
    closed: false,
    disconnect: async () => {
      s.closed = true;
    },
    subscribeToResource: async () => {
      if (options.failSubscribe) throw new Error("subscribe refused");
      s.subscribed = true;
    },
    unsubscribeFromResource: async () => {
      s.subscribed = false;
    },
    isSubscribedToResource: () => s.subscribed,
    onResourceUpdated: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    deliver: (uri = URI) => {
      for (const l of listeners) l(uri);
    },
  };
  return s;
}

const FANOUT: LoadFanoutOptions = { uri: URI, subscribers: 3, settleMs: 50 };
const OPTIONS: LoadOptions = { concurrency: 1, requests: 3, fanout: FANOUT };

/** A trigger run summary: only what the fan-out code reads or passes on. */
function triggerSummary(requests: number): LoadSummary {
  return {
    tool: "bump",
    concurrency: 1,
    requests,
    ok: requests,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 10,
    throughput: 0,
    okThroughput: 0,
    latencyMs: null,
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
  };
}

/**
 * Triggers that, for each call, deliver the update to `deliverTo` after
 * `delayMs` of fake time each, then report the call's sample.
 */
function triggers(
  clock: ReturnType<typeof fakeClock>,
  calls: number,
  deliverTo: () => FakeSubscriber[],
  options: { delayMs?: number; failSeq?: number } = {},
) {
  return async (onSample: (s: LoadSample) => void) => {
    for (let seq = 1; seq <= calls; seq++) {
      const start = clock.now();
      clock.advance(1);
      const failed = seq === options.failSeq;
      if (!failed) {
        for (const s of deliverTo()) {
          clock.advance(options.delayMs ?? 2);
          s.deliver();
        }
      }
      onSample({
        seq,
        worker: 0,
        startMs: 0,
        latencyMs: clock.now() - start,
        outcome: failed ? "tool_error" : "ok",
      });
    }
    return triggerSummary(calls);
  };
}

describe("resolveLoadOptions with --load-subscribe", () => {
  it("defaults to one subscriber, a 2 s wait, and one trigger at a time", () => {
    const options = resolveLoadOptions({ subscribe: URI, requests: 5 });
    expect(options.concurrency).toBe(1);
    expect(options.fanout).toEqual({
      uri: URI,
      subscribers: 1,
      settleMs: DEFAULT_LOAD_SUBSCRIBE_WAIT_SEC * 1000,
    });
    expect(
      resolveLoadOptions({
        subscribe: URI,
        subscribers: 4,
        subscribeWaitSec: 0.5,
        concurrency: 1,
      }).fanout,
    ).toEqual({ uri: URI, subscribers: 4, settleMs: 500 });
    expect(resolveLoadOptions({ requests: 5 })).not.toHaveProperty("fanout");
  });

  it.each([
    [{ subscribers: 2 }, "--load-subscribers requires --load-subscribe."],
    [
      { subscribeWaitSec: 1 },
      "--load-subscribe-wait requires --load-subscribe.",
    ],
    [
      { subscribe: URI, connections: 2, concurrency: 1 },
      "--load-subscribe cannot be combined with --load-connections.",
    ],
    [
      { subscribe: URI, churn: true },
      "--load-subscribe cannot be combined with --load-churn.",
    ],
    [
      {
        subscribe: URI,
        stages: { by: "rate" as const, levels: [1], stageMs: 10 },
      },
      "--load-subscribe cannot be combined with --load-steps or --load-ramp.",
    ],
    [
      { subscribe: URI, warmupSec: 1 },
      "--load-subscribe cannot be combined with --load-warmup.",
    ],
    [{ subscribe: URI, concurrency: 2 }, "--load-concurrency must be 1"],
  ])("refuses %j", (flags, message) => {
    expect(() => resolveLoadOptions(flags)).toThrow(message);
  });
});

describe("FanoutTally", () => {
  const base = {
    uri: URI,
    requested: 2,
    failed: 0,
    connectMs: null,
    subscribeMs: null,
    errorMessages: [],
  };

  it("times each receipt from its trigger, counting misses and extras", () => {
    const t = new FanoutTally(true);
    const a = t.addSession();
    const b = t.addSession();
    // Notifications land before their trigger's sample does.
    t.receive(a, 12);
    t.receive(b, 14);
    t.addTrigger(10);
    t.receive(a, 25);
    t.addTrigger(20);
    t.receive(b, 30);
    t.receive(a, 33);
    t.addTrigger(30);
    t.receive(a, 40);
    t.freeze();
    expect(t.done()).toBe(false);
    const f = t.summarize(base);
    expect(f).toMatchObject({
      mode: "triggered",
      subscribed: 2,
      updates: 3,
      delivered: 5,
      missed: 1,
      sessionsMissed: 1,
      unexpected: 1,
    });
    // 2, 5, 3 and 4, 10.
    expect(f.deliveryMs).toMatchObject({ min: 2, max: 10 });
  });

  it("counts a notification older than its would-be trigger as unexpected", () => {
    const t = new FanoutTally(true);
    const a = t.addSession();
    // From setup, before any trigger started.
    t.receive(a, 5);
    t.receive(a, 12);
    t.addTrigger(10);
    expect(t.summarize(base)).toMatchObject({
      updates: 1,
      delivered: 1,
      unexpected: 1,
    });
    expect(t.done()).toBe(true);
  });

  it("caps a session's unmatched receipts", () => {
    const t = new FanoutTally(true);
    const a = t.addSession();
    for (let i = 0; i <= MAX_FANOUT_PENDING; i++) t.receive(a, i);
    expect(t.summarize(base).unexpected).toBe(MAX_FANOUT_PENDING + 1);
  });

  it("forgets trigger starts every session has passed", () => {
    const t = new FanoutTally(true);
    const a = t.addSession();
    for (let i = 0; i < 3000; i++) {
      t.receive(a, i * 10 + 1);
      t.addTrigger(i * 10);
    }
    expect(t.summarize(base)).toMatchObject({ updates: 3000, delivered: 3000 });
  });

  it("times a passive receipt from the first subscriber's", () => {
    const t = new FanoutTally(false);
    const a = t.addSession();
    const b = t.addSession();
    // Before the window: setup, not measured.
    t.receive(a, 50);
    t.startPassive(100);
    t.receive(a, 100);
    t.receive(b, 103);
    t.receive(a, 200);
    t.freeze();
    // A new update during the catch-up wait is not one to wait for...
    t.receive(a, 300);
    // ...but a lagging subscriber catching up still counts.
    t.receive(b, 201);
    const f = t.summarize(base);
    expect(f).toMatchObject({
      mode: "passive",
      updates: 2,
      delivered: 4,
      missed: 0,
      unexpected: 2,
    });
    expect(f.deliveryMs).toMatchObject({ min: 0, max: 3 });
  });

  it("caps the passive updates it tracks for their first receipt", () => {
    const t = new FanoutTally(false);
    const a = t.addSession();
    t.addSession();
    t.startPassive(0);
    for (let i = 0; i <= MAX_FANOUT_PENDING; i++) t.receive(a, i);
    expect(t.summarize(base).delivered).toBe(MAX_FANOUT_PENDING + 1);
  });

  it("has no latency when nothing was delivered", () => {
    const t = new FanoutTally(false);
    t.addSession();
    expect(t.summarize(base)).toMatchObject({
      updates: 0,
      delivered: 0,
      deliveryMs: null,
    });
  });
});

describe("runFanout", () => {
  it("subscribes every session, matches notifications to triggers, and cleans up", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const extras: FakeSubscriber[] = [];
    const closed: FakeSubscriber[] = [];
    const summary = await runFanout(
      primary,
      async () => {
        clock.advance(5);
        const s = fakeSubscriber(extras.length + 1);
        extras.push(s);
        return s;
      },
      FANOUT,
      OPTIONS,
      triggers(clock, 3, () => [primary, ...extras]),
      clock,
      undefined,
      (s) => closed.push(s),
    );
    expect(summary.requests).toBe(3);
    expect(summary.fanout).toMatchObject({
      uri: URI,
      mode: "triggered",
      requested: 3,
      subscribed: 3,
      failed: 0,
      updates: 3,
      delivered: 9,
      missed: 0,
      unexpected: 0,
    });
    expect(summary.fanout!.connectMs!.p50).toBe(5);
    expect(summary.fanout!.subscribeMs).not.toBeNull();
    // Delivered to sessions 2 ms apart, after a 1 ms head start.
    expect(summary.fanout!.deliveryMs).toMatchObject({ min: 3, max: 7 });
    expect(primary.subscribed).toBe(false);
    expect(primary.closed).toBe(false);
    expect(extras.every((s) => s.closed)).toBe(true);
    expect(closed).toEqual(extras);
  });

  it("matches the k-th notification to the k-th successful trigger", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const summary = await runFanout(
      primary,
      undefined,
      { ...FANOUT, subscribers: 1 },
      OPTIONS,
      triggers(clock, 3, () => [primary], { failSeq: 2 }),
      clock,
    );
    expect(summary.fanout).toMatchObject({ updates: 2, delivered: 2 });
  });

  it("waits for late subscribers, then counts what never came as missed", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const late = fakeSubscriber(1);
    // `late` gets the update 20 ms after the run, inside the 50 ms wait.
    const summary = await runFanout(
      primary,
      async () => late,
      { ...FANOUT, subscribers: 2 },
      OPTIONS,
      async (onSample) => {
        const result = await triggers(clock, 2, () => [primary])(onSample);
        // Fires as the settle wait advances the fake clock.
        void clock.sleep(20).then(() => late.deliver());
        return result;
      },
      clock,
    );
    expect(summary.fanout).toMatchObject({
      updates: 2,
      delivered: 3,
      missed: 1,
      sessionsMissed: 1,
    });
  });

  it("counts sessions that fail to open or to subscribe, and goes on", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    let n = 0;
    const summary = await runFanout(
      primary,
      async () => {
        n++;
        if (n === 1) throw new Error("too many sessions");
        return fakeSubscriber(n, { failSubscribe: true });
      },
      FANOUT,
      OPTIONS,
      triggers(clock, 1, () => [primary]),
      clock,
    );
    expect(summary.fanout).toMatchObject({
      requested: 3,
      subscribed: 1,
      failed: 2,
      errorMessages: expect.arrayContaining([
        { message: "too many sessions", count: 1 },
        { message: "subscribe refused", count: 1 },
      ]),
    });
  });

  it("fails outright when no session can subscribe", async () => {
    await expect(
      runFanout(
        fakeSubscriber(0, { failSubscribe: true }),
        undefined,
        { ...FANOUT, subscribers: 1 },
        OPTIONS,
        undefined,
        fakeClock(),
      ),
    ).rejects.toThrow(
      `--load-subscribe: no session could subscribe to ${URI} (subscribe refused).`,
    );
  });

  it("listens on, and leaves subscribed, a session that already was", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0, { alreadySubscribed: true });
    const summary = await runFanout(
      primary,
      undefined,
      { ...FANOUT, subscribers: 1 },
      OPTIONS,
      triggers(clock, 1, () => [primary]),
      clock,
    );
    expect(summary.fanout).toMatchObject({ delivered: 1, subscribeMs: null });
    expect(primary.subscribed).toBe(true);
  });

  it("ignores other resources' notifications", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const summary = await runFanout(
      primary,
      undefined,
      { ...FANOUT, subscribers: 1 },
      OPTIONS,
      async (onSample) => {
        primary.deliver("test://other");
        return triggers(clock, 1, () => [primary])(onSample);
      },
      clock,
    );
    expect(summary.fanout).toMatchObject({ delivered: 1, unexpected: 0 });
  });

  it("listens passively for the duration", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const other = fakeSubscriber(1);
    // Fire as the passive listen advances the fake clock.
    void clock.sleep(1).then(() => primary.deliver());
    void clock.sleep(5).then(() => other.deliver());
    const summary = await runFanout(
      primary,
      async () => other,
      { ...FANOUT, subscribers: 2 },
      { concurrency: 1, durationMs: 1000, fanout: FANOUT },
      undefined,
      clock,
    );
    expect(summary).toMatchObject({ requests: 0, durationMs: 1000 });
    expect(summary).not.toHaveProperty("stoppedEarly");
    expect(summary.fanout).toMatchObject({
      mode: "passive",
      updates: 1,
      delivered: 2,
    });
    expect(summary.fanout!.deliveryMs).toMatchObject({ min: 0, max: 4 });
  });

  it("ends a passive run early on an interrupt", async () => {
    const stop = new AbortController();
    stop.abort();
    const summary = await runFanout(
      fakeSubscriber(0),
      undefined,
      { ...FANOUT, subscribers: 1 },
      { concurrency: 1, durationMs: 60_000, fanout: FANOUT },
      undefined,
      fakeClock(),
      stop.signal,
    );
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
  });

  it("reports an interrupt during the catch-up wait", async () => {
    const clock = fakeClock();
    const primary = fakeSubscriber(0);
    const stop = new AbortController();
    const summary = await runFanout(
      primary,
      undefined,
      { ...FANOUT, subscribers: 1, settleMs: 1000 },
      OPTIONS,
      async (onSample) => {
        const result = await triggers(clock, 1, () => [])(onSample);
        void clock.sleep(5).then(() => stop.abort());
        return result;
      },
      clock,
      stop.signal,
    );
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
    expect(summary.fanout).toMatchObject({ updates: 1, missed: 1 });
  });

  it("names the stop a passive run was aborted with", async () => {
    const stop = new AbortController();
    stop.abort({
      reason: "connection_lost",
      detail: "the connection went error",
    });
    const summary = await runFanout(
      fakeSubscriber(0),
      undefined,
      { ...FANOUT, subscribers: 1 },
      { concurrency: 1, durationMs: 60_000, fanout: FANOUT },
      undefined,
      fakeClock(),
      stop.signal,
    );
    expect(summary.stoppedEarly).toEqual({
      reason: "connection_lost",
      detail: "the connection went error",
    });
  });

  it("needs a way to open more than one session", async () => {
    await expect(
      runFanout(fakeSubscriber(0), undefined, FANOUT, OPTIONS, undefined),
    ).rejects.toThrow(
      "--load-subscribers above 1 needs a way to open sessions.",
    );
  });
});

describe("the fan-out summary", () => {
  const fanout: LoadFanoutSummary = {
    uri: URI,
    mode: "triggered",
    requested: 3,
    subscribed: 2,
    failed: 1,
    connectMs: null,
    subscribeMs: {
      min: 1,
      mean: 1,
      p50: 1,
      p90: 2,
      p95: 2,
      p99: 2,
      p999: 2,
      max: 2,
    },
    errorMessages: [{ message: "refused", count: 1 }],
    updates: 4,
    delivered: 7,
    missed: 1,
    sessionsMissed: 1,
    unexpected: 0,
    deliveryMs: {
      min: 1,
      mean: 2,
      p50: 2,
      p90: 3,
      p95: 3,
      p99: 3,
      p999: 3,
      max: 3,
    },
  };
  const summary: LoadSummary = { ...triggerSummary(4), fanout };

  it("reads as a fan-out block in the text summary", () => {
    const text = formatLoadSummaryHuman(summary);
    expect(text).toContain(
      "Fan-out:    `test://fanout`, triggered; 2 of 3 sessions subscribed, 1 failed (subscribe p50 1 / max 2 ms)",
    );
    expect(text).toContain(
      "Delivered:  7 of 8 notifications (4 updates × 2), 1 missed across 1 sessions, 0 unexpected",
    );
    expect(text).toContain("Delivery:   min 1 / mean 2");
    expect(text).toContain("    1× refused");
    const quiet = formatLoadSummaryHuman({
      ...summary,
      fanout: {
        ...fanout,
        subscribeMs: null,
        deliveryMs: null,
        errorMessages: [],
      },
    });
    expect(quiet).not.toContain("Delivery:");
    expect(quiet).toContain("1 failed\n");
  });

  it("is part of a baseline's shape", () => {
    const other = { ...summary, fanout: { ...fanout, requested: 5 } };
    expect(() =>
      compareLoadToBaseline(summary, { source: "b.json", summary: other }),
    ).toThrow('fan-out is {"uri":"test://fanout","subscribers":3');
  });
});

describe("--load-subscribe (CLI)", () => {
  /** A server whose `bump` tool notifies every session subscribed. */
  function fanoutServer() {
    const subscribed: TestServerContext[] = [];
    const notifyAll = async (): Promise<void> => {
      await Promise.all(
        subscribed.map((c) =>
          c.server.server.sendResourceUpdated({ uri: URI }).catch(() => {}),
        ),
      );
    };
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-fanout", "1.0.0"),
      subscriptions: true,
      resources: [{ uri: URI, name: "fanout", text: "v" }],
      onResourceSubscribe: (_uri, context) => subscribed.push(context),
      tools: [
        {
          name: "bump",
          description: "Updates the resource",
          inputSchema: {},
          handler: async () => {
            await notifyAll();
            return { content: [{ type: "text", text: "bumped" }] };
          },
        },
      ],
    });
    return { server, notifyAll, subscribed };
  }

  const http = (url: string) => [
    url,
    "--cli",
    "--transport",
    "http",
    "--method",
    "tools/call",
    "--load",
    "--load-subscribe",
    URI,
  ];

  it("fans a triggered update out to every subscribed session", async () => {
    const { server } = fanoutServer();
    try {
      await server.start();
      const result = await runCli([
        ...http(server.url),
        "--tool-name",
        "bump",
        "--load-requests",
        "3",
        "--load-subscribers",
        "3",
        "--load-subscribe-wait",
        "1",
      ]);
      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toMatchObject({
        tool: "bump",
        concurrency: 1,
        requests: 3,
        ok: 3,
        fanout: {
          uri: URI,
          mode: "triggered",
          requested: 3,
          subscribed: 3,
          updates: 3,
          delivered: 9,
          missed: 0,
        },
      });
      expect(json.fanout.deliveryMs).not.toBeNull();
    } finally {
      await server.stop();
    }
  });

  it("listens passively to the server's own updates", async () => {
    const { server, notifyAll, subscribed } = fanoutServer();
    // The server's own updates: every 50 ms once anyone has subscribed.
    const timer = setInterval(() => {
      if (subscribed.length >= 2) void notifyAll();
    }, 50);
    try {
      await server.start();
      const result = await runCli([
        ...http(server.url),
        "--load-duration",
        "0.5",
        "--load-subscribers",
        "2",
      ]);
      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toMatchObject({
        requests: 0,
        fanout: { mode: "passive", subscribed: 2 },
      });
      expect(json).not.toHaveProperty("tool");
      expect(json.fanout.updates).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
      await server.stop();
    }
  });

  const { command, args } = getTestMcpServerCommand();
  it.each([
    [
      ["--method", "tools/call", "--load-subscribe", URI],
      "--load-subscribe requires --load.",
    ],
    [
      ["--method", "tools/call", "--load-subscribers", "2"],
      "--load-subscribers requires --load.",
    ],
    [
      ["--method", "tools/call", "--load-subscribe-wait", "1"],
      "--load-subscribe-wait requires --load.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-subscribers", "2"],
      "--load-subscribers requires --load-subscribe.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--load",
        "--load-subscribe",
        URI,
        "--load-subscribers",
        "2",
      ],
      "--load-subscribers above 1 requires an HTTP or SSE server",
    ],
    [
      [
        "--method",
        "tools/call",
        "--load",
        "--load-subscribe",
        URI,
        "--load-requests",
        "3",
      ],
      "--load-subscribe without a tool listens for --load-duration",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  });
});
