import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import {
  PollRunner,
  PushRunner,
  type PollRunnerOptions,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_POLL_FLOOR_MS,
  type PushRoutes,
  type PushRunnerRequest,
  type RunnerCallbacks,
} from "@inspector/core/extension/events/subscriptionRunners.js";
import {
  EVENTS_ACTIVE_NOTIFICATION,
  EVENTS_ERROR_CODES,
  EVENTS_ERROR_NOTIFICATION,
  EVENTS_EVENT_NOTIFICATION,
  EVENTS_HEARTBEAT_NOTIFICATION,
  EVENTS_TERMINATED_NOTIFICATION,
} from "@inspector/core/extension/events/constants.js";
import type {
  EventOccurrence,
  PollEventsResult,
} from "@inspector/core/extension/events/schemas.js";

/**
 * The poll and push loops on their own (#3029), driven with fake timers so
 * every interval rule the spec states — the poll floor, the `hasMore` drain,
 * the 3x-heartbeat liveness check, jittered reconnects — is asserted on the
 * clock rather than raced against it.
 */

function rpcError(code: number, message: string, data?: unknown) {
  return Object.assign(new Error(message), { code, data });
}

type MockCallbacks = { [K in keyof RunnerCallbacks]: Mock<RunnerCallbacks[K]> };

function callbacks(): MockCallbacks {
  return {
    update: vi.fn<RunnerCallbacks["update"]>(),
    occurrences: vi.fn<RunnerCallbacks["occurrences"]>(),
    gap: vi.fn<RunnerCallbacks["gap"]>(),
    error: vi.fn<RunnerCallbacks["error"]>(),
    reconnect: vi.fn<RunnerCallbacks["reconnect"]>(),
    terminated: vi.fn<RunnerCallbacks["terminated"]>(),
  };
}

function occurrence(eventId: string, cursor?: string | null): EventOccurrence {
  return {
    eventId,
    name: "t",
    timestamp: "2026-11-24T00:00:00Z",
    data: { n: 1 },
    ...(cursor !== undefined && { cursor }),
  };
}

function pollResult(
  overrides: Partial<PollEventsResult> = {},
): PollEventsResult {
  return {
    events: [],
    cursor: "c1",
    truncated: false,
    hasMore: false,
    nextPollMs: 5000,
    ...overrides,
  };
}

/** Let settled promises run their handlers without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PollRunner (#3029)", () => {
  function runner(
    results: Array<PollEventsResult | Error>,
    options: { pollFloorMs?: number; cursor?: string | null } = {},
  ) {
    const cb = callbacks();
    const poll = vi.fn<PollRunnerOptions["poll"]>(async () => {
      const next = results.shift();
      if (next === undefined) return new Promise<PollEventsResult>(() => {});
      if (next instanceof Error) throw next;
      return next;
    });
    const r = new PollRunner({
      request: { arguments: { a: 1 }, maxEvents: 5, maxAgeMs: 100 },
      cursor: options.cursor ?? null,
      pollFloorMs: options.pollFloorMs,
      poll,
      callbacks: cb,
      random: () => 0.5,
      reconnectJitterMs: 1000,
      maxReconnectDelayMs: 4000,
    });
    return { r, cb, poll };
  }

  it("persists the cursor and waits nextPollMs between polls", async () => {
    const { r, cb, poll } = runner([
      pollResult({ cursor: "c1", events: [occurrence("e1")] }),
      pollResult({ cursor: "c2" }),
    ]);
    r.start();
    r.start(); // idempotent
    await flush();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll.mock.calls[0]![0]).toEqual({
      arguments: { a: 1 },
      maxEvents: 5,
      maxAgeMs: 100,
      cursor: null,
    });
    expect(cb.occurrences).toHaveBeenCalledWith([occurrence("e1")]);
    expect(cb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        cursor: "c1",
        nextPollMs: 5000,
      }),
    );
    expect(r.cursor).toBe("c1");

    await vi.advanceTimersByTimeAsync(4999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll.mock.calls[1]![0]).toMatchObject({ cursor: "c1" });
    r.stop();
  });

  it("applies the floor so a server answering 0 cannot induce a tight loop", async () => {
    const { r, poll } = runner([
      pollResult({ nextPollMs: 0 }),
      pollResult({ nextPollMs: 0 }),
    ]);
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_FLOOR_MS - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it("honors a configured floor", async () => {
    const { r, poll } = runner([pollResult({ nextPollMs: 10 })], {
      pollFloorMs: 3000,
    });
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(2999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it("drains immediately on hasMore, ignoring nextPollMs", async () => {
    const { r, poll, cb } = runner([
      pollResult({ cursor: "p1", hasMore: true, events: [occurrence("a")] }),
      pollResult({ cursor: "p2", hasMore: true, events: [occurrence("b")] }),
      pollResult({ cursor: "p3", events: [occurrence("c")] }),
    ]);
    r.start();
    // Zero-delay drains only; far short of the 5 s `nextPollMs`.
    await vi.advanceTimersByTimeAsync(10);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poll.mock.calls.map((c) => c[0]?.cursor)).toEqual([
      null,
      "p1",
      "p2",
    ]);
    expect(cb.occurrences).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it("surfaces truncated as a gap, except for a type with no replay", async () => {
    const { r, cb } = runner([
      pollResult({ cursor: "fresh", truncated: true }),
      pollResult({ cursor: null, truncated: true }),
    ]);
    r.start();
    await flush();
    expect(cb.gap).toHaveBeenCalledWith("fresh");
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb.gap).toHaveBeenCalledTimes(1);
    expect(r.cursor).toBeNull();
    r.stop();
  });

  it("treats an absent cursor as null and keeps polling with null", async () => {
    const { r, poll } = runner(
      [pollResult({ cursor: undefined }), pollResult()],
      { cursor: "start" },
    );
    r.start();
    await flush();
    expect(r.cursor).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll.mock.calls[1]![0].cursor).toBeNull();
    r.stop();
  });

  it("ends the subscription on a terminal JSON-RPC error", async () => {
    const forbidden = rpcError(EVENTS_ERROR_CODES.Forbidden, "Forbidden");
    const { r, cb, poll } = runner([forbidden]);
    r.start();
    await flush();
    expect(cb.terminated).toHaveBeenCalledWith({
      code: EVENTS_ERROR_CODES.Forbidden,
      message: "Forbidden",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure with jittered backoff and resets it on success", async () => {
    const { r, cb, poll } = runner([
      new Error("socket hang up"),
      rpcError(-32603, "UpstreamError"),
      pollResult(),
    ]);
    r.start();
    await flush();
    expect(cb.error).toHaveBeenCalledWith({
      code: -32603,
      message: "socket hang up",
      data: { transport: true },
    });
    expect(cb.update).toHaveBeenCalledWith({ status: "reconnecting" });
    expect(cb.reconnect).toHaveBeenCalledWith("poll failed: socket hang up");
    // floor 1000 + 0.5 * 1000
    await vi.advanceTimersByTimeAsync(1499);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(cb.error).toHaveBeenLastCalledWith({
      code: -32603,
      message: "UpstreamError",
    });
    // Second failure doubles the window: 1000 + 0.5 * 2000.
    await vi.advanceTimersByTimeAsync(1999);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(cb.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "active" }),
    );
    r.stop();
  });

  it("describes a non-Error rejection", async () => {
    const { r, cb } = runner([]);
    const poll = vi.fn(() => Promise.reject("boom"));
    const direct = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll,
      callbacks: cb,
    });
    direct.start();
    await flush();
    expect(cb.reconnect).toHaveBeenCalledWith("poll failed: boom");
    direct.stop();
    r.stop();
  });

  it("aborts the in-flight poll on stop and ignores its late result", async () => {
    const cb = callbacks();
    let signal: AbortSignal | undefined;
    let resolve!: (r: PollEventsResult) => void;
    const r = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll: (_params, s) => {
        signal = s;
        return new Promise((res) => (resolve = res));
      },
      callbacks: cb,
    });
    r.start();
    r.stop();
    expect(signal?.aborted).toBe(true);
    resolve(pollResult());
    await flush();
    expect(cb.update).not.toHaveBeenCalled();
    r.start(); // a stopped runner does not restart
    await flush();
  });

  it("ignores a failure that lands after stop", async () => {
    const cb = callbacks();
    let reject!: (e: unknown) => void;
    const r = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll: () => new Promise((_res, rej) => (reject = rej)),
      callbacks: cb,
    });
    r.start();
    r.stop();
    reject(new Error("late"));
    await flush();
    expect(cb.error).not.toHaveBeenCalled();
  });

  it("reports nothing more once the update callback stopped it", async () => {
    const cb = callbacks();
    const poll = vi.fn(async () =>
      pollResult({ truncated: true, events: [occurrence("x")] }),
    );
    const r: PollRunner = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll,
      callbacks: { ...cb, update: () => r.stop() },
    });
    r.start();
    await flush();
    expect(cb.occurrences).not.toHaveBeenCalled();
    expect(cb.gap).not.toHaveBeenCalled();
  });

  it("does not report a gap once the occurrences callback stopped it", async () => {
    const cb = callbacks();
    const poll = vi.fn(async () =>
      pollResult({ truncated: true, events: [occurrence("x")] }),
    );
    const r: PollRunner = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll,
      callbacks: { ...cb, occurrences: () => r.stop() },
    });
    r.start();
    await flush();
    expect(cb.gap).not.toHaveBeenCalled();
  });

  it("does not schedule another poll when a callback stopped the runner", async () => {
    const cb = callbacks();
    const poll = vi.fn(async () => pollResult({ truncated: true }));
    const r: PollRunner = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll,
      callbacks: { ...cb, gap: () => r.stop() },
    });
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a retry when the error callback stopped the runner", async () => {
    const cb = callbacks();
    const poll = vi.fn(async () => {
      throw new Error("down");
    });
    const r: PollRunner = new PollRunner({
      request: { arguments: {} },
      cursor: null,
      poll,
      callbacks: { ...cb, reconnect: () => r.stop() },
    });
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

describe("PushRunner (#3029)", () => {
  interface Opened {
    params: PushRunnerRequest & { cursor: string | null };
    signal: AbortSignal;
    resolve: () => void;
    reject: (e: unknown) => void;
  }

  function setup(
    request: PushRunnerRequest = { arguments: {} },
    cursor: string | null = null,
  ) {
    const cb = callbacks();
    const opened: Opened[] = [];
    const routes = new Map<string | number, PushRunner>();
    const routeTable: PushRoutes = {
      bind: (id, r) => routes.set(id, r),
      unbind: (id, r) => {
        if (routes.get(id) === r) routes.delete(id);
      },
    };
    let nextId = 100;
    const stream = vi.fn(
      (
        params: PushRunnerRequest & { cursor: string | null },
        options: {
          signal: AbortSignal;
          onSubscriptionId: (id: string | number) => void;
        },
      ) =>
        new Promise<unknown>((resolve, reject) => {
          options.onSubscriptionId(nextId++);
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          opened.push({
            params,
            signal: options.signal,
            resolve: () => resolve({}),
            reject,
          });
        }),
    );
    const r = new PushRunner({
      request,
      cursor,
      stream,
      routes: routeTable,
      callbacks: cb,
      random: () => 0.5,
      reconnectJitterMs: 1000,
      maxReconnectDelayMs: 4000,
    });
    return { r, cb, opened, routes, stream };
  }

  it("opens a stream, routes by subscription id and advances the cursor", async () => {
    const { r, cb, opened, routes } = setup(
      { arguments: { s: 1 }, heartbeatMs: 200, maxAgeMs: 50 },
      "resume",
    );
    r.start();
    r.start(); // idempotent
    expect(opened).toHaveLength(1);
    expect(opened[0]!.params).toEqual({
      arguments: { s: 1 },
      heartbeatMs: 200,
      maxAgeMs: 50,
      cursor: "resume",
    });
    expect(routes.get(100)).toBe(r);
    expect(cb.update).toHaveBeenCalledWith({ subscriptionId: 100 });

    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      cursor: "a1",
      truncated: false,
      heartbeatMs: 300,
      _meta: {},
    });
    // `_meta` is required by the strict schema: missing id -> malformed.
    expect(cb.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Malformed notifications/events/active",
        ),
      }),
    );

    const meta = { _meta: { "io.modelcontextprotocol/subscriptionId": 100 } };
    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      cursor: "a1",
      truncated: false,
      heartbeatMs: 300,
      ...meta,
    });
    expect(cb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        cursor: "a1",
        grantedHeartbeatMs: 300,
      }),
    );
    expect(cb.gap).not.toHaveBeenCalled();

    r.handleNotification(EVENTS_EVENT_NOTIFICATION, {
      ...occurrence("e1", "a2"),
      ...meta,
    });
    expect(cb.occurrences).toHaveBeenCalledWith([
      expect.objectContaining({ eventId: "e1", cursor: "a2" }),
    ]);
    expect(r.cursor).toBe("a2");

    r.handleNotification(EVENTS_HEARTBEAT_NOTIFICATION, {
      cursor: "a3",
      ...meta,
    });
    expect(r.cursor).toBe("a3");

    r.handleNotification(EVENTS_ERROR_NOTIFICATION, {
      error: { code: -32603, message: "UpstreamError" },
      ...meta,
    });
    expect(cb.error).toHaveBeenLastCalledWith({
      code: -32603,
      message: "UpstreamError",
    });

    // A truncated active with a cursor is a gap; the stream stays open.
    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      cursor: "fresh",
      truncated: true,
      heartbeatMs: 300,
      ...meta,
    });
    expect(cb.gap).toHaveBeenCalledWith("fresh");

    r.stop();
    expect(opened[0]!.signal.aborted).toBe(true);
    expect(routes.size).toBe(0);
    await flush();
    expect(cb.reconnect).not.toHaveBeenCalled();
  });

  it("reports malformed event, heartbeat, error and terminated notifications", () => {
    const { r, cb } = setup();
    r.start();
    for (const method of [
      EVENTS_EVENT_NOTIFICATION,
      EVENTS_HEARTBEAT_NOTIFICATION,
      EVENTS_ERROR_NOTIFICATION,
      EVENTS_TERMINATED_NOTIFICATION,
    ] as const) {
      r.handleNotification(method, { cursor: 5 });
    }
    expect(cb.error).toHaveBeenCalledTimes(4);
    expect(cb.terminated).not.toHaveBeenCalled();
    r.stop();
    // A stopped runner ignores everything.
    r.handleNotification(EVENTS_HEARTBEAT_NOTIFICATION, { cursor: "x" });
    expect(cb.update).toHaveBeenCalledTimes(1);
  });

  it("ignores a truncated active for a type with no replay", () => {
    const { r, cb } = setup();
    r.start();
    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      truncated: true,
      heartbeatMs: 100,
      _meta: { "io.modelcontextprotocol/subscriptionId": 100 },
    });
    expect(cb.gap).not.toHaveBeenCalled();
    expect(r.cursor).toBeNull();
    r.stop();
  });

  it("treats 3x the granted heartbeat of silence as a dead stream and reconnects with the last cursor", async () => {
    const { r, cb, opened, routes } = setup({ arguments: {} });
    r.start();
    const meta = { _meta: { "io.modelcontextprotocol/subscriptionId": 100 } };
    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      cursor: "k1",
      truncated: false,
      heartbeatMs: 1000,
      ...meta,
    });
    // Each message restarts the clock.
    await vi.advanceTimersByTimeAsync(2500);
    r.handleNotification(EVENTS_HEARTBEAT_NOTIFICATION, {
      cursor: "k2",
      ...meta,
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(cb.reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cb.reconnect).toHaveBeenCalledWith(
      "no message on the stream for 3000 ms",
    );
    expect(cb.update).toHaveBeenCalledWith({ status: "reconnecting" });
    expect(opened[0]!.signal.aborted).toBe(true);
    // The aborted request's rejection is ignored, not reported.
    await flush();
    expect(cb.error).not.toHaveBeenCalled();
    // The old id stays routed until the reconnect actually happens.
    expect(routes.get(100)).toBe(r);

    // Jitter: 0.5 * 1000.
    await vi.advanceTimersByTimeAsync(499);
    expect(opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opened).toHaveLength(2);
    expect(opened[1]!.params.cursor).toBe("k2");
    expect(routes.has(100)).toBe(false);
    expect(routes.get(101)).toBe(r);
    r.stop();
  });

  it("gives an unconfirmed stream 3x the 30 s default, ignoring a shorter suggestion", async () => {
    // The suggestion is the client's; the server may grant longer, and the
    // spec counts silence from `active` against the grant.
    const { r, cb } = setup({ arguments: {}, heartbeatMs: 100 });
    r.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_MS * 3 - 1);
    expect(cb.reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cb.reconnect).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it("reports nothing more once a callback has stopped it", () => {
    const meta = { _meta: { "io.modelcontextprotocol/subscriptionId": 100 } };
    for (const [method, params, next] of [
      [
        EVENTS_ACTIVE_NOTIFICATION,
        { cursor: "c", truncated: true, heartbeatMs: 100 },
        "gap",
      ],
      [EVENTS_EVENT_NOTIFICATION, occurrence("e"), "occurrences"],
      [
        EVENTS_ERROR_NOTIFICATION,
        { error: { code: -32603, message: "x" } },
        "error",
      ],
    ] as const) {
      const { r, cb } = setup();
      cb.update.mockImplementation((update) => {
        if (update.subscriptionId === undefined) r.stop();
      });
      r.start();
      r.handleNotification(method, { ...params, ...meta });
      expect(cb[next]).not.toHaveBeenCalled();
    }
  });

  it("reconnects after a server close with no terminated, with growing backoff reset by active", async () => {
    const { r, cb, opened } = setup();
    r.start();
    opened[0]!.resolve();
    await flush();
    expect(cb.reconnect).toHaveBeenCalledWith(
      "the server closed the stream without terminating it",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(opened).toHaveLength(2);

    opened[1]!.reject(new Error("ECONNRESET"));
    await flush();
    expect(cb.error).toHaveBeenCalledWith({
      code: -32603,
      message: "ECONNRESET",
      data: { transport: true },
    });
    expect(cb.reconnect).toHaveBeenLastCalledWith(
      "the stream failed: ECONNRESET",
    );
    // Second consecutive failure: 0.5 * 2000.
    await vi.advanceTimersByTimeAsync(999);
    expect(opened).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(opened).toHaveLength(3);

    r.handleNotification(EVENTS_ACTIVE_NOTIFICATION, {
      truncated: false,
      heartbeatMs: 10_000,
      _meta: { "io.modelcontextprotocol/subscriptionId": 102 },
    });
    opened[2]!.reject(rpcError(-32603, "Internal"));
    await flush();
    // Reset by the active: back to 0.5 * 1000.
    await vi.advanceTimersByTimeAsync(500);
    expect(opened).toHaveLength(4);
    r.stop();
  });

  it("a terminated notification that lands after the final frame still ends the subscription", async () => {
    const { r, cb, opened } = setup();
    r.start();
    opened[0]!.resolve();
    await flush();
    expect(cb.reconnect).toHaveBeenCalledTimes(1);
    r.handleNotification(EVENTS_TERMINATED_NOTIFICATION, {
      error: { code: EVENTS_ERROR_CODES.NotFound, message: "gone" },
      _meta: { "io.modelcontextprotocol/subscriptionId": 100 },
    });
    expect(cb.terminated).toHaveBeenCalledWith({
      code: EVENTS_ERROR_CODES.NotFound,
      message: "gone",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opened).toHaveLength(1);
  });

  it("ends the subscription when the request is refused", async () => {
    const { r, cb, opened } = setup();
    r.start();
    opened[0]!.reject(
      rpcError(EVENTS_ERROR_CODES.Unsupported, "no push", {
        feature: "deliveryMode",
      }),
    );
    await flush();
    expect(cb.terminated).toHaveBeenCalledWith({
      code: EVENTS_ERROR_CODES.Unsupported,
      message: "no push",
      data: { feature: "deliveryMode" },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opened).toHaveLength(1);
  });

  it("does not reopen when the reconnect callback stopped the runner", async () => {
    const cb = callbacks();
    const stream = vi.fn(() => Promise.resolve({}));
    const r: PushRunner = new PushRunner({
      request: { arguments: {} },
      cursor: null,
      stream,
      routes: { bind: vi.fn(), unbind: vi.fn() },
      callbacks: { ...cb, reconnect: () => r.stop() },
    });
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("ignores a subscription id reported after the runner moved on", () => {
    const cb = callbacks();
    const bind = vi.fn();
    let report!: (id: string | number) => void;
    const r = new PushRunner({
      request: { arguments: {} },
      cursor: null,
      stream: (_params, { onSubscriptionId }) => {
        report = onSubscriptionId;
        return new Promise(() => {});
      },
      routes: { bind, unbind: vi.fn() },
      callbacks: cb,
    });
    r.start();
    r.stop();
    report(1);
    expect(bind).not.toHaveBeenCalled();
  });

  it("describes a non-Error stream failure", async () => {
    const cb = callbacks();
    const r = new PushRunner({
      request: { arguments: {} },
      cursor: null,
      stream: () => Promise.reject("nope"),
      routes: { bind: vi.fn(), unbind: vi.fn() },
      callbacks: cb,
      random: () => 0,
    });
    r.start();
    await flush();
    expect(cb.reconnect).toHaveBeenCalledWith("the stream failed: nope");
    r.stop();
  });
});
