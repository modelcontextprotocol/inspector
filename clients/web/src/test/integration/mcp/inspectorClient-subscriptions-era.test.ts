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
  createEchoTool,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE } from "@inspector/core/mcp/subscriptionAck.js";

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
  /**
   * Every list-change opt-in off. The listen filter is config ∩ capability and
   * the SDK server advertises `listChanged` for every list it registers, so this
   * is what leaves the filter empty when nothing is subscribed — i.e. the
   * pre-#1920 world these lifecycle tests were written against.
   */
  const NO_LIST_CHANGED = { tools: false, resources: false, prompts: false };
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

  /**
   * @param listChangedNotifications the Inspector-side opt-ins. The SDK server
   *   advertises `listChanged` for every list it registers, so this — not the
   *   server config — is how a test gets an *empty* listen filter: the filter is
   *   config ∩ capability, and with every opt-in off only a subscribed URI can
   *   open the stream (#1920).
   */
  async function connect(
    url: string,
    era: "legacy" | "modern",
    listChangedNotifications?: {
      tools?: boolean;
      resources?: boolean;
      prompts?: boolean;
    },
  ): Promise<{ connected: InspectorClient; messages: MessageEntry[] }> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
        ...(listChangedNotifications ? { listChangedNotifications } : {}),
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

  /**
   * The private members these tests drive directly. `InspectorClient` declares
   * every one of them, so the shape below is a faithful mirror rather than a
   * reinterpretation — the double cast is only to reach past `private`, which no
   * single `as` can do (the two types share no public overlap). It is confined to
   * `internals()` so there is one such cast in the file, and it is unavoidable:
   * these are lifecycle branches no public API can reach against a healthy server
   * (there is no way to ask for a *remote* stream close, or for a `listen()` that
   * fails).
   */
  interface StreamInternals {
    client: { listen: (...args: unknown[]) => Promise<McpSubscription> };
    modernSubscription: McpSubscription | null;
    modernListenGeneration: number;
    modernReconnectAttempts: number;
    modernNeverAcknowledged: boolean;
    subscribedResources: Set<string>;
    refreshModernSubscription(fromReconnect?: boolean): Promise<void>;
    onModernSubscriptionClosed(
      subscription: McpSubscription,
      reason: "local" | "graceful" | "remote",
      generation: number,
    ): void;
  }

  function internals(c: InspectorClient): StreamInternals {
    return c as unknown as StreamInternals;
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
      // Nothing else in the filter (no list-change opt-ins), so the last URI
      // leaving empties it and the stream closes (#1920).
      const started = await startServer({});
      const { connected, messages } = await connect(
        started.url,
        "modern",
        NO_LIST_CHANGED,
      );
      await connected.subscribeToResource(RESOURCE_URI);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(true);

      messages.length = 0;
      await connected.unsubscribeFromResource(RESOURCE_URI);
      const streamState = connected.getResourceSubscriptionStreamState();
      expect(streamState.active).toBe(false);
      expect(connected.getSubscribedResources()).toEqual([]);
      // No re-listen: there is nothing left to listen for.
      expect(methodsSent(messages)).not.toContain("subscriptions/listen");
    });

    it("keeps the stream open past the last subscription when a listChanged opt-in remains", async () => {
      // The other half of the above: with an advertised listChanged the filter
      // is still non-empty, so the last unsubscribe re-lists rather than
      // closing — and the state goes inactive because the *Subscriptions*
      // section has nothing to report, not because the stream is gone (#1920).
      const started = await startServer({});
      const { connected, messages } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);

      messages.length = 0;
      await connected.unsubscribeFromResource(RESOURCE_URI);

      expect(connected.getSubscribedResources()).toEqual([]);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);
      const filter = lastListenFilter(messages);
      expect(filter?.resourcesListChanged).toBe(true);
      expect(filter?.resourceSubscriptions).toBeUndefined();
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

  // The stream used to be reachable only by subscribing to a resource, so a
  // server with no resources could never open it — and its `tools.listChanged`
  // notifications, which ride the same stream, could never arrive (#1920).
  describe("modern era: opening the stream for listChanged alone (#1920)", () => {
    async function startToolsOnlyServer(
      listChanged: ServerConfig["listChanged"],
    ): Promise<TestServerHttp> {
      const started = createTestServerHttp({
        serverInfo: createTestServerInfo("tools-only-test", "1.0.0"),
        tools: [createEchoTool()],
        listChanged,
        modern: {},
      });
      await started.start();
      server = started;
      return started;
    }

    it("opens the stream on connect against a tools-only server", async () => {
      const started = await startToolsOnlyServer({ tools: true });
      const { connected, messages } = await connect(started.url, "modern");

      expect(connected.getCapabilities()?.resources).toBeUndefined();
      expect(methodsSent(messages)).toContain("subscriptions/listen");
      const filter = lastListenFilter(messages);
      expect(filter?.toolsListChanged).toBe(true);
      // Nothing is subscribed, so the filter carries no URIs at all.
      expect(filter?.resourceSubscriptions).toBeUndefined();
      // …and the Subscriptions section still has nothing to report.
      expect(connected.getSubscribedResources()).toEqual([]);
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);
    });

    it("leaves the stream closed when the opt-in is disabled in config", async () => {
      // The filter is config ∩ capability, so turning the handler off in the
      // Inspector's own options is enough to keep the stream closed.
      const started = await startToolsOnlyServer({ tools: true });
      const connected = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
          listChangedNotifications: { tools: false },
        },
      );
      const messages: MessageEntry[] = [];
      connected.addEventListener("message", (event) => {
        messages.push(event.detail);
      });
      await connected.connect();
      client = connected;

      expect(methodsSent(messages)).not.toContain("subscriptions/listen");
    });

    it("opens no stream on the legacy era", async () => {
      // Legacy has no `subscriptions/listen` at all — list-change notifications
      // arrive on the session's own channel.
      const started = createTestServerHttp({
        serverInfo: createTestServerInfo("tools-only-legacy-test", "1.0.0"),
        tools: [createEchoTool()],
        listChanged: { tools: true },
      });
      await started.start();
      server = started;
      const { connected, messages } = await connect(started.url, "legacy");

      expect(connected.getProtocolEra()).toBe("legacy");
      expect(methodsSent(messages)).not.toContain("subscriptions/listen");
      expect(connected.getResourceSubscriptionStreamState().active).toBe(false);
    });

    it("reconnects a dropped listChanged-only stream (no subscriptions to keep it alive)", async () => {
      const started = await startToolsOnlyServer({ tools: true });
      const { connected } = await connect(started.url, "modern");

      const int = internals(connected);
      const dropped = int.modernSubscription;
      expect(dropped).not.toBeNull();
      if (!dropped) return;

      int.onModernSubscriptionClosed(
        dropped,
        "remote",
        int.modernListenGeneration,
      );
      // Reconnect-by-re-listen runs on the filter, not on the subscribed set —
      // which is empty here, and used to be the reason to give up.
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "reconnecting",
      );
      await vi.waitFor(() => {
        expect(int.modernSubscription).not.toBeNull();
      });
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "acknowledged",
      );
    });

    it("has the stream up before the connect event fires", async () => {
      // The managed list states start their initial `refresh()` from the
      // `connect` event, so the stream has to be established (or its retry
      // armed) first: dispatching earlier would let `tools/list` go out ahead of
      // `subscriptions/listen`, and a list the server changed in that window
      // would notify nobody.
      const started = await startToolsOnlyServer({ tools: true });
      const connected = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      let streamAtConnectEvent: boolean | undefined;
      connected.addEventListener("connect", () => {
        streamAtConnectEvent = internals(connected).modernSubscription !== null;
      });
      await connected.connect();
      client = connected;

      expect(streamAtConnectEvent).toBe(true);
    });

    it("does not announce the connection when a disconnect overtakes the stream open", async () => {
      // The listen round-trip widened the window between the handshake and the
      // `connect` announcement, so a `disconnect()` can land inside it.
      // Announcing anyway would restart every managed list refresh against a
      // session being torn down.
      const started = await startToolsOnlyServer({ tools: true });
      const connected = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      client = connected;
      let connectAnnounced = false;
      connected.addEventListener("connect", () => {
        connectAnnounced = true;
      });

      // Hold the stream open so the disconnect lands while it is in flight.
      // `openStarted` is what makes the race deterministic: the stub is only
      // reached after the handshake, so disconnecting before it runs would leave
      // `releaseOpen` unset and hang the connect.
      const int = internals(connected);
      let releaseOpen: () => void = () => {};
      let markOpenStarted: () => void = () => {};
      const openStarted = new Promise<void>((resolve) => {
        markOpenStarted = resolve;
      });
      int.refreshModernSubscription = () => {
        markOpenStarted();
        return new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
      };

      const connecting = connected.connect();
      await openStarted;
      const disconnecting = connected.disconnect();
      releaseOpen();
      await connecting;
      await disconnecting;

      expect(connectAnnounced).toBe(false);
    });

    it("connects anyway when the connect-time listen fails, and retries", async () => {
      // The handshake succeeded; every request-scoped feature works without the
      // stream, so the failure is handed to the reconnect machinery instead of
      // failing `connect()`.
      const started = await startToolsOnlyServer({ tools: true });
      const connected = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      // Shadow the private refresh on the instance so the connect-time open
      // fails without a live client to reach into (there is none until
      // `connect()` builds one). The bump mirrors the real method's contract —
      // it claims the generation synchronously before it can fail — which is
      // what the caller's guard reads to tell "our refresh failed" from "a newer
      // one took over".
      const int = internals(connected);
      int.refreshModernSubscription = () => {
        int.modernListenGeneration++;
        return Promise.reject(new Error("listen boom"));
      };

      await expect(connected.connect()).resolves.toBeUndefined();
      client = connected;

      expect(connected.getStatus()).toBe("connected");
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "reconnecting",
      );
    });

    it("leaves a superseded connect-time failure to the refresh that owns the stream", async () => {
      // Nothing about the ordering above makes this call the only refresh that
      // can be in flight: `statusChange` has already fired, and a concurrent
      // `subscribeToResource` — or a `disconnect()`, whose
      // `resetSubscriptionStream` bumps the generation too — can supersede this
      // one while its `listen()` is pending. Reconciling anyway would arm a
      // reconnect against a stream that is healthy (or a session that is gone),
      // so this makes the same ownership test the subscribe/unsubscribe paths
      // make. Driven here by a stub that bumps twice, standing in for "someone
      // else advanced it".
      const started = await startToolsOnlyServer({ tools: true });
      const connected = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      const int = internals(connected);
      // Two bumps: this call's own, plus the newer refresh that superseded it
      // before its failure landed.
      int.refreshModernSubscription = () => {
        int.modernListenGeneration += 2;
        return Promise.reject(new Error("listen boom"));
      };

      await expect(connected.connect()).resolves.toBeUndefined();
      client = connected;

      // No reconnect armed: the state is the newer refresh's to write.
      expect(connected.getResourceSubscriptionStreamState().status).not.toBe(
        "reconnecting",
      );
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

    for (const [label, close] of [
      [
        "throws synchronously",
        (): Promise<void> => {
          throw new Error("close blew up");
        },
      ],
      [
        "returns a rejected promise",
        (): Promise<void> => Promise.reject(new Error("close blew up")),
      ],
    ] as const) {
      it(`re-lists when the superseded stream's close() ${label}`, async () => {
        // A re-list drops its reference to the previous stream *before* closing
        // it, so an escaping failure would both abandon a stream that may still
        // be open on the server and abort the refresh before its replacement
        // `listen()` — leaving a non-empty subscription set with no stream. The
        // close is best-effort against both failure modes for that reason; this
        // is the site where being best-effort against the *synchronous* one
        // changed behaviour (a `.catch()` alone never caught it).
        const started = await startServer({});
        const { connected } = await connect(started.url, "modern");
        await connected.subscribeToResource(RESOURCE_URI);

        const int = internals(connected);
        // Swap the live stream for a poisoned one, closing the real stream so
        // the wire is torn down (as `installFakeSubscription` does).
        const real = int.modernSubscription;
        int.modernSubscription = { close } as unknown as McpSubscription;
        await real?.close().catch(() => {});

        // A second URI changes the filter, so this re-lists over the poisoned
        // stream.
        await expect(
          connected.subscribeToResource(RESOURCE_URI_2),
        ).resolves.toBeUndefined();

        expect(connected.getSubscribedResources()).toEqual([
          RESOURCE_URI,
          RESOURCE_URI_2,
        ]);
        const state = connected.getResourceSubscriptionStreamState();
        expect(state.active).toBe(true);
        expect(state.status).toBe("acknowledged");
        expect(int.modernSubscription).not.toBeNull();
      });
    }

    it("keeps the optimistic add when a newer refresh superseded the failure", async () => {
      // The rollback's premise is that the server filter is unchanged, which is
      // exactly what supersession falsifies: the newer refresh built its filter
      // from the set *including* this URI, so on success the server honors it.
      // Rolling back anyway would leave the set missing a URI the live stream
      // carries — and with only one subscribed, an empty set with an active
      // stream, the combination `resetSubscriptionStream` exists to prevent.
      // Reachable without any close() failure: a rejecting `listen()` does it,
      // which is what a user subscribing while the reconnect timer re-lists
      // (i.e. exactly when the server is flaky) can produce.
      //
      // No list-change opt-ins, so connect leaves the stream closed (#1920) and
      // the first subscribe's `listen()` is reached synchronously — with a
      // stream to tear down first, the swap below would land after this call
      // already read `client.listen`.
      const started = await startServer({});
      const { connected } = await connect(
        started.url,
        "modern",
        NO_LIST_CHANGED,
      );
      const int = internals(connected);

      const real = int.client.listen;
      // The first listen hangs, so the second can supersede it before it fails.
      let failFirst: (error: Error) => void = () => {};
      int.client.listen = () =>
        new Promise<McpSubscription>((_, reject) => {
          failFirst = reject;
        });
      const first = connected.subscribeToResource(RESOURCE_URI);
      // Attached before the supersession so the rejection is never unhandled.
      const firstSettled = expect(first).rejects.toThrow(/listen boom/);

      // A newer refresh starts and acknowledges, carrying both URIs.
      int.client.listen = real;
      await connected.subscribeToResource(RESOURCE_URI_2);

      failFirst(new Error("listen boom"));
      await firstSettled;

      // The superseded call still reports its failure, but leaves the filter to
      // the refresh that owns it.
      expect(connected.getSubscribedResources()).toEqual([
        RESOURCE_URI,
        RESOURCE_URI_2,
      ]);
      const state = connected.getResourceSubscriptionStreamState();
      expect(state.active).toBe(true);
      expect(state.status).toBe("acknowledged");
    });

    it("retries rather than stranding the URIs when both overlapping subscribes fail", async () => {
      // The other half of the gate: skipping the superseded call's rollback is
      // only safe if the superseding call reconciles when *it* fails too.
      // Otherwise the set keeps the first URI while the state keeps the
      // optimistic "connecting" — a badge that never changes, over a
      // subscription no server ever honored, with nothing armed to fix it
      // (neither `onModernSubscriptionClosed` nor `onModernReconnectFailed`
      // ran). The reconcile hands it to the reconnect machinery instead.
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      const int = internals(connected);

      let failFirst: (error: Error) => void = () => {};
      int.client.listen = () =>
        new Promise<McpSubscription>((_, reject) => {
          failFirst = reject;
        });
      const first = connected.subscribeToResource(RESOURCE_URI);
      const firstSettled = expect(first).rejects.toThrow(/listen boom/);

      // The superseding call fails on its own listen.
      int.client.listen = () => Promise.reject(new Error("listen boom 2"));
      await expect(
        connected.subscribeToResource(RESOURCE_URI_2),
      ).rejects.toThrow(/listen boom 2/);

      failFirst(new Error("listen boom"));
      await firstSettled;

      // Its own URI rolled back; the superseded one survives — and rather than
      // sitting at "connecting" forever it is now a retry in progress.
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "reconnecting",
      );

      // And the retry makes the state true: the next re-listen acknowledges.
      int.client.listen = () => Promise.resolve(makeFakeSub().sub);
      await vi.waitFor(() => {
        expect(connected.getResourceSubscriptionStreamState().status).toBe(
          "acknowledged",
        );
      });
    });

    it("retries rather than stranding the URIs when the unsubscribe's re-listen fails", async () => {
      // `unsubscribeFromResource` keeps its removal when the re-listen fails,
      // so nothing is rolled back — but the stream is gone with URIs still
      // subscribed, and without the reconcile the badge would keep reporting
      // the previous success ("acknowledged"/Listening) over no stream at all.
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      await connected.subscribeToResource(RESOURCE_URI_2);
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "acknowledged",
      );

      const int = internals(connected);
      int.client.listen = () => Promise.reject(new Error("re-listen boom"));
      await expect(
        connected.unsubscribeFromResource(RESOURCE_URI_2),
      ).rejects.toThrow(/re-listen boom/);

      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "reconnecting",
      );
    });

    it("never announces an empty subscription set with an active stream", async () => {
      // The pair `resetSubscriptionStream` orders its own writes to prevent,
      // asserted from the consumer's side at the two sites that empty the set
      // outside it: the last-URI unsubscribe (happy path, where the re-listen
      // that would set INACTIVE is a round-trip away) and the last-URI rollback
      // of a failed subscribe (where the state still reads "connecting").
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      const seen: { size: number; active: boolean }[] = [];
      connected.addEventListener("resourceSubscriptionsChange", () => {
        seen.push({
          size: connected.getSubscribedResources().length,
          active: connected.getResourceSubscriptionStreamState().active,
        });
      });

      await connected.subscribeToResource(RESOURCE_URI);
      await connected.unsubscribeFromResource(RESOURCE_URI);

      const int = internals(connected);
      int.client.listen = () => Promise.reject(new Error("listen boom"));
      await expect(connected.subscribeToResource(RESOURCE_URI)).rejects.toThrow(
        /listen boom/,
      );

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((s) => s.size === 0 && s.active)).toEqual([]);
    });

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

    it("reflects the subscription optimistically as 'connecting' before the ack", async () => {
      // No list-change opt-ins → no connect-time stream, so the subscribe's
      // `listen()` is the first one and this test's held ack is the one it waits
      // on (#1920).
      const started = await startServer({});
      const { connected } = await connect(
        started.url,
        "modern",
        NO_LIST_CHANGED,
      );
      const int = internals(connected);

      // Hold the listen ack so we can observe the pre-ack (optimistic) state.
      let ack: (sub: McpSubscription) => void = () => {};
      int.client.listen = () =>
        new Promise<McpSubscription>((resolve) => {
          ack = resolve;
        });

      const pending = connected.subscribeToResource(RESOURCE_URI);
      // The URI and a "connecting" stream state are visible immediately, without
      // waiting for the round-trip.
      expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      const connecting = connected.getResourceSubscriptionStreamState();
      expect(connecting.active).toBe(true);
      expect(connecting.status).toBe("connecting");

      // The ack lands → acknowledged.
      ack(makeFakeSub().sub);
      await pending;
      expect(connected.getResourceSubscriptionStreamState().status).toBe(
        "acknowledged",
      );
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

    it("retries a failing re-listen with backoff and gives up past the cap", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      const int = internals(connected);
      const fake = await installFakeSubscription(int);

      vi.useFakeTimers();
      try {
        // Every re-listen fails, so the failure count climbs each retry.
        int.client.listen = () => Promise.reject(new Error("re-listen boom"));

        int.onModernSubscriptionClosed(
          fake.sub,
          "remote",
          int.modernListenGeneration,
        );
        // A single failure retries (not ended yet).
        await vi.advanceTimersByTimeAsync(20_000);
        expect(connected.getResourceSubscriptionStreamState().status).toBe(
          "reconnecting",
        );

        // Keep failing until the consecutive-failure cap gives up.
        for (let i = 0; i < 12; i++) {
          if (connected.getResourceSubscriptionStreamState().status === "ended")
            break;
          await vi.advanceTimersByTimeAsync(20_000);
        }
        const state = connected.getResourceSubscriptionStreamState();
        expect(state.status).toBe("ended");
        // Subscriptions remain, so the ended badge stays visible.
        expect(state.active).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets the failure count after a successful reconnect", async () => {
      const started = await startServer({});
      const { connected } = await connect(started.url, "modern");
      await connected.subscribeToResource(RESOURCE_URI);
      const int = internals(connected);
      const fake = await installFakeSubscription(int);

      vi.useFakeTimers();
      try {
        // The first two re-lists fail (count climbs), the third acknowledges.
        let failures = 0;
        int.client.listen = () => {
          if (failures < 2) {
            failures += 1;
            return Promise.reject(new Error("re-listen boom"));
          }
          return Promise.resolve(makeFakeSub().sub);
        };

        int.onModernSubscriptionClosed(
          fake.sub,
          "remote",
          int.modernListenGeneration,
        );
        // Advance through the two failures and the successful ack.
        for (let i = 0; i < 4; i++) {
          await vi.advanceTimersByTimeAsync(20_000);
        }
        // A successful ack resets the run, so a subsequent drop starts fresh.
        expect(int.modernReconnectAttempts).toBe(0);
        expect(connected.getResourceSubscriptionStreamState().status).toBe(
          "acknowledged",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reconnect when the subscription set empties before the timer fires", async () => {
      // No list-change opt-ins, so emptying the set empties the *filter* —
      // which is what the timer's bail now tests (#1920).
      const started = await startServer({});
      const { connected } = await connect(
        started.url,
        "modern",
        NO_LIST_CHANGED,
      );
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

    /**
     * A server that answers `subscriptions/listen` with a bare JSON-RPC result
     * — the spec's graceful-closure marker — instead of acknowledging it
     * (#2097). The condition is deterministic, so the Inspector must end the
     * stream on the first occurrence and say why, rather than re-listing eight
     * times in silence (#2063).
     *
     * These run against the real never-acknowledging test server rather than a
     * stubbed rejection, which is what keeps them honest: the predicate reads
     * the SDK's message, so an SDK that rephrases it fails here instead of
     * silently reverting to the retry loop.
     */
    describe("server never acknowledges the listen (#2097)", () => {
      const NEVER_ACK = { neverAcknowledgeSubscriptions: true } as const;

      it("fails the subscribe with the explanation, without retrying", async () => {
        const started = await startServer(NEVER_ACK);
        const { connected, messages } = await connect(started.url, "modern");
        messages.length = 0;

        await expect(
          connected.subscribeToResource(RESOURCE_URI),
        ).rejects.toThrow(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE);

        // One attempt, not the eight-deep backoff run. Give the reconnect timer
        // room to have fired had one been armed (the base delay is 500ms).
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        expect(
          methodsSent(messages).filter((m) => m === "subscriptions/listen"),
        ).toHaveLength(1);
      });

      it("reports the never-acknowledged status while a subscription remains", async () => {
        const started = await startServer(NEVER_ACK);
        const { connected } = await connect(started.url, "modern");
        const int = internals(connected);
        // A URI already in the set stands in for a first subscription this
        // server would never have honored: the failing subscribe below rolls
        // back only its own URI, so the stream state stays `active` and the
        // badge — the surface the reason has to reach — is rendered.
        int.subscribedResources.add(RESOURCE_URI_2);

        await expect(
          connected.subscribeToResource(RESOURCE_URI),
        ).rejects.toThrow(/not retrying/i);

        const state = connected.getResourceSubscriptionStreamState();
        expect(state.status).toBe("never-acknowledged");
        expect(state.active).toBe(true);
        expect(state.honoredUris).toEqual([]);
      });

      it("ends a reconnect run rather than spending it on the same answer", async () => {
        // A stream that dropped and now re-lists against a server that will not
        // acknowledge. The reconnect must stop at the first such answer instead
        // of exhausting the eight-attempt cap — the behavior #2063 observed.
        const started = await startServer(NEVER_ACK);
        const { connected, messages } = await connect(started.url, "modern");
        const int = internals(connected);
        // Stand in for the state a dropped stream leaves behind: a subscribed
        // URI (so the filter still wants a stream) and a live subscription
        // object to close.
        int.subscribedResources.add(RESOURCE_URI);
        const fake = await installFakeSubscription(int);

        messages.length = 0;
        int.onModernSubscriptionClosed(
          fake.sub,
          "remote",
          int.modernListenGeneration,
        );
        await vi.waitFor(
          () => {
            expect(connected.getResourceSubscriptionStreamState().status).toBe(
              "never-acknowledged",
            );
          },
          { timeout: 5_000 },
        );
        // One re-listen consumed, not the eight the cap allows; and the run is
        // ended rather than counting up towards it.
        expect(
          methodsSent(messages).filter((m) => m === "subscriptions/listen"),
        ).toHaveLength(1);
        expect(int.modernReconnectAttempts).toBe(0);
      });

      /**
       * The showcase fixture's mode, and the only shape that reaches the badge:
       * the never-acknowledged status is gated on a live subscription, which a
       * server refusing from the outset never lets you hold.
       *
       * The list-change exemption is the load-bearing half. The Inspector opens
       * a listen at connect time whenever a list-change opt-in is live (#1920),
       * so a mode that counted *listens* would spend its allowance there and
       * refuse the user's very first Subscribe — leaving the documented repro
       * describing something the trace does not show.
       */
      it("acknowledges the first resource subscription, then refuses (after-first)", async () => {
        const started = await startServer({
          neverAcknowledgeSubscriptions: "after-first",
        });
        // Every list-change opt-in ON, so the connect-time listen really is
        // opened — that is the listen the exemption has to let through.
        const { connected, messages } = await connect(started.url, "modern", {
          tools: true,
          resources: true,
          prompts: true,
        });
        expect(
          methodsSent(messages).filter((m) => m === "subscriptions/listen"),
        ).toHaveLength(1);

        // First resource subscription: acknowledged, so the allowance was still
        // unspent after the connect-time listen.
        await expect(
          connected.subscribeToResource(RESOURCE_URI),
        ).resolves.toBeUndefined();
        expect(connected.getResourceSubscriptionStreamState()).toMatchObject({
          active: true,
          status: "acknowledged",
        });

        // Second: refused. The first URI survives the rollback, so the stream
        // stays `active` and the badge is rendered.
        await expect(
          connected.subscribeToResource(RESOURCE_URI_2),
        ).rejects.toThrow(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE);
        expect(connected.getResourceSubscriptionStreamState()).toMatchObject({
          active: true,
          status: "never-acknowledged",
        });
        expect(connected.getSubscribedResources()).toEqual([RESOURCE_URI]);
      });

      it("retries again after the user re-subscribes", async () => {
        // The flag is a fact about the last attempt, not a latch: a fresh
        // user-initiated subscribe must be allowed to reach the server again.
        const started = await startServer(NEVER_ACK);
        const { connected } = await connect(started.url, "modern");
        await expect(
          connected.subscribeToResource(RESOURCE_URI),
        ).rejects.toThrow();
        expect(internals(connected).modernNeverAcknowledged).toBe(true);

        await expect(
          connected.subscribeToResource(RESOURCE_URI_2),
        ).rejects.toThrow();
        // Reset at the start of the second attempt and set again by its own
        // rejection — i.e. the second listen really went out.
        expect(internals(connected).modernNeverAcknowledged).toBe(true);
      });
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
