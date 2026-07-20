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

    it("is idempotent when re-subscribing an already-subscribed URI", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      await connected.subscribeToResource(RESOURCE_URI);
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(true);
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
      onModernSubscriptionClosed(
        subscription: McpSubscription,
        reason: "local" | "graceful" | "remote",
        generation: number,
      ): void;
    }

    function internals(c: InspectorClient): StreamInternals {
      return c as unknown as StreamInternals;
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
      const dropped = int.modernSubscription;
      expect(dropped).not.toBeNull();
      int.onModernSubscriptionClosed(
        dropped as McpSubscription,
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
      const dropped = int.modernSubscription as McpSubscription;
      int.client.listen = () => Promise.reject(new Error("re-listen boom"));
      int.onModernSubscriptionClosed(
        dropped,
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

    it("ignores a close callback from a superseded generation", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      const int = internals(connected);
      const sub = int.modernSubscription as McpSubscription;
      const before = connected.getResourceSubscriptionStreamState();
      // A stale generation → the callback is a no-op (no reconnect, no change).
      int.onModernSubscriptionClosed(
        sub,
        "remote",
        int.modernListenGeneration - 1,
      );
      expect(connected.getResourceSubscriptionStreamState()).toEqual(before);
    });
  });
});
