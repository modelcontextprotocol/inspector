import { describe, it, expect, afterEach, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type { McpSubscription } from "@modelcontextprotocol/client";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createNumberedResources,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";
import type { MessageEntry } from "@inspector/core/mcp/types.js";

/**
 * Live coverage of the resource-subscription era fork (#1630). On the legacy era
 * each subscription is a `resources/subscribe` request; on the modern
 * (2026-07-28) era subscriptions are a filter over one `subscriptions/listen`
 * stream. Both are exercised against a real server over a real transport.
 */
describe("resource subscriptions era fork (#1630)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  const RESOURCE_URI = "test://resource_0";
  const RESOURCE_URI_2 = "test://resource_1";

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  async function startServer(
    modern: ServerConfig["modern"] | undefined,
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("subscriptions-era-test", "1.0.0"),
      resources: createNumberedResources(2),
      listChanged: { resources: true },
      subscriptions: true,
      ...(modern ? { modern } : {}),
    });
    await started.start();
    server = started;
    return started;
  }

  async function connect(
    url: string,
    era: "legacy" | "modern",
  ): Promise<{ connected: InspectorClient; messages: MessageEntry[] }> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    const messages: MessageEntry[] = [];
    connected.addEventListener("message", (event) => {
      messages.push(event.detail);
    });
    await connected.connect();
    client = connected;
    return { connected, messages };
  }

  function methodsSent(messages: MessageEntry[]): string[] {
    return messages
      .filter((m) => m.direction === "request")
      .map((m) => ("method" in m.message ? m.message.method : ""))
      .filter(Boolean);
  }

  /** Params of the last `subscriptions/listen` request captured in the log. */
  function lastListenFilter(
    messages: MessageEntry[],
  ): Record<string, unknown> | undefined {
    const listen = messages
      .filter(
        (m) =>
          m.direction === "request" &&
          "method" in m.message &&
          m.message.method === "subscriptions/listen",
      )
      .at(-1);
    if (!listen || !("params" in listen.message)) return undefined;
    const params = listen.message.params as { notifications?: unknown };
    return params.notifications as Record<string, unknown> | undefined;
  }

  describe("modern era", () => {
    it("opens an acknowledged listen stream on subscribe (no resources/subscribe)", async () => {
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      expect(connected.getProtocolEra()).toBe("modern");
      expect(connected.supportsResourceSubscriptions()).toBe(true);

      messages.length = 0;
      await connected.subscribeToResource(RESOURCE_URI);

      const streamState = connected.getResourceSubscriptionStreamState();
      expect(streamState.active).toBe(true);
      expect(streamState.status).toBe("acknowledged");
      expect(streamState.honoredUris).toContain(RESOURCE_URI);
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);

      const methods = methodsSent(messages);
      expect(methods).toContain("subscriptions/listen");
      expect(methods).not.toContain("resources/subscribe");
    });

    it("closes the stream when the last subscription is removed", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(true);

      await connected.unsubscribeFromResource(RESOURCE_URI);
      const streamState = connected.getResourceSubscriptionStreamState();
      expect(streamState.active).toBe(false);
      expect(connected.getSubscribedResources()).toEqual([]);
    });

    it("re-lists (stream stays open) when one of several URIs is removed", async () => {
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      await connected.subscribeToResource(RESOURCE_URI_2);
      expect(connected.getSubscribedResources()).toEqual([
        RESOURCE_URI,
        RESOURCE_URI_2,
      ]);

      messages.length = 0;
      await connected.unsubscribeFromResource(RESOURCE_URI);

      // A fresh listen re-established the reduced filter; the stream is still up.
      const streamState = connected.getResourceSubscriptionStreamState();
      expect(streamState.active).toBe(true);
      expect(streamState.status).toBe("acknowledged");
      expect(streamState.honoredUris).toEqual([RESOURCE_URI_2]);
      expect(methodsSent(messages)).toContain("subscriptions/listen");
    });

    it("folds the subscribed URIs and listChanged opt-ins into the listen filter", async () => {
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      messages.length = 0;
      await connected.subscribeToResource(RESOURCE_URI);

      const filter = lastListenFilter(messages);
      expect(filter?.resourceSubscriptions).toEqual([RESOURCE_URI]);
      // The server advertises resources.listChanged, so the single stream also
      // opts into it (one listen stream carries every opted-in type).
      expect(filter?.resourcesListChanged).toBe(true);
    });

    it("skips a redundant re-list when re-subscribing an already-subscribed URI", async () => {
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      // A second subscribe of the same URI leaves the filter unchanged, so it
      // must not re-list (which would needlessly churn the server stream).
      messages.length = 0;
      await connected.subscribeToResource(RESOURCE_URI);
      expect(methodsSent(messages)).not.toContain("subscriptions/listen");
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(true);
    });

    it("skips a re-list when unsubscribing a URI that isn't subscribed", async () => {
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      messages.length = 0;
      await connected.unsubscribeFromResource("test://not-subscribed");
      expect(methodsSent(messages)).not.toContain("subscriptions/listen");
      // The real subscription is untouched.
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
    });
  });

  describe("legacy era", () => {
    it("subscribes via resources/subscribe with no listen stream", async () => {
      const started = await startServer(undefined);
      const { connected, messages } = await connect(started.url, "legacy");
      expect(connected.getProtocolEra()).toBe("legacy");
      expect(connected.supportsResourceSubscriptions()).toBe(true);

      messages.length = 0;
      await connected.subscribeToResource(RESOURCE_URI);

      const methods = methodsSent(messages);
      expect(methods).toContain("resources/subscribe");
      expect(methods).not.toContain("subscriptions/listen");

      // No persistent stream on the legacy era.
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);

      messages.length = 0;
      await connected.unsubscribeFromResource(RESOURCE_URI);
      expect(methodsSent(messages)).toContain("resources/unsubscribe");
      expect(connected.getSubscribedResources()).toEqual([]);
    });
  });

  describe("guards", () => {
    it("rejects subscribe when the server does not support subscriptions", async () => {
      const started = createTestServerHttp({
        serverInfo: createTestServerInfo("no-subscribe-test", "1.0.0"),
        resources: createNumberedResources(1),
        // subscriptions omitted → capability not advertised
        modern: {},
      });
      await started.start();
      server = started;
      const { connected } = await connect(started.url, "modern");
      expect(connected.supportsResourceSubscriptions()).toBe(false);
      await expect(connected.subscribeToResource(RESOURCE_URI)).rejects.toThrow(
        /does not support resource subscriptions/,
      );
    });
  });

  // Modern stream lifecycle branches that the public surface can't reach against
  // a healthy server (an unexpected drop, a failed `listen()`). These reach into
  // the client's private state — the pattern used across the InspectorClient
  // coverage-backfill suite — to drive them deterministically.
  describe("modern stream internals", () => {
    interface StreamInternals {
      client: { listen: (...args: unknown[]) => Promise<McpSubscription> };
      modernSubscription: McpSubscription | null;
      modernListenGeneration: number;
      modernReconnectAttempts: number;
      subscribedResources: Set<string>;
      onModernSubscriptionClosed(
        subscription: McpSubscription,
        reason: "local" | "graceful" | "remote",
        generation: number,
      ): void;
    }

    function internals(c: InspectorClient): StreamInternals {
      return c as unknown as StreamInternals;
    }

    /** A controllable fake `McpSubscription` whose `closed` we resolve on demand. */
    function makeFakeSub(): {
      sub: McpSubscription;
      drop: (reason: "local" | "graceful" | "remote") => void;
    } {
      let drop: (reason: "local" | "graceful" | "remote") => void = () => {};
      const closed = new Promise<"local" | "graceful" | "remote">((resolve) => {
        drop = resolve;
      });
      const sub = {
        honoredFilter: { resourceSubscriptions: [RESOURCE_URI] },
        close: async () => {},
        closed,
      } as McpSubscription;
      return { sub, drop };
    }

    /**
     * Replace the client's live listen stream with a controllable fake and close
     * the real one, so tests that drive `onModernSubscriptionClosed` by hand
     * don't leave a real stream open (which would reject "Connection closed" on
     * teardown). Returns the installed fake.
     */
    async function installFakeSubscription(
      int: StreamInternals,
    ): Promise<ReturnType<typeof makeFakeSub>> {
      const real = int.modernSubscription;
      const fake = makeFakeSub();
      int.modernSubscription = fake.sub;
      // real.closed fires onModernSubscriptionClosed, but modernSubscription is
      // now the fake, so it's a no-op guard-wise; this just tears down the wire.
      await real?.close().catch(() => {});
      return fake;
    }

    it("rolls back the optimistic add when listen() fails", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      const real = internals(connected).client.listen;
      internals(connected).client.listen = () =>
        Promise.reject(new Error("listen boom"));

      await expect(connected.subscribeToResource(RESOURCE_URI)).rejects.toThrow(
        /listen boom/,
      );
      expect(connected.getSubscribedResources()).toEqual([]);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);

      internals(connected).client.listen = real;
    });

    it("reconnects by re-listing after an unexpected 'remote' drop", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const fake = await installFakeSubscription(int);
      int.onModernSubscriptionClosed(
        fake.sub,
        "remote",
        int.modernListenGeneration,
      );

      // Synchronously flips to reconnecting, then re-lists and re-acknowledges.
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "reconnecting",
      );
      await vi.waitFor(() => {
        const s = connected.getResourceSubscriptionStreamState();
        expect(s.active).toBe(true);
        expect(s.status).toBe("acknowledged");
      });
    });

    it("marks the stream ended when the reconnect re-listen also fails", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const fake = await installFakeSubscription(int);
      int.client.listen = () => Promise.reject(new Error("re-listen boom"));
      int.onModernSubscriptionClosed(
        fake.sub,
        "remote",
        int.modernListenGeneration,
      );

      await vi.waitFor(() => {
        const s = connected.getResourceSubscriptionStreamState();
        expect(s.status).toBe("ended");
        // Still had a subscription, so `active` stays true (the stream is gone,
        // but the intent to subscribe remains).
        expect(s.active).toBe(true);
      });
    });

    it("backs off and gives up after a burst of rapid reconnects", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      const int = internals(connected);
      const initial = await installFakeSubscription(int);

      vi.useFakeTimers();
      try {
        // Each re-listen resolves to a controllable fake stream we can drop.
        const subs: ReturnType<typeof makeFakeSub>[] = [];
        int.client.listen = () => {
          const next = makeFakeSub();
          subs.push(next);
          return Promise.resolve(next.sub);
        };

        // First drop starts the reconnect run.
        int.onModernSubscriptionClosed(
          initial.sub,
          "remote",
          int.modernListenGeneration,
        );

        // Drive rapid reconnect cycles: advancing past the max backoff fires the
        // pending re-listen (a fresh fake stream), which we immediately drop
        // again. The gap stays under the reset window, so attempts accumulate.
        for (let i = 0; i < 12; i++) {
          await vi.advanceTimersByTimeAsync(20_000);
          if (connected.getResourceSubscriptionStreamState().status === "ended")
            break;
          const last = subs.at(-1);
          expect(last).toBeDefined();
          last?.drop("remote");
          await Promise.resolve();
        }

        // Past the attempt cap it stops reconnecting and marks the stream ended
        // (subscriptions remain, so it stays active).
        const state = connected.getResourceSubscriptionStreamState();
        expect(state.status).toBe("ended");
        expect(state.active).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets the backoff run after an isolated drop", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      const int = internals(connected);
      const initial = await installFakeSubscription(int);

      vi.useFakeTimers();
      try {
        const subs: ReturnType<typeof makeFakeSub>[] = [];
        int.client.listen = () => {
          const next = makeFakeSub();
          subs.push(next);
          return Promise.resolve(next.sub);
        };

        int.onModernSubscriptionClosed(
          initial.sub,
          "remote",
          int.modernListenGeneration,
        );
        await vi.advanceTimersByTimeAsync(1_000); // reconnect #1 acknowledges
        expect(int.modernReconnectAttempts).toBe(1);

        // A drop that lands well after the reset window resets the run rather
        // than escalating, so attempts stays at 1.
        await vi.advanceTimersByTimeAsync(40_000);
        subs.at(-1)?.drop("remote");
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(int.modernReconnectAttempts).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reconnect when the subscription set empties before the timer fires", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      const int = internals(connected);
      const fake = await installFakeSubscription(int);

      vi.useFakeTimers();
      try {
        int.client.listen = () => {
          throw new Error("re-listen should not run once the set is empty");
        };
        int.onModernSubscriptionClosed(
          fake.sub,
          "remote",
          int.modernListenGeneration,
        );
        expect(connected.getResourceSubscriptionStreamState().status).toBe(
          "reconnecting",
        );
        // Empty the set without going through unsubscribe (which would clear the
        // timer), then fire it: the guard bails instead of re-listing.
        int.subscribedResources.clear();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(int.modernSubscription).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the ended badge active on a graceful close while subscriptions remain", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const fake = await installFakeSubscription(int);
      int.onModernSubscriptionClosed(
        fake.sub,
        "graceful",
        int.modernListenGeneration,
      );
      const state = connected.getResourceSubscriptionStreamState();
      expect(state.status).toBe("ended");
      // Subscriptions remain, so the ended badge stays visible (parity with the
      // reconnect give-up state).
      expect(state.active).toBe(true);
    });

    it("goes inactive on a graceful close once no subscriptions remain", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const fake = await installFakeSubscription(int);
      // No URIs left → the ended state is inactive (no badge).
      int.subscribedResources.clear();
      int.onModernSubscriptionClosed(
        fake.sub,
        "graceful",
        int.modernListenGeneration,
      );
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);
    });

    it("ignores a close callback from a superseded generation", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const fake = await installFakeSubscription(int);
      const before = connected.getResourceSubscriptionStreamState();
      // A stale generation → the callback is a no-op (no reconnect, no change).
      int.onModernSubscriptionClosed(
        fake.sub,
        "remote",
        int.modernListenGeneration - 1,
      );
      expect(connected.getResourceSubscriptionStreamState()).toEqual(before);
    });
  });
});
