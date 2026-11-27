import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EventSubscriptionsState,
  type EventLogEntry,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import {
  EVENTS_ACTIVE_NOTIFICATION,
  EVENTS_ERROR_CODES,
  EVENTS_EVENT_NOTIFICATION,
  EVENTS_HEARTBEAT_NOTIFICATION,
  EVENTS_TERMINATED_NOTIFICATION,
} from "@inspector/core/extension/events/constants.js";
import type {
  EventOccurrence,
  EventType,
  PollEventsResult,
} from "@inspector/core/extension/events/schemas.js";
import { eventSubscriptionKey } from "@inspector/core/extension/events/canonicalJson.js";
import { EventsEngineFakeClient, EventsFakeClient } from "./eventsFake";

/**
 * The Events subscription registry (#3029) over a fake client: the engine's
 * own rules — keying, dedup, validation, the log, termination and the
 * resubscribe offer — with the wire replaced by queued poll results and
 * hand-settled streams. The same flows against the real fixture are in
 * `src/test/integration/mcp/eventSubscriptions.test.ts`.
 */

const typed: EventType = {
  name: "incident.created",
  delivery: ["poll", "push"],
  inputSchema: { type: "object" },
  payloadSchema: {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
  },
};

function occurrence(
  eventId: string,
  data: Record<string, unknown> = { n: 1 },
  cursor?: string,
): EventOccurrence {
  return {
    eventId,
    name: typed.name,
    timestamp: "2026-11-24T00:00:00Z",
    data,
    ...(cursor !== undefined && { cursor }),
  };
}

function polled(overrides: Partial<PollEventsResult> = {}): PollEventsResult {
  return {
    events: [],
    cursor: "c",
    truncated: false,
    hasMore: false,
    nextPollMs: 1000,
    ...overrides,
  };
}

function rpcError(code: number, message: string, data?: unknown) {
  return Object.assign(new Error(message), { code, data });
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const kinds = (log: EventLogEntry[]) => log.map((e) => e.kind);

describe("EventSubscriptionsState (#3029)", () => {
  let client: EventsEngineFakeClient;
  let state: EventSubscriptionsState;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new EventsEngineFakeClient();
    state = new EventSubscriptionsState(client, { random: () => 0 });
  });

  afterEach(() => {
    state.destroy();
    vi.useRealTimers();
  });

  describe("subscribe", () => {
    it("refuses when the connection does not offer Events", () => {
      client.eventsExtension = undefined;
      expect(() => state.subscribe(typed, { mode: "poll" })).toThrow(
        /does not offer the Events extension/,
      );
    });

    it("refuses a mode the type does not advertise", () => {
      expect(() =>
        state.subscribe({ ...typed, delivery: ["poll"] }, { mode: "push" }),
      ).toThrow(/does not advertise push delivery/);
    });

    it("refuses on a client without the method", () => {
      const plain = new EventsFakeClient();
      const plainState = new EventSubscriptionsState(plain);
      expect(() => plainState.subscribe(typed, { mode: "poll" })).toThrow(
        /cannot run poll subscriptions/,
      );
      expect(() => plainState.subscribe(typed, { mode: "push" })).toThrow(
        /cannot run push subscriptions/,
      );
      plainState.destroy();
    });

    it("keys by name, canonical arguments and mode, and is idempotent", () => {
      const a = state.subscribe(typed, {
        mode: "poll",
        arguments: { x: 1, y: 2 },
        maxEvents: 5,
        maxAgeMs: 100,
        heartbeatMs: 99,
      });
      expect(a.id).toBe(
        eventSubscriptionKey(typed.name, { x: 1, y: 2 }, "poll"),
      );
      expect(a).toMatchObject({
        status: "starting",
        cursor: null,
        maxEvents: 5,
        maxAgeMs: 100,
      });
      // heartbeatMs is a push option, so a poll subscription does not keep it.
      expect(a.heartbeatMs).toBeUndefined();
      const again = state.subscribe(typed, {
        mode: "poll",
        arguments: { y: 2, x: 1 },
      });
      expect(again).toBe(a);
      expect(client.pollEvents).toHaveBeenCalledTimes(1);

      const push = state.subscribe(typed, {
        mode: "push",
        arguments: { x: 1, y: 2 },
        heartbeatMs: 200,
        maxEvents: 3,
      });
      expect(push.id).not.toBe(a.id);
      expect(push.heartbeatMs).toBe(200);
      expect(push.maxEvents).toBeUndefined();
      expect(state.getSubscriptions().map((s) => s.mode)).toEqual([
        "poll",
        "push",
      ]);
      expect(state.getSubscription(a.id)).toBe(a);
    });
  });

  describe("poll", () => {
    it("runs, persists the cursor, dedups by eventId, flags invalid payloads and marks gaps", async () => {
      client.pollResults.push(
        polled({ cursor: "c1", events: [occurrence("e1")] }),
        polled({
          cursor: "c2",
          truncated: true,
          events: [occurrence("e1"), occurrence("e2", { n: "bad" })],
        }),
      );
      const sub = state.subscribe(typed, {
        mode: "poll",
        arguments: { a: 1 },
        cursor: "start",
        maxEvents: 2,
        maxAgeMs: 9,
      });
      await flush();
      expect(client.pollEvents).toHaveBeenCalledWith(
        typed,
        { arguments: { a: 1 }, cursor: "start", maxEvents: 2, maxAgeMs: 9 },
        undefined,
        { signal: expect.any(AbortSignal) },
      );
      expect(state.getSubscription(sub.id)).toMatchObject({
        status: "active",
        cursor: "c1",
        nextPollMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      const current = state.getSubscription(sub.id)!;
      expect(current.cursor).toBe("c2");
      expect(current.counts).toEqual({
        events: 2,
        duplicates: 1,
        invalidPayloads: 1,
        gaps: 1,
        errors: 0,
        reconnects: 0,
      });
      const log = state.getLog(sub.id);
      expect(kinds(log)).toEqual(["event", "event", "gap"]);
      const invalid = log[1]!;
      expect(invalid.kind === "event" && invalid.payloadError).toMatch(
        /payloadSchema/,
      );
      expect(log[0]!.kind === "event" && log[0]!.payloadError).toBeUndefined();
      // The verdict is recorded with the entry (#3030).
      expect(log[0]!.kind === "event" && log[0]!.payload).toBe("valid");
      expect(invalid.kind === "event" && invalid.payload).toBe("invalid");
      expect(log.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    it("logs a transient failure and the retry", async () => {
      client.pollResults.push(new Error("down"));
      const sub = state.subscribe(typed, { mode: "poll" });
      await flush();
      expect(state.getSubscription(sub.id)).toMatchObject({
        status: "reconnecting",
        lastError: { message: "down" },
        counts: expect.objectContaining({ errors: 1, reconnects: 1 }),
      });
      expect(kinds(state.getLog())).toEqual(["error", "reconnect"]);
    });

    it("ends with Forbidden and offers no resubscribe", async () => {
      client.pollResults.push(
        rpcError(EVENTS_ERROR_CODES.Forbidden, "Forbidden"),
      );
      const sub = state.subscribe(typed, { mode: "poll" });
      await flush();
      const ended = state.getSubscription(sub.id)!;
      expect(ended.status).toBe("terminated");
      expect(ended.termination).toMatchObject({
        reason: "forbidden",
        relist: "skipped",
        canResubscribe: false,
      });
      expect(client.listAllEvents).not.toHaveBeenCalled();
      expect(state.getLog().at(-1)).toMatchObject({
        kind: "terminated",
        reason: "forbidden",
      });
      expect(() => state.resubscribe(sub.id)).toThrow(/cannot be resumed/);
    });
  });

  describe("push", () => {
    it("routes notifications by subscription id and ignores ones it does not hold", async () => {
      const sub = state.subscribe(typed, {
        mode: "push",
        arguments: { s: 1 },
        heartbeatMs: 100,
        maxAgeMs: 5,
      });
      const stream = client.lastStream();
      expect(stream.params).toEqual({
        arguments: { s: 1 },
        cursor: null,
        heartbeatMs: 100,
        maxAgeMs: 5,
      });
      expect(state.getSubscription(sub.id)!.subscriptionId).toBe(stream.id);

      client.notify(EVENTS_ACTIVE_NOTIFICATION, stream.id, {
        cursor: "k0",
        truncated: false,
        heartbeatMs: 1000,
      });
      // Another stream's id, and a notification with no id at all.
      client.notify(EVENTS_EVENT_NOTIFICATION, 999, occurrence("stray"));
      client.dispatchTypedEvent("eventsStreamNotification", {
        method: EVENTS_HEARTBEAT_NOTIFICATION,
        params: { cursor: "zz" },
      });
      // A string echo of a numeric id still routes.
      client.notify(
        EVENTS_EVENT_NOTIFICATION,
        String(stream.id),
        occurrence("e1", { n: 1 }, "k1"),
      );

      const current = state.getSubscription(sub.id)!;
      expect(current).toMatchObject({
        status: "active",
        cursor: "k1",
        grantedHeartbeatMs: 1000,
      });
      expect(current.lastMessageAt).toBeInstanceOf(Date);
      expect(kinds(state.getLog())).toEqual(["event"]);
    });

    it("re-lists after NotFound and offers a resubscribe that resumes from the cursor", async () => {
      const sub = state.subscribe(typed, { mode: "push" });
      const first = client.lastStream();
      client.notify(EVENTS_ACTIVE_NOTIFICATION, first.id, {
        cursor: "k5",
        truncated: false,
        heartbeatMs: 1000,
      });
      const relisted: EventType = { ...typed, description: "v2" };
      client.eventPages.push({ events: [relisted], excluded: [] });
      client.notify(EVENTS_TERMINATED_NOTIFICATION, first.id, {
        error: { code: EVENTS_ERROR_CODES.NotFound, message: "gone" },
      });
      expect(first.signal?.aborted).toBe(true);
      expect(state.getSubscription(sub.id)!.termination).toMatchObject({
        reason: "removed",
        relist: "pending",
        canResubscribe: false,
      });
      await flush();
      const offered = state.getSubscription(sub.id)!;
      expect(offered.termination).toMatchObject({
        relist: "done",
        canResubscribe: true,
      });
      expect(offered.eventType).toBe(relisted);

      const resumed = state.resubscribe(sub.id);
      expect(resumed.status).toBe("starting");
      expect(resumed.termination).toBeUndefined();
      expect(client.lastStream().params.cursor).toBe("k5");
      expect(client.lastStream().eventType).toBe(relisted);
      // Running: resubscribe is a no-op that returns the live one.
      expect(state.resubscribe(sub.id)).toBe(state.getSubscription(sub.id));
    });

    it("offers no resubscribe when the re-list no longer has the type (or its mode)", async () => {
      const sub = state.subscribe(typed, { mode: "push" });
      client.eventPages.push({
        events: [{ ...typed, delivery: ["poll"] }],
        excluded: [],
      });
      client.lastStream().reject(
        rpcError(EVENTS_ERROR_CODES.Unsupported, "Unsupported", {
          reason: "schema_changed",
        }),
      );
      await flush();
      await flush();
      expect(state.getSubscription(sub.id)!.termination).toMatchObject({
        reason: "schema_changed",
        relist: "done",
        canResubscribe: false,
      });

      const gone = state.subscribe(
        { ...typed, name: "other" },
        { mode: "push" },
      );
      client.lastStream().reject(rpcError(-32020, "HeaderMismatch"));
      await flush();
      await flush();
      expect(state.getSubscription(gone.id)!.termination).toMatchObject({
        reason: "header_mismatch",
        relist: "done",
        canResubscribe: false,
      });
      expect(state.getSubscription(gone.id)!.eventType.name).toBe("other");
    });

    it("records a failed re-list, whether it rejects or throws", async () => {
      const rejecting = new EventSubscriptionsState(client, {
        relist: () => Promise.reject(new Error("list failed")),
      });
      const a = rejecting.subscribe(typed, { mode: "push" });
      client.lastStream().reject(rpcError(EVENTS_ERROR_CODES.NotFound, "x"));
      await flush();
      await flush();
      expect(rejecting.getSubscription(a.id)!.termination?.relist).toBe(
        "failed",
      );
      rejecting.destroy();

      const throwing = new EventSubscriptionsState(client, {
        relist: () => {
          throw new Error("sync");
        },
      });
      const b = throwing.subscribe(typed, { mode: "push" });
      client.lastStream().reject(rpcError(EVENTS_ERROR_CODES.NotFound, "x"));
      await flush();
      await flush();
      expect(throwing.getSubscription(b.id)!.termination?.relist).toBe(
        "failed",
      );
      throwing.destroy();
    });

    it("drops a re-list outcome for a subscription that was removed meanwhile", async () => {
      let finish!: (types: EventType[]) => void;
      let fail!: (err: unknown) => void;
      const slow = new EventSubscriptionsState(client, {
        relist: () =>
          new Promise<EventType[]>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      });
      const a = slow.subscribe(typed, { mode: "push" });
      client.lastStream().reject(rpcError(EVENTS_ERROR_CODES.NotFound, "x"));
      await flush();
      slow.remove(a.id);
      finish([typed]);
      await flush();
      expect(slow.getSubscription(a.id)).toBeUndefined();

      const b = slow.subscribe(typed, { mode: "push" });
      client.lastStream().reject(rpcError(EVENTS_ERROR_CODES.NotFound, "x"));
      await flush();
      slow.remove(b.id);
      fail(new Error("late"));
      await flush();
      expect(slow.getSubscriptions()).toEqual([]);
      slow.destroy();
    });

    it("logs reconnects after a dropped stream", async () => {
      const sub = state.subscribe(typed, { mode: "push" });
      client.lastStream().reject(new Error("ECONNRESET"));
      await flush();
      expect(state.getSubscription(sub.id)!.status).toBe("reconnecting");
      expect(kinds(state.getLog())).toEqual(["error", "reconnect"]);
      await flush();
      expect(client.streams).toHaveLength(2);
    });
  });

  describe("request metadata (#3062)", () => {
    const META = { "com.example/trace": "abc" };

    it("sends it on a push stream and on every reconnect", async () => {
      state.subscribe(typed, { mode: "push", metadata: META });
      expect(client.streamEvents.mock.calls[0]![2]).toMatchObject({
        metadata: META,
      });
      client.lastStream().reject(new Error("ECONNRESET"));
      await flush();
      await flush();
      expect(client.streamEvents).toHaveBeenCalledTimes(2);
      expect(client.streamEvents.mock.calls[1]![2]).toMatchObject({
        metadata: META,
      });
    });

    it("sends it on every poll", async () => {
      state.subscribe(typed, { mode: "poll", metadata: META });
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(client.pollEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const call of client.pollEvents.mock.calls) {
        expect(call[2]).toEqual(META);
      }
    });

    it("sends none when the caller gave none", async () => {
      state.subscribe(typed, { mode: "poll" });
      await flush();
      expect(client.pollEvents.mock.calls[0]![2]).toBeUndefined();
      state.subscribe(typed, { mode: "push" });
      expect(client.streamEvents.mock.calls[0]![2]?.metadata).toBeUndefined();
    });

    it("keeps it across a resume that omits it, and takes new metadata over it", async () => {
      const sub = state.subscribe(typed, { mode: "poll", metadata: META });
      await flush();
      state.stop(sub.id);
      state.subscribe(typed, { mode: "poll" });
      await flush();
      expect(client.pollEvents.mock.calls[1]![2]).toEqual(META);

      const NEXT = { "com.example/trace": "def" };
      state.stop(sub.id);
      state.subscribe(typed, { mode: "poll", metadata: NEXT });
      await flush();
      expect(client.pollEvents.mock.calls[2]![2]).toEqual(NEXT);
    });
  });

  describe("stop, resume, remove", () => {
    it("stops a running subscription, keeps its cursor, and resumes it", async () => {
      client.pollResults.push(polled({ cursor: "kept" }));
      const sub = state.subscribe(typed, { mode: "poll" });
      await flush();
      state.stop(sub.id);
      state.stop(sub.id); // already stopped: no-op
      state.stop("missing");
      expect(state.getSubscription(sub.id)).toMatchObject({
        status: "stopped",
        cursor: "kept",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.pollEvents).toHaveBeenCalledTimes(1);

      // Subscribing again with the same key resumes it from its cursor.
      const resumed = state.subscribe(typed, { mode: "poll" });
      expect(resumed.status).toBe("starting");
      await flush();
      expect(client.pollEvents.mock.calls[1]![1]).toMatchObject({
        cursor: "kept",
      });
      expect(() => state.resubscribe("missing")).toThrow(
        /No event subscription/,
      );

      // An explicit null restarts from now rather than from the saved cursor.
      state.stop(resumed.id);
      state.subscribe(typed, { mode: "poll", cursor: null });
      await flush();
      expect(client.pollEvents.mock.calls[2]![1]).toMatchObject({
        cursor: null,
      });
    });

    it("aborts a push stream on stop and remove", () => {
      const sub = state.subscribe(typed, { mode: "push" });
      const stream = client.lastStream();
      state.stop(sub.id);
      expect(stream.signal?.aborted).toBe(true);
      state.resubscribe(sub.id);
      const second = client.lastStream();
      state.remove(sub.id);
      state.remove(sub.id);
      expect(second.signal?.aborted).toBe(true);
      expect(state.getSubscriptions()).toEqual([]);
    });

    it("clears everything on disconnect", async () => {
      const sub = state.subscribe(typed, { mode: "push" });
      const stream = client.lastStream();
      client.notify(
        EVENTS_EVENT_NOTIFICATION,
        stream.id,
        occurrence("e1", { n: 1 }, "k"),
      );
      const changes = vi.fn();
      state.addEventListener("logChange", changes);
      client.dispatchTypedEvent("disconnect");
      expect(stream.signal?.aborted).toBe(true);
      expect(state.getSubscriptions()).toEqual([]);
      expect(state.getLog()).toEqual([]);
      expect(changes).toHaveBeenCalledTimes(1);
      expect(state.getSubscription(sub.id)).toBeUndefined();
      // A second disconnect with nothing to clear dispatches nothing.
      client.dispatchTypedEvent("disconnect");
      expect(changes).toHaveBeenCalledTimes(1);
    });

    it("is unusable after destroy", () => {
      state.destroy();
      expect(() => state.subscribe(typed, { mode: "poll" })).toThrow(
        /destroyed/,
      );
    });
  });

  describe("re-entrant listeners", () => {
    it("stops logging a batch once a listener removed the subscription", async () => {
      client.pollResults.push(
        polled({
          truncated: true,
          events: [occurrence("a"), occurrence("b"), occurrence("c")],
        }),
      );
      const sub = state.subscribe(typed, { mode: "poll" });
      state.addEventListener("logEntry", () => state.remove(sub.id));
      await flush();
      expect(kinds(state.getLog())).toEqual(["event"]);
    });

    it("does not repopulate a store destroyed by a listener", async () => {
      client.pollResults.push(polled({ events: [occurrence("a")] }));
      state.subscribe(typed, { mode: "poll" });
      state.addEventListener("subscriptionsChange", () => state.destroy());
      await flush();
      expect(state.getLog()).toEqual([]);
      expect(state.getSubscriptions()).toEqual([]);
    });

    it("drops later reports, and a termination, for a removed subscription", async () => {
      // Errors and reconnects after a listener removed it on the error.
      client.pollResults.push(new Error("down"));
      const a = state.subscribe(typed, { mode: "poll" });
      const removeA = () => state.remove(a.id);
      state.addEventListener("subscriptionsChange", removeA);
      await flush();
      expect(state.getLog()).toEqual([]);
      state.removeEventListener("subscriptionsChange", removeA);

      // A termination whose patch lets a listener remove it logs nothing.
      const b = state.subscribe(typed, { mode: "push" });
      const removeB = () => {
        if (state.getSubscription(b.id)?.status === "terminated") {
          state.remove(b.id);
        }
      };
      state.addEventListener("subscriptionsChange", removeB);
      client.notify(EVENTS_TERMINATED_NOTIFICATION, client.lastStream().id, {
        error: { code: EVENTS_ERROR_CODES.NotFound, message: "gone" },
      });
      expect(state.getLog()).toEqual([]);
      expect(client.listAllEvents).not.toHaveBeenCalled();
    });
  });

  it("does not log an occurrence once its count update let a listener remove it", async () => {
    client.pollResults.push(polled({ events: [occurrence("a")] }));
    const sub = state.subscribe(typed, { mode: "poll" });
    state.addEventListener("subscriptionsChange", () => {
      if ((state.getSubscription(sub.id)?.counts.events ?? 0) > 0) {
        state.remove(sub.id);
      }
    });
    await flush();
    expect(state.getLog()).toEqual([]);
  });

  describe("the log", () => {
    it("caps entries, filters by subscription, and clears", async () => {
      const capped = new EventSubscriptionsState(client, {
        maxLogEntries: 2,
        validatePayloads: false,
      });
      const entries = vi.fn();
      capped.addEventListener("logEntry", entries);
      client.pollResults.push(
        polled({
          events: [
            occurrence("a"),
            occurrence("b", { n: "unchecked" }),
            occurrence("c"),
          ],
        }),
      );
      const sub = capped.subscribe(typed, { mode: "poll" });
      await flush();
      const log = capped.getLog();
      expect(
        log.map((e) => (e.kind === "event" ? e.occurrence.eventId : "")),
      ).toEqual(["b", "c"]);
      expect(log[0]!.kind === "event" && log[0]!.payloadError).toBeUndefined();
      // Validation off: nothing checked it.
      expect(log[0]!.kind === "event" && log[0]!.payload).toBe("unchecked");
      expect(entries).toHaveBeenCalledTimes(3);
      expect(capped.getLog("other")).toEqual([]);
      expect(capped.getLog(sub.id)).toHaveLength(2);
      const changes = vi.fn();
      capped.addEventListener("logChange", changes);
      capped.clearLog();
      capped.clearLog();
      expect(changes).toHaveBeenCalledTimes(1);
      expect(capped.getLog()).toEqual([]);
      capped.destroy();
    });

    it("keeps an unbounded log with maxLogEntries 0", async () => {
      const unbounded = new EventSubscriptionsState(client, {
        maxLogEntries: 0,
      });
      client.pollResults.push(
        polled({ events: [occurrence("a"), occurrence("b")] }),
      );
      unbounded.subscribe(typed, { mode: "poll" });
      await flush();
      expect(unbounded.getLog()).toHaveLength(2);
      unbounded.destroy();
    });

    it("forgets the oldest eventId past the dedup window", async () => {
      const windowed = new EventSubscriptionsState(client, { dedupWindow: 2 });
      client.pollResults.push(
        polled({ events: [occurrence("a"), occurrence("b"), occurrence("c")] }),
        polled({ events: [occurrence("a"), occurrence("c")] }),
      );
      const sub = windowed.subscribe(typed, { mode: "poll" });
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      // "a" fell out of the window and is delivered again; "c" is a duplicate.
      expect(windowed.getSubscription(sub.id)!.counts).toMatchObject({
        events: 4,
        duplicates: 1,
      });
      windowed.destroy();
    });
  });
});
