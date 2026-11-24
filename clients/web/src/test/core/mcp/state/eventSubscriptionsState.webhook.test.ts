import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventSubscriptionsState } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";
import type {
  EventType,
  SubscribeEventsResult,
} from "@inspector/core/extension/events/schemas.js";
import { eventSubscriptionKey } from "@inspector/core/extension/events/canonicalJson.js";
import {
  isWebhookSecret,
  MASKED_WEBHOOK_SECRET,
} from "@inspector/core/extension/events/webhookSecret.js";
import { EventsEngineFakeClient, EventsFakeClient } from "./eventsFake";

/**
 * Webhook subscription management in the registry (#3031): the callback and
 * secret checks, the generated secret kept off every snapshot, the refresh
 * loop's state, `events/unsubscribe` on stop and remove, and termination. The
 * same flows against the real fixture are in
 * `src/test/integration/mcp/eventSubscriptions.webhook.test.ts`.
 */

const hooked: EventType = {
  name: "incident.created",
  delivery: ["poll", "push", "webhook"],
  inputSchema: { type: "object" },
};

const URL_A = "https://hooks.example.com/a";
const SECRET = `whsec_${btoa("s".repeat(32))}`;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-24T12:00:00.000Z");

function rpcError(code: number, message: string, data?: unknown) {
  return Object.assign(new Error(message), { code, data });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("EventSubscriptionsState webhook (#3031)", () => {
  let client: EventsEngineFakeClient;
  let state: EventSubscriptionsState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    client = new EventsEngineFakeClient();
    state = new EventSubscriptionsState(client, { random: () => 0 });
  });

  afterEach(() => {
    state.destroy();
    vi.useRealTimers();
  });

  describe("subscribe", () => {
    it.each([
      [undefined, /needs a callback URL/],
      [{ url: "" }, /needs a callback URL/],
      [{ url: "not a url" }, /not a valid URL: not a url/],
      [{ url: "http://hooks.example.com" }, /must use https/],
      [{ url: URL_A, secret: "whsec_short" }, /must be whsec_/],
    ])("refuses %j", (webhook, message) => {
      expect(() =>
        state.subscribe(hooked, { mode: "webhook", webhook }),
      ).toThrow(message);
      expect(client.subscribeEvents).not.toHaveBeenCalled();
      expect(state.getSubscriptions()).toEqual([]);
    });

    it("refuses on a client without the webhook methods", () => {
      const plain = new EventsFakeClient();
      const plainState = new EventSubscriptionsState(plain);
      expect(() =>
        plainState.subscribe(hooked, {
          mode: "webhook",
          webhook: { url: URL_A },
        }),
      ).toThrow(/cannot run webhook subscriptions/);
      plainState.destroy();
    });

    it("generates a secret, keeps it off the snapshot, and sends it", async () => {
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        arguments: { severity: "P1" },
        maxAgeMs: 500,
        webhook: { url: URL_A, ttlMs: null },
      });
      expect(sub.id).toBe(
        eventSubscriptionKey(hooked.name, { severity: "P1" }, "webhook", URL_A),
      );
      expect(sub.webhook).toEqual({
        url: URL_A,
        secret: MASKED_WEBHOOK_SECRET,
        ttlMs: null,
        refreshes: 0,
      });
      const secret = state.getWebhookSecret(sub.id)!;
      expect(isWebhookSecret(secret)).toBe(true);
      expect(JSON.stringify(state.getSubscriptions())).not.toContain(
        secret.slice(6),
      );
      expect(client.subscribeEvents).toHaveBeenCalledWith(
        hooked,
        {
          arguments: { severity: "P1" },
          delivery: { mode: "webhook", url: URL_A, secret },
          maxAgeMs: 500,
          ttlMs: null,
          cursor: null,
        },
        { signal: expect.any(AbortSignal) },
      );
      await flush();
    });

    it("sends a supplied secret, and keys two callbacks apart", () => {
      const a = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A, secret: SECRET },
      });
      const b = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: "https://hooks.example.com/b" },
      });
      expect(a.id).not.toBe(b.id);
      expect(state.getWebhookSecret(a.id)).toBe(SECRET);
      expect(a.webhook?.ttlMs).toBeUndefined();
      expect(client.subscribeEvents.mock.calls[0]![1]).not.toHaveProperty(
        "ttlMs",
      );
      // Idempotent for the same key.
      expect(
        state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } }),
      ).toBe(a);
      expect(state.getWebhookSecret("nope")).toBeUndefined();
    });
  });

  it("reports the grant, refreshes with the cursor, and shows deliveryStatus", async () => {
    client.subscribeResults.push(
      {
        id: "sub_1",
        refreshBefore: new Date(NOW + HOUR).toISOString(),
        cursor: "c1",
        truncated: true,
      },
      {
        id: "sub_1",
        refreshBefore: new Date(NOW + 2 * HOUR).toISOString(),
        cursor: "c2",
        truncated: false,
        deliveryStatus: {
          active: false,
          lastError: "http_5xx",
          failedSince: "2026-11-24T12:10:00Z",
        },
      },
    );
    const sub = state.subscribe(hooked, {
      mode: "webhook",
      webhook: { url: URL_A, secret: SECRET },
    });
    await flush();
    let current = state.getSubscription(sub.id)!;
    expect(current.status).toBe("active");
    expect(current.cursor).toBe("c1");
    expect(current.webhook).toMatchObject({
      url: URL_A,
      secret: MASKED_WEBHOOK_SECRET,
      id: "sub_1",
      refreshes: 1,
      truncated: true,
    });
    expect(current.counts.gaps).toBe(1);
    expect(state.getLog().map((e) => e.kind)).toEqual(["gap"]);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(client.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(client.subscribeEvents.mock.calls[1]![1]).toMatchObject({
      cursor: "c1",
    });
    current = state.getSubscription(sub.id)!;
    expect(current.cursor).toBe("c2");
    expect(current.webhook).toMatchObject({
      refreshes: 2,
      truncated: false,
      deliveryStatus: { active: false, lastError: "http_5xx" },
    });
  });

  it("refreshes on request only for a live webhook subscription", async () => {
    const poll = state.subscribe(hooked, { mode: "poll" });
    const hook = state.subscribe(hooked, {
      mode: "webhook",
      webhook: { url: URL_A },
    });
    expect(state.refreshWebhook(hook.id)).toBe(false); // in flight
    await flush();
    expect(state.refreshWebhook(hook.id)).toBe(true);
    await flush();
    expect(client.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(state.refreshWebhook(poll.id)).toBe(false);
    expect(state.refreshWebhook("nope")).toBe(false);
  });

  describe("stop, resume, remove", () => {
    it("unsubscribes on stop, and resumes with the same secret and cursor", async () => {
      client.subscribeResults.push({
        id: "sub_1",
        refreshBefore: null,
        cursor: "c7",
        truncated: false,
      });
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        arguments: { a: 1 },
        webhook: { url: URL_A, ttlMs: 60_000 },
      });
      const secret = state.getWebhookSecret(sub.id);
      await flush();
      state.stop(sub.id);
      expect(state.getSubscription(sub.id)?.status).toBe("stopped");
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe).toEqual({
        status: "pending",
      });
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledWith(hooked, {
        arguments: { a: 1 },
        delivery: { url: URL_A },
      });
      await flush();
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe).toEqual({
        status: "done",
      });
      state.stop(sub.id); // already stopped: nothing more is sent
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);

      state.resubscribe(sub.id);
      expect(client.subscribeEvents).toHaveBeenCalledTimes(2);
      expect(client.subscribeEvents.mock.calls[1]![1]).toMatchObject({
        delivery: { secret },
        cursor: "c7",
        ttlMs: 60_000,
      });
      expect(state.getWebhookSecret(sub.id)).toBe(secret);
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe).toBe(
        undefined,
      );
    });

    it("resumes a subscription that asked for the server default TTL without one", async () => {
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(sub.id);
      await flush();
      state.resubscribe(sub.id);
      expect(client.subscribeEvents.mock.calls[1]![1]).not.toHaveProperty(
        "ttlMs",
      );
    });

    it("reports NotFound as gone and anything else as failed", async () => {
      client.unsubscribeResults.push(
        rpcError(EVENTS_ERROR_CODES.NotFound, "No matching webhook", {
          kind: "subscription",
        }),
        new Error("network down"),
      );
      const a = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      const b = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: "https://hooks.example.com/b" },
      });
      await flush();
      state.stop(a.id);
      state.stop(b.id);
      await flush();
      expect(state.getSubscription(a.id)?.webhook?.unsubscribe).toMatchObject({
        status: "gone",
        error: { code: EVENTS_ERROR_CODES.NotFound },
      });
      expect(state.getSubscription(b.id)?.webhook?.unsubscribe).toMatchObject({
        status: "failed",
        error: { message: "network down", data: { transport: true } },
      });
    });

    it("reports a synchronous throw from the client as a failure", async () => {
      client.unsubscribeEvents.mockImplementationOnce(() => {
        throw new Error("gate closed");
      });
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(sub.id);
      await flush();
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe).toMatchObject(
        { status: "failed", error: { message: "gate closed" } },
      );
    });

    it("drops an unsubscribe outcome once the subscription was removed", async () => {
      let settle: () => void = () => {};
      client.unsubscribeEvents.mockImplementationOnce(
        () => new Promise<void>((resolve) => (settle = resolve)),
      );
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(sub.id);
      state.remove(sub.id);
      const changes = vi.fn();
      state.addEventListener("subscriptionsChange", changes);
      settle();
      await flush();
      expect(changes).not.toHaveBeenCalled();
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes a live one on remove, but not a stopped or terminated one", async () => {
      client.subscribeResults.push(
        {
          id: "sub_1",
          refreshBefore: null,
          cursor: null,
          truncated: false,
        },
        rpcError(EVENTS_ERROR_CODES.Forbidden, "Forbidden"),
      );
      const live = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      const ended = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: "https://hooks.example.com/b" },
      });
      await flush();
      expect(state.getSubscription(ended.id)?.status).toBe("terminated");
      state.remove(ended.id);
      expect(client.unsubscribeEvents).not.toHaveBeenCalled();

      state.remove(live.id);
      expect(state.getSubscription(live.id)).toBeUndefined();
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);
      await flush();

      const stopped = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(stopped.id);
      state.remove(stopped.id);
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(2);
    });

    it("sends nothing on disconnect: the connection is gone", async () => {
      state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } });
      await flush();
      client.dispatchTypedEvent("disconnect");
      expect(state.getSubscriptions()).toEqual([]);
      expect(client.unsubscribeEvents).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      "CallbackEndpointError",
      rpcError(EVENTS_ERROR_CODES.CallbackEndpointError, "verify failed", {
        reason: "challenge_failed",
      }),
      "rejected",
    ],
    ["Forbidden", rpcError(EVENTS_ERROR_CODES.Forbidden, "no"), "forbidden"],
  ])("ends on %s with no resubscribe offer", async (_name, error, reason) => {
    client.subscribeResults.push(error);
    const sub = state.subscribe(hooked, {
      mode: "webhook",
      webhook: { url: URL_A },
    });
    await flush();
    const current = state.getSubscription(sub.id)!;
    expect(current.status).toBe("terminated");
    expect(current.termination).toMatchObject({
      reason,
      relist: "skipped",
      canResubscribe: false,
    });
    expect(() => state.resubscribe(sub.id)).toThrow(/cannot be resumed/);
  });

  describe("review round 1", () => {
    it("keys equivalent callback URLs as one, and sends the normalized URL", () => {
      const a = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: "https://hooks.example.com" },
      });
      const b = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: "https://HOOKS.example.com/" },
      });
      expect(b).toBe(a);
      expect(a.webhook?.url).toBe("https://hooks.example.com/");
      expect(client.subscribeEvents.mock.calls[0]![1].delivery.url).toBe(
        "https://hooks.example.com/",
      );
    });

    it("refuses a resubscribe, or a re-create, while its unsubscribe is in flight", async () => {
      let settle: () => void = () => {};
      client.unsubscribeEvents.mockImplementation(
        () => new Promise<void>((resolve) => (settle = resolve)),
      );
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(sub.id);
      expect(() => state.resubscribe(sub.id)).toThrow(
        /still being unsubscribed/,
      );
      state.remove(sub.id);
      expect(() =>
        state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } }),
      ).toThrow(/still being unsubscribed/);
      await Promise.resolve(); // the teardown is sent a microtask later
      settle();
      await flush();
      expect(
        state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } })
          .status,
      ).toBe("starting");
    });

    it("retries a failed unsubscribe on stop, and tears it down on remove", async () => {
      client.unsubscribeResults.push(new Error("down"), new Error("down"));
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.stop(sub.id);
      await flush();
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe?.status).toBe(
        "failed",
      );
      state.stop(sub.id); // retry
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(2);
      await flush();
      expect(state.getSubscription(sub.id)?.webhook?.unsubscribe?.status).toBe(
        "failed",
      );
      state.remove(sub.id); // still not torn down: one more attempt
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(3);
      await flush();
    });

    it("tears down on remove a subscription refused on refresh after a grant", async () => {
      client.subscribeResults.push(
        {
          id: "sub_1",
          refreshBefore: null,
          cursor: null,
          truncated: false,
        },
        rpcError(EVENTS_ERROR_CODES.CallbackEndpointError, "no", {
          reason: "timeout",
        }),
      );
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A },
      });
      await flush();
      state.refreshWebhook(sub.id);
      await flush();
      expect(state.getSubscription(sub.id)?.status).toBe("terminated");
      state.remove(sub.id);
      await Promise.resolve(); // the teardown is sent a microtask later
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);
      await flush();
    });

    it("does nothing on stop for an unknown id or a stopped poll", async () => {
      const poll = state.subscribe(hooked, { mode: "poll" });
      await flush();
      state.stop(poll.id);
      state.stop(poll.id);
      state.stop("nope");
      expect(client.unsubscribeEvents).not.toHaveBeenCalled();
    });
  });

  describe("review round 2", () => {
    it.each(["stop", "remove"] as const)(
      "on %s, waits for an in-flight subscribe before unsubscribing",
      async (action) => {
        let settle: (result: SubscribeEventsResult) => void = () => {};
        client.subscribeEvents.mockImplementationOnce(
          () => new Promise((resolve) => (settle = resolve)),
        );
        const sub = state.subscribe(hooked, {
          mode: "webhook",
          webhook: { url: URL_A, ttlMs: null },
        });
        state[action](sub.id);
        await flush();
        expect(client.unsubscribeEvents).not.toHaveBeenCalled();
        settle({
          id: "sub_late",
          refreshBefore: null,
          cursor: null,
          truncated: false,
        });
        await flush();
        expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);
        // The late grant does not revive the subscription.
        expect(state.getSubscription(sub.id)?.status).toBe(
          action === "stop" ? "stopped" : undefined,
        );
      },
    );
  });

  describe("review round 3", () => {
    it.each(["stopped", "pending"])(
      "refuses a resume from the %s notification",
      async (seen) => {
        const sub = state.subscribe(hooked, {
          mode: "webhook",
          webhook: { url: URL_A },
        });
        await flush();
        const errors: unknown[] = [];
        state.addEventListener("subscriptionsChange", () => {
          const current = state.getSubscription(sub.id);
          const matches =
            seen === "stopped"
              ? current?.status === "stopped" && !current.webhook?.unsubscribe
              : current?.webhook?.unsubscribe?.status === "pending";
          if (!matches) return;
          try {
            state.resubscribe(sub.id);
          } catch (err) {
            errors.push(err);
          }
        });
        state.stop(sub.id);
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toMatch(/still being unsubscribed/);
        expect(client.subscribeEvents).toHaveBeenCalledTimes(1);
        await flush();
      },
    );

    it("tears down on remove after stop, a late grant, and a failed unsubscribe", async () => {
      let settle: (result: SubscribeEventsResult) => void = () => {};
      client.subscribeEvents.mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve)),
      );
      client.unsubscribeResults.push(new Error("down"));
      const sub = state.subscribe(hooked, {
        mode: "webhook",
        webhook: { url: URL_A, ttlMs: null },
      });
      state.stop(sub.id);
      settle({
        id: "sub_late",
        refreshBefore: null,
        cursor: null,
        truncated: false,
      });
      await flush();
      expect(state.getSubscription(sub.id)?.webhook).toMatchObject({
        refreshes: 0,
        unsubscribe: { status: "failed" },
      });
      state.remove(sub.id);
      await flush();
      expect(client.unsubscribeEvents).toHaveBeenCalledTimes(2);
    });
  });

  it("sends one teardown when a listener removes it from stop's notification (round 4)", async () => {
    let settle: () => void = () => {};
    client.unsubscribeEvents.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const sub = state.subscribe(hooked, {
      mode: "webhook",
      webhook: { url: URL_A },
    });
    await flush();
    state.addEventListener("subscriptionsChange", () => {
      if (state.getSubscription(sub.id)?.status === "stopped") {
        state.remove(sub.id);
      }
    });
    state.stop(sub.id);
    await flush();
    expect(client.unsubscribeEvents).toHaveBeenCalledTimes(1);
    // Still reserved until that one teardown settles.
    expect(() =>
      state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } }),
    ).toThrow(/still being unsubscribed/);
    settle();
    await flush();
    expect(
      state.subscribe(hooked, { mode: "webhook", webhook: { url: URL_A } })
        .status,
    ).toBe("starting");
  });
});
