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
  MAX_TIMER_DELAY_MS,
  MAX_WEBHOOK_REFRESH_LEAD_MS,
  MIN_WEBHOOK_REFRESH_DELAY_MS,
  WebhookRunner,
  webhookRefreshDelay,
  type RunnerCallbacks,
  type WebhookRunnerOptions,
} from "@inspector/core/extension/events/subscriptionRunners.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";
import type { SubscribeEventsResult } from "@inspector/core/extension/events/schemas.js";

/**
 * The webhook management loop on its own (#3031), with fake timers: the
 * refresh scheduled from the granted `refreshBefore`, the cursor re-sent on
 * every refresh, `truncated` and `deliveryStatus` handed on, terminal errors
 * ending it and transport failures retried.
 */

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const HOUR = 3_600_000;

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

function granted(
  overrides: Partial<SubscribeEventsResult> = {},
): SubscribeEventsResult {
  return {
    id: "sub_1",
    refreshBefore: new Date(Date.now() + HOUR).toISOString(),
    cursor: "c1",
    truncated: false,
    ...overrides,
  };
}

const DELIVERY = {
  mode: "webhook" as const,
  url: "https://hooks.example.com/in",
  secret: `whsec_${btoa("k".repeat(32))}`,
};

function runner(
  results: Array<
    SubscribeEventsResult | Error | (() => SubscribeEventsResult) | "hang"
  >,
  options: Partial<WebhookRunnerOptions> = {},
) {
  const cb = callbacks();
  const subscribe = vi.fn<WebhookRunnerOptions["subscribe"]>(async () => {
    const next = results.shift();
    if (next === undefined || next === "hang") {
      return new Promise<SubscribeEventsResult>(() => {});
    }
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  const r = new WebhookRunner({
    request: {
      arguments: { severity: "P1" },
      delivery: DELIVERY,
      maxAgeMs: 100,
      ttlMs: HOUR,
    },
    cursor: null,
    subscribe,
    callbacks: cb,
    random: () => 0.5,
    reconnectJitterMs: 1000,
    maxReconnectDelayMs: 4000,
    ...options,
  });
  return { r, cb, subscribe };
}

/** Let settled promises run their handlers without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("webhookRefreshDelay", () => {
  it("is none for no expiry or an unreadable grant", () => {
    expect(webhookRefreshDelay(null, NOW)).toBeUndefined();
    expect(webhookRefreshDelay("soon", NOW)).toBeUndefined();
  });

  it("refreshes after 80% of a short grant", () => {
    const grant = new Date(NOW + 60_000).toISOString();
    expect(webhookRefreshDelay(grant, NOW)).toBe(48_000);
  });

  it("caps the lead, so a long grant refreshes 5 min early", () => {
    const grant = new Date(NOW + 24 * HOUR).toISOString();
    expect(webhookRefreshDelay(grant, NOW)).toBe(
      24 * HOUR - MAX_WEBHOOK_REFRESH_LEAD_MS,
    );
  });

  it("never refreshes sooner than the floor, even for a past grant", () => {
    const past = new Date(NOW - 10_000).toISOString();
    expect(webhookRefreshDelay(past, NOW)).toBe(MIN_WEBHOOK_REFRESH_DELAY_MS);
  });

  it("clamps to the largest timer delay", () => {
    const far = new Date(NOW + 100 * 24 * HOUR).toISOString();
    expect(webhookRefreshDelay(far, NOW)).toBe(MAX_TIMER_DELAY_MS);
  });
});

describe("WebhookRunner (#3031)", () => {
  it("subscribes, reports the grant, and refreshes with the last cursor", async () => {
    const { r, cb, subscribe } = runner([
      granted({ cursor: "c1" }),
      () => granted({ cursor: "c2", deliveryStatus: { active: true } }),
    ]);
    r.start();
    r.start(); // idempotent
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]![0]).toEqual({
      arguments: { severity: "P1" },
      delivery: DELIVERY,
      maxAgeMs: 100,
      ttlMs: HOUR,
      cursor: null,
    });
    expect(cb.update).toHaveBeenLastCalledWith({
      status: "active",
      cursor: "c1",
      lastMessageAt: new Date(NOW),
      webhook: {
        id: "sub_1",
        refreshBefore: new Date(NOW + HOUR).toISOString(),
        deliveryStatus: undefined,
        truncated: false,
        lastRefreshAt: new Date(NOW),
        // An hour's grant: the lead is capped at 5 min.
        nextRefreshAt: new Date(NOW + HOUR - MAX_WEBHOOK_REFRESH_LEAD_MS),
        refreshes: 1,
      },
    });
    expect(r.cursor).toBe("c1");

    const due = HOUR - MAX_WEBHOOK_REFRESH_LEAD_MS;
    await vi.advanceTimersByTimeAsync(due - 1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1]![0]).toMatchObject({ cursor: "c1" });
    expect(cb.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "c2",
        webhook: expect.objectContaining({
          refreshes: 2,
          deliveryStatus: { active: true },
        }),
      }),
    );
    expect(cb.occurrences).not.toHaveBeenCalled();
    r.stop();
  });

  it("schedules nothing for no expiry, but refreshes on request", async () => {
    const { r, cb, subscribe } = runner([
      granted({ refreshBefore: null }),
      granted({ refreshBefore: null, cursor: "c9" }),
    ]);
    expect(r.refreshNow()).toBe(false); // not started
    r.start();
    expect(r.refreshNow()).toBe(false); // in flight
    await flush();
    expect(cb.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({
          refreshBefore: null,
          nextRefreshAt: null,
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(cb.error).not.toHaveBeenCalled();

    expect(r.refreshNow()).toBe(true);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(r.cursor).toBe("c9");
    r.stop();
    expect(r.refreshNow()).toBe(false);
  });

  it("refreshes early on request, replacing the scheduled refresh", async () => {
    const { r, subscribe } = runner([() => granted(), () => granted()]);
    r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    expect(r.refreshNow()).toBe(true);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(2);
    // The old timer (due 55 min in) was cleared; the next is 55 min from now.
    await vi.advanceTimersByTimeAsync(HOUR - MAX_WEBHOOK_REFRESH_LEAD_MS - 1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribe).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it("reports an unreadable grant instead of guessing a cadence", async () => {
    const { r, cb } = runner([granted({ refreshBefore: "whenever" })]);
    r.start();
    await flush();
    expect(cb.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -32603,
        message: expect.stringContaining('Unreadable refreshBefore "whenever"'),
      }),
    );
    r.stop();
  });

  it("reports truncated as a gap, unless the type has no replay", async () => {
    const replaying = runner([granted({ truncated: true, cursor: "c5" })]);
    replaying.r.start();
    await flush();
    expect(replaying.cb.gap).toHaveBeenCalledWith("c5");
    replaying.r.stop();

    const emitOnly = runner([granted({ truncated: true, cursor: null })]);
    emitOnly.r.start();
    await flush();
    expect(emitOnly.cb.gap).not.toHaveBeenCalled();
    emitOnly.r.stop();
  });

  it.each([
    ["CallbackEndpointError", EVENTS_ERROR_CODES.CallbackEndpointError],
    ["Forbidden", EVENTS_ERROR_CODES.Forbidden],
    ["InvalidParams", -32602],
  ])("ends on %s", async (_name, code) => {
    const { r, cb, subscribe } = runner([
      rpcError(code, "no", { reason: "challenge_failed" }),
    ]);
    r.start();
    await flush();
    expect(cb.terminated).toHaveBeenCalledWith({
      code,
      message: "no",
      data: { reason: "challenge_failed" },
    });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(r.refreshNow()).toBe(false);
  });

  it("retries a transport failure with backoff, then resets it", async () => {
    const { r, cb, subscribe } = runner([
      new Error("socket hang up"),
      new Error("again"),
      granted(),
    ]);
    r.start();
    await flush();
    expect(cb.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "socket hang up" }),
    );
    expect(cb.update).toHaveBeenCalledWith({ status: "reconnecting" });
    expect(cb.reconnect).toHaveBeenCalledWith(
      "subscribe failed: socket hang up",
    );
    // floor 1000 + 0.5 * 1000
    await vi.advanceTimersByTimeAsync(1499);
    expect(subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    // second failure: floor 1000 + 0.5 * 2000
    await vi.advanceTimersByTimeAsync(2000);
    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(cb.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "active" }),
    );
    r.stop();
  });

  it("describes a non-Error failure", async () => {
    const { r, cb } = runner([]);
    const failing = new WebhookRunner({
      request: { arguments: {}, delivery: DELIVERY },
      cursor: null,
      subscribe: () => Promise.reject("nope"),
      callbacks: cb,
      random: () => 0,
    });
    failing.start();
    await flush();
    expect(cb.reconnect).toHaveBeenCalledWith("subscribe failed: nope");
    failing.stop();
    r.stop();
  });

  it("aborts an in-flight subscribe on stop and ignores its outcome", async () => {
    let signal: AbortSignal | undefined;
    let settle: (result: SubscribeEventsResult) => void = () => {};
    const cb = callbacks();
    const r = new WebhookRunner({
      request: { arguments: {}, delivery: DELIVERY },
      cursor: "c0",
      subscribe: (_params, s) => {
        signal = s;
        return new Promise((resolve) => (settle = resolve));
      },
      callbacks: cb,
    });
    r.start();
    r.stop();
    expect(signal?.aborted).toBe(true);
    settle(granted());
    await flush();
    expect(cb.update).not.toHaveBeenCalled();
    r.start(); // a stopped runner does not start again
    expect(r.cursor).toBe("c0");
  });

  it("stops reporting once a callback stops it", async () => {
    const { r, cb } = runner([granted({ truncated: true })]);
    cb.update.mockImplementation(() => r.stop());
    r.start();
    await flush();
    expect(cb.gap).not.toHaveBeenCalled();

    const second = runner([granted({ truncated: true })]);
    second.cb.gap.mockImplementation(() => second.r.stop());
    second.r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(second.subscribe).toHaveBeenCalledTimes(1);

    const third = runner([new Error("x")]);
    third.cb.reconnect.mockImplementation(() => third.r.stop());
    third.r.start();
    await flush();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(third.subscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the injected clock for the schedule", async () => {
    const { r, cb } = runner([granted()], { now: () => NOW - HOUR });
    r.start();
    await flush();
    // Grant is 2 h after the injected now: lead capped at 5 min.
    expect(cb.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastMessageAt: new Date(NOW - HOUR),
        webhook: expect.objectContaining({
          nextRefreshAt: new Date(NOW + HOUR - MAX_WEBHOOK_REFRESH_LEAD_MS),
        }),
      }),
    );
    r.stop();
  });
});
