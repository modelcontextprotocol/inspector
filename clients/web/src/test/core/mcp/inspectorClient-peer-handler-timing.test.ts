import { describe, it, expect, vi } from "vitest";
import type {
  JSONRPCMessage,
  Root,
  Transport,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { ModernGetTaskResultSchema } from "@inspector/core/mcp/modernTaskSchemas.js";

/**
 * Regression coverage for #1797: a server may talk to us the instant it is
 * initialized, and the Inspector must already be able to answer.
 *
 * The client advertises `roots` (and sampling/elicitation/tasks) on the SDK
 * `Client` at construction, so from the moment `connect()` sends
 * `notifications/initialized` the server is entitled to call `roots/list`.
 * `server-filesystem` does exactly that — it learns its allowed directories that
 * way — and used to get `-32601 Method not found` because the handlers were
 * registered after the handshake had already resolved.
 *
 * Driving this over a real HTTP server would make the assertion a race (the
 * outcome depends on whether the server's request lands before or after the
 * post-connect awaits). The fake transport below removes the timing entirely: it
 * delivers the server→client traffic synchronously from inside the `send()` of
 * `notifications/initialized`, i.e. at the earliest instant any server could.
 *
 * `tasks/list` rides along with `roots/list` so the assertion pins the whole
 * pre-handshake registration block rather than one member of it — moving any of
 * it back after `connect()` fails here. (`sampling/createMessage` and
 * `elicitation/create` are deliberately left out: they park a pending request
 * awaiting user input, so they have no reply to assert on.)
 *
 * The `roots/list_changed` notification is injected too, covering the sibling
 * `registerPeerNotificationHandlers()`. Note the spec sends that notification
 * the *other* way (client→server), so the inbound handler is defensive rather
 * than something a conformant server exercises — this pins where it is
 * registered, not a behaviour real servers depend on.
 *
 * One case never connects at all: it covers the constructor's `cleanRoots`
 * normalization — same #1797 thread, since answering `roots/list` promptly is
 * only useful if what we answer with is well-formed.
 *
 * The teardown cases cover the flip side of the same move. Registering the
 * handlers before the handshake also widened the window in which a server can
 * queue a request with us, so every path that ends a connection has to clear
 * that queue, announce it, and settle each entry — otherwise the web
 * pending-request modal outlives the connection it belongs to, and the server
 * is left waiting on a request we accepted and never answered. There are three: a
 * failed `connect()`, a mid-session transport close, and an explicit
 * `disconnect()`. `disconnect()` and the crash path clear before dispatching
 * `disconnect`, so a handler reading the queue sees it empty. `connect()`'s
 * own catch dispatches no `disconnect` — though on a real transport its
 * `dropCachedTransport()` usually fires `onclose` first, which clears,
 * announces and *does* dispatch one, so the catch's own call is really the
 * backstop for the auth-recovery sub-case, where the transport is retained and
 * no `onclose` fires. The crash and failure paths emit the change events
 * immediately; `disconnect()` batches them with its other teardown dispatches.
 *
 * The outbound direction needs settling too, on its own terms. The raw-wire
 * modern `tasks/*` map is ours — the SDK's era gate keeps those frames out of
 * its own `_responseHandlers`, so its teardown can't settle them — and a
 * Tasks-tab poll in flight when the server dies would otherwise wait out its
 * own 30s timeout and blame the timeout for a crash. It is rejected on the two
 * paths that can hold one, `disconnect()` and the crash path; the `connect()`
 * catch needs no such call, because nothing populates the map before the
 * handshake and both terminal paths clear it.
 *
 * Both directions carry the same caveat, and it is covered for each: those
 * paths are every way *out*, which is not every way *in*. An `onerror` without
 * an `onclose` only flips the status — it runs none of them, and leaves the
 * transport cached for the next `connect()` to reuse — so the queue and the
 * raw-wire map are swept start-clean at the top of `connect()` as well. The
 * end-clean clears stay where they are regardless: a consumer handling the
 * `disconnect` event has to see them already empty, which a sweep on the way
 * back in cannot provide.
 *
 * A further category is session scoping. Receiver tasks, resource
 * subscriptions, cancelled task ids, paused task-input aborts and the modern
 * log-level opt-in are all scoped to one connection — `tasks/list` is answered
 * from that map, and a stale subscription makes the modern subscribe a silent
 * no-op — so they belong to the session that created them. Note the contrast
 * with the teardown cases above: the peer-request queue is cleared end-clean,
 * because its emptiness has to be observable from the `disconnect` event, and
 * only swept on the way in as a backstop; this has no such consumer, so it is
 * *reset* start-clean at the top of `connect()` and nowhere else — a crash, or
 * a failed connect the caller retries on the same instance, means ending a
 * session is not the only way a new one begins.
 * Reset, not cleared: the log level is re-derived from the server setting
 * rather than dropped, so a mid-session override does not carry over and the
 * configured level is not lost. The same category covers a release obligation,
 * not just a misread one: the reset must close what it drops, since a
 * `connect()` reusing a transport an `onerror` left up can be holding the last
 * reference to a live stream. That release is best-effort in both directions —
 * it is also covered that a `close()` failing either way, synchronously or by
 * rejecting, does not escape into the straight-line teardown around the reset's
 * other caller, `disconnect()`, whose remaining steps most callers would never
 * see skipped.
 *
 * Some cases cover the other side of the registration gates. Client capabilities
 * are fixed at construction, so each gate must key off what was actually
 * advertised rather than the option it was derived from: a later `setRoots()`
 * must not make a subsequent `connect()` register a roots handler that was
 * never advertised, and an `elicit` option that enables no mode must not
 * register an elicitation handler. Either mistake throws before the handshake,
 * so the client cannot connect at all.
 *
 * A note on the ordering, since two axes describe this file equally well and
 * they cut differently: the cases are grouped by *route* — everything the
 * `onerror`-then-reconnect route has to settle sits together, rather than each
 * collection sitting with its own category. Where a case is the counterpart of
 * one in another group, it is placed next to its counterpart (the two halves of
 * the stream-release obligation, one per route) rather than with its route.
 *
 * The converse category is the advertised capability object itself: it must
 * only invite requests we actually serve, and so must the notifications we
 * emit. `capabilities.tasks.requests` names the server→client requests we
 * accept as tasks, so it is built from the sampling/elicitation capabilities
 * rather than from `receiverTasks` alone; and a `roots/list_changed` is an
 * invitation to re-read roots, so it is withheld on a client that never
 * advertised the capability (the SDK refuses it too — the guard only avoids
 * provoking that rejection). Otherwise a server takes an invitation we answer
 * `-32601` on, which is where this whole thread started.
 */
class InitializedRacingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  /** Ids for the requests injected at `initialized`, by method. */
  static readonly REQUEST_IDS = { "roots/list": 9001, "tasks/list": 9002 };

  /** The client's replies to the injected requests, keyed by request id. */
  readonly replies = new Map<number, JSONRPCMessage>();

  /** Resolvers for {@link injectRequest}, keyed by the id awaiting a reply. */
  private readonly waiters = new Map<number, (m: JSONRPCMessage) => void>();

  /**
   * Whether to fire the server→client burst at `initialized`. Off for the
   * `setRoots()` test, which injects by hand once the client is connected.
   */
  private readonly burstOnInitialized: boolean;

  constructor(burstOnInitialized = true) {
    this.burstOnInitialized = burstOnInitialized;
  }

  /**
   * Deliver a server→client request outside the `initialized` burst, resolving
   * with the client's reply. The handler is async, so the reply lands some
   * microtasks later — awaiting it here beats guessing how many. Rejects rather
   * than hanging to the vitest timeout if the client never answers, so a
   * regression fails where it happened.
   */
  injectRequest(method: string, id: number): Promise<JSONRPCMessage> {
    const reply = new Promise<JSONRPCMessage>((resolve) => {
      this.waiters.set(id, resolve);
    });
    this.deliver({ jsonrpc: "2.0", id, method });
    return withTimeout(reply, `No reply to injected ${method} (id ${id})`, {
      onTimeout: () => this.waiters.delete(id),
    });
  }

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (
      "method" in message &&
      message.method === "initialize" &&
      "id" in message
    ) {
      const params = message.params as { protocolVersion: string };
      this.deliver({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "racing-server", version: "1.0.0" },
        },
      });
      return;
    }
    if ("method" in message && message.method === "notifications/initialized") {
      if (!this.burstOnInitialized) return;
      // The moment the server learns we are initialized, it talks to us.
      for (const [method, id] of Object.entries(
        InitializedRacingTransport.REQUEST_IDS,
      )) {
        this.deliver({ jsonrpc: "2.0", id, method });
      }
      this.deliver({
        jsonrpc: "2.0",
        method: "notifications/roots/list_changed",
      });
      return;
    }
    if (
      "id" in message &&
      typeof message.id === "number" &&
      ("result" in message || "error" in message)
    ) {
      this.replies.set(message.id, message);
      this.waiters.get(message.id)?.(message);
      this.waiters.delete(message.id);
    }
  }

  private deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

/**
 * Delivers an `elicitation/create` at `initialized` — the earliest a server
 * could — and then fails the `logging/setLevel` that `connect()` issues after
 * the handshake, so the connect attempt dies with a peer request already queued.
 */
class ElicitThenFailTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("method" in message)) return;
    if (message.method === "initialize" && "id" in message) {
      const params = message.params as { protocolVersion: string };
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          // Advertise logging so connect() issues the setLevel we fail below.
          capabilities: { logging: {} },
          serverInfo: { name: "failing-server", version: "1.0.0" },
        },
      });
      return;
    }
    if (message.method === "notifications/initialized") {
      this.onmessage?.({
        jsonrpc: "2.0",
        id: 9201,
        method: "elicitation/create",
        // `properties` is required — the SDK validates inbound params, and a
        // schema without it is rejected before our handler ever enqueues.
        params: {
          message: "Your name?",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      });
      return;
    }
    if (message.method === "logging/setLevel" && "id" in message) {
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "no logging for you" },
      });
    }
  }
}

/** Connects cleanly, then elicits on demand so a test can kill the transport. */
class ElicitAfterConnectTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  /** Methods of every client→server notification sent, in order. */
  readonly sentNotifications: string[] = [];

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  elicit(): void {
    this.onmessage?.({
      jsonrpc: "2.0",
      id: 9301,
      method: "elicitation/create",
      params: {
        message: "Your name?",
        requestedSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if ("method" in message && !("id" in message)) {
      this.sentNotifications.push(message.method);
      return;
    }
    if (
      "method" in message &&
      message.method === "initialize" &&
      "id" in message
    ) {
      const params = message.params as { protocolVersion: string };
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "dying-server", version: "1.0.0" },
        },
      });
    }
  }
}

/**
 * Race `promise` against a short reject, so a regression fails where it
 * happened instead of hanging to the vitest timeout — which names the test
 * rather than the thing that didn't occur. The timer is cleared on settle so
 * nothing armed outlives the test (the #1760 class). `onTimeout` runs only on
 * the reject path, for callers with an entry to drop when nobody answered.
 */
function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  { ms = 1000, onTimeout }: { ms?: number; onTimeout?: () => void } = {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/**
 * Resolve when the client enqueues a pending peer request. Waits on the
 * client's own signal rather than counting microtasks — the enqueue is one tick
 * deep today with no margin, and an added await on the SDK's inbound path would
 * flake it.
 */
function waitForNewPendingRequest(
  client: InspectorClient,
  event: "newPendingElicitation" | "newPendingSample",
): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      client.addEventListener(event, () => resolve(), { once: true });
    }),
    `No ${event} after the request was delivered`,
  );
}

/** Connects cleanly, then samples on demand so a test can tear the client down. */
class SampleAfterConnectTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  static readonly SAMPLE_ID = 9401;

  /** Methods of every client→server notification sent, in order. */
  readonly sentNotifications: string[] = [];

  /** Resolvers for {@link injectRequest}, keyed by the id awaiting a reply. */
  private readonly waiters = new Map<number, (m: JSONRPCMessage) => void>();

  /**
   * Deliver a server→client request, resolving with the client's reply. The
   * handler is async, so awaiting the reply beats guessing how many microtasks
   * it takes; the timeout drops the waiter so a failing run leaves nothing in
   * the map.
   */
  injectRequest(method: string, id: number): Promise<JSONRPCMessage> {
    const reply = new Promise<JSONRPCMessage>((resolve) => {
      this.waiters.set(id, resolve);
    });
    this.onmessage?.({ jsonrpc: "2.0", id, method });
    return withTimeout(reply, `No reply to injected ${method} (id ${id})`, {
      onTimeout: () => this.waiters.delete(id),
    });
  }

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  /** A task-augmented sample, which creates a receiver-task record. */
  sampleAsTask(): void {
    this.onmessage?.({
      jsonrpc: "2.0",
      id: SampleAfterConnectTransport.SAMPLE_ID + 1,
      method: "sampling/createMessage",
      params: {
        messages: [{ role: "user", content: { type: "text", text: "hi" } }],
        maxTokens: 10,
        task: { ttl: 60_000 },
      },
    });
  }

  sample(): void {
    this.onmessage?.({
      jsonrpc: "2.0",
      id: SampleAfterConnectTransport.SAMPLE_ID,
      method: "sampling/createMessage",
      params: {
        messages: [{ role: "user", content: { type: "text", text: "hi" } }],
        maxTokens: 10,
      },
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if ("method" in message && !("id" in message)) {
      this.sentNotifications.push(message.method);
      return;
    }
    if (
      "method" in message &&
      message.method === "initialize" &&
      "id" in message
    ) {
      const params = message.params as { protocolVersion: string };
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "sampling-server", version: "1.0.0" },
        },
      });
      return;
    }
    if (
      "id" in message &&
      typeof message.id === "number" &&
      ("result" in message || "error" in message)
    ) {
      this.waiters.get(message.id)?.(message);
      this.waiters.delete(message.id);
    }
  }
}

describe("InspectorClient peer-handler timing (#1797)", () => {
  it("serves server→client traffic that arrives with notifications/initialized", async () => {
    const roots = [{ uri: "file:///work", name: "Work" }];
    const transport = new InitializedRacingTransport();
    const rootsChanges: unknown[] = [];
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        roots,
        receiverTasks: true,
      },
    );
    client.addEventListener("rootsChange", (event) => {
      rootsChanges.push((event as CustomEvent).detail);
    });

    await client.connect();

    // roots/list — the request that regressed (#1797).
    const rootsReply = transport.replies.get(
      InitializedRacingTransport.REQUEST_IDS["roots/list"],
    );
    expect(rootsReply).toBeDefined();
    // Asserted separately from the `toMatchObject` below because this is the
    // assertion that names the pre-fix failure: the reply was an error object
    // carrying -32601 Method not found.
    expect(rootsReply).not.toHaveProperty("error");
    expect(rootsReply).toMatchObject({ result: { roots } });

    // tasks/list — pins the rest of the block registered at the same point.
    const tasksReply = transport.replies.get(
      InitializedRacingTransport.REQUEST_IDS["tasks/list"],
    );
    expect(tasksReply).toBeDefined();
    expect(tasksReply).not.toHaveProperty("error");
    expect(tasksReply).toMatchObject({ result: { tasks: [] } });

    // notifications/roots/list_changed — a notification has no reply, and an
    // unhandled one is dropped silently (no wire error), so the effect is the
    // only observable: the handler dispatches `rootsChange`.
    expect(rootsChanges).toEqual([roots]);

    await client.disconnect();
  });

  it("normalizes a malformed roots option at construction", () => {
    // Core owns the invariant rather than trusting each client to clean at its
    // call site — the constructor is the fourth way roots enter the client, and
    // the option can come straight off hand-edited mcp.json.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = new InspectorClient(
        { type: "stdio", command: "noop", args: [] },
        {
          environment: {
            transport: () => ({ transport: new InitializedRacingTransport() }),
          },
          roots: [{ name: "no uri" }, { uri: "file:///keep" }] as Root[],
        },
      );
      expect(client.getRoots()).toEqual([{ uri: "file:///keep" }]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("serves roots set after connect, given roots were advertised at construction", async () => {
    // `setRoots()` announces `notifications/roots/list_changed`, inviting the
    // server to re-read — so the handler must answer with the *current* roots,
    // not the ones passed at construction. It reads `this.roots` live, so it
    // does; this pins that. Passing the `roots` option at all — which the CLI
    // now always does, empty when nothing is configured
    // (`clients/cli/src/cli.ts`) — is what makes the handler exist. A
    // client built with no `roots` option cannot serve this: the SDK asserts
    // the capability in `setRequestHandler`, and the capability itself is
    // fixed at `initialize`.
    const transport = new InitializedRacingTransport(false);
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) }, roots: [] },
    );

    await client.connect();
    await client.setRoots([{ uri: "file:///late", name: "Late" }]);

    const reply = await transport.injectRequest("roots/list", 9101);
    expect(reply).not.toHaveProperty("error");
    expect(reply).toMatchObject({
      result: { roots: [{ uri: "file:///late", name: "Late" }] },
    });

    await client.disconnect();
  });

  it("drops a peer request queued during a connect that then fails", async () => {
    // Registering the handlers before the handshake (#1797) widened the window
    // in which a server can queue a request to include the part of connect()
    // that can still fail. The failure path must not leave the queue behind:
    // web derives its pending-request modal from these lengths with no status
    // gate, so a stranded entry means a live modal on a dead connection, and a
    // URL elicitation's waiter would never settle.
    const transport = new ElicitThenFailTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        initialLoggingLevel: "debug",
      },
    );
    // The events, not the arrays, are what removes the modal:
    // `usePendingClientRequests` tracks its own state off them, so clearing
    // without dispatching would leave a live modal on a dead connection —
    // invisible to a getter-only assertion.
    const elicitationCounts: number[] = [];
    client.addEventListener("pendingElicitationsChange", (event) => {
      elicitationCounts.push((event as CustomEvent).detail.length);
    });
    const sampleCounts: number[] = [];
    client.addEventListener("pendingSamplesChange", (event) => {
      sampleCounts.push((event as CustomEvent).detail.length);
    });

    await expect(client.connect()).rejects.toThrow();

    expect(client.getPendingElicitations()).toEqual([]);
    expect(client.getPendingSamples()).toEqual([]);
    expect(elicitationCounts.at(-1)).toBe(0);
    // The helper announces both queues whenever either was non-empty, so the
    // sampling event fires here too even though nothing sampled.
    expect(sampleCounts.at(-1)).toBe(0);
  });

  it("drops a peer request queued when the connection dies mid-session", async () => {
    // The other way a connection ends without `disconnect()`: the server goes
    // away. Same hazards — a modal for a dead connection, and a URL
    // elicitation's waiter (which blocks `callTool`) never settling.
    const transport = new ElicitAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) } },
    );
    const elicitationCounts: number[] = [];
    client.addEventListener("pendingElicitationsChange", (event) => {
      elicitationCounts.push((event as CustomEvent).detail.length);
    });

    await client.connect();
    const queued = waitForNewPendingRequest(client, "newPendingElicitation");
    transport.elicit();
    await queued;
    expect(client.getPendingElicitations()).toHaveLength(1);

    // The server process dies.
    transport.onclose?.();

    expect(client.getPendingElicitations()).toEqual([]);
    expect(elicitationCounts.at(-1)).toBe(0);
  });

  it("answers a queued sampling request when the connection is torn down", async () => {
    // We accepted the server's `sampling/createMessage`, so dropping it without
    // settling means no response frame is ever written and the server waits
    // forever. Reachable because the transport can outlive a failed attempt —
    // `connect()` keeps it when an auth provider holds it open.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) } },
    );

    await client.connect();
    const queued = waitForNewPendingRequest(client, "newPendingSample");
    transport.sample();
    await queued;
    const [pending] = client.getPendingSamples();
    expect(pending).toBeDefined();

    await client.disconnect();

    expect(client.getPendingSamples()).toEqual([]);
    // Settled, not merely discarded: `respond` refuses a request that already
    // has an answer, so this throwing is the proof the promise was settled.
    // (Whether the response frame reaches the wire depends on whether the
    // transport outlived the teardown — on this path `disconnect()` closed it
    // first, which is why the assertion is on the settle rather than on a
    // recorded reply.)
    await expect(
      pending!.respond({
        role: "assistant",
        content: { type: "text", text: "late" },
        model: "test",
      }),
    ).rejects.toThrow(/already resolved or rejected/);
  });

  it("has already cleared the queue by the time `disconnect` fires", async () => {
    // `disconnect()` clears above its status block so a consumer handling the
    // event sees an empty queue, matching the crash path. That ordering is the
    // whole point of the clear's position, and moving it back below the block —
    // which reads tidier, next to the batched change events — would silently
    // restore the asymmetry. This is what notices.
    const transport = new ElicitAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) } },
    );

    await client.connect();
    const queued = waitForNewPendingRequest(client, "newPendingElicitation");
    transport.elicit();
    await queued;
    expect(client.getPendingElicitations()).toHaveLength(1);

    let queueDuringDisconnectEvent = -1;
    client.addEventListener("disconnect", () => {
      queueDuringDisconnectEvent = client.getPendingElicitations().length;
    });
    // The array is what a `disconnect` handler reads; the change event is what
    // drives the modal. `disconnect()` batches the latter after its `disconnect`
    // dispatch, so this is asserted after the await rather than inside the
    // listener — pinning that it happens, not where it interleaves.
    const elicitationCounts: number[] = [];
    client.addEventListener("pendingElicitationsChange", (event) => {
      elicitationCounts.push((event as CustomEvent).detail.length);
    });
    // This fixture's close() never fires onclose, so the clear under test is
    // `disconnect()`'s own, not the crash path's.
    await client.disconnect();

    expect(queueDuringDisconnectEvent).toBe(0);
    expect(elicitationCounts.at(-1)).toBe(0);
  });

  it("rejects an in-flight raw-wire request when the connection dies", async () => {
    // The modern `tasks/*` frames ride a raw-wire channel the SDK's era gate
    // refuses to route, so the SDK's own teardown doesn't know about them. A
    // Tasks-tab poll in flight when the server dies would otherwise wait out
    // its own 30s timeout and report a timeout for what was a crash.
    const transport = new ElicitAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        // Short, so a regression run doesn't leave the raw-wire request's own
        // timer armed past the failing test — and so its message ("timed out
        // after 50 ms") beats a generic race message at describing the failure.
        // Note this is the *client-wide* request timeout, not a per-call one;
        // it is safe here only because this test issues no SDK request after
        // connect (`fetchServerInfo` reads cached values, and no
        // `setLoggingLevel` since the fixture advertises no logging). Anything
        // added later would inherit the 50ms budget.
        timeout: 50,
      },
    );
    await client.connect();

    // `rawWireRequest` is private, and every public route to it
    // (`getRequestorTask` / `updateRequestorTask` / `cancelRequestorTask`) is
    // gated on `isTasksExtensionNegotiated()`, which needs a modern-era
    // handshake this fixture doesn't perform — so driving the channel directly
    // is the only way to exercise it. The cast asserts only the method's real
    // signature.
    const pending = (
      client as unknown as {
        rawWireRequest: (
          method: string,
          params: Record<string, unknown>,
          schema: { parse: (v: unknown) => unknown },
        ) => Promise<unknown>;
      }
    ).rawWireRequest("tasks/get", { taskId: "t1" }, ModernGetTaskResultSchema);
    // Attach the rejection handler before the crash so it is never unhandled.
    // No tick in between: `rawWireRequest` registers its pending entry
    // synchronously (the promise executor runs during the call), so the entry
    // is already there — asserting that ordering rather than papering over it.
    const settled = expect(pending).rejects.toThrow(/Connection closed/);

    transport.onclose?.();

    // The short request timeout set above is what makes a regression fail fast
    // and name itself — the assertion reports `timed out after 50 ms` against
    // the expected /Connection closed/. The race is the backstop for the
    // narrower case where the request's own timer is broken too, so nothing
    // settles at all.
    await withTimeout(settled, "raw-wire request not settled by teardown");
  });

  it("does not carry receiver tasks into the next session", async () => {
    // A record is a task the *server* created with us, and `tasks/list` is
    // answered from that map — so one surviving a reconnect reports a task the
    // new server never created. `disconnect()` cleared them, but that is not
    // the only way a session ends: a crash, or a failed connect the caller
    // retries on this same instance, both leave them behind.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        receiverTasks: true,
      },
    );
    await client.connect();

    const queued = waitForNewPendingRequest(client, "newPendingSample");
    transport.sampleAsTask();
    await queued;
    // Asserted through `tasks/list` — that handler is what a server actually
    // sees, and it is the symptom: a surviving record is reported to a server
    // that never created it.
    expect(await transport.injectRequest("tasks/list", 9501)).toMatchObject({
      result: { tasks: [expect.anything()] },
    });

    // The server dies; the caller reconnects on the same instance.
    transport.onclose?.();
    await client.connect();

    expect(await transport.injectRequest("tasks/list", 9502)).toMatchObject({
      result: { tasks: [] },
    });

    await client.disconnect();
  });

  it("does not carry subscriptions or cancelled task ids into the next session", async () => {
    // Same class as the receiver tasks, with sharper symptoms: a stale
    // subscription makes the modern `subscribeToResource` early-return, so the
    // user's next Subscribe click silently sends nothing; a stale cancelled-id
    // mislabels a *new* task sharing that id as cancelled rather than failed.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) } },
    );
    await client.connect();

    // Seeded directly: subscribing for real needs a server that answers
    // `resources/subscribe` and cancelling needs a live task, neither of which
    // adds to what is under test — that a new session starts empty. The cast is
    // the only route to `cancelledTaskIds`, which has no public reader.
    const internals = client as unknown as {
      subscribedResources: Set<string>;
      cancelledTaskIds: Set<string>;
      modernStreamState: {
        active: boolean;
        status: string;
        honoredUris: string[];
      };
    };
    internals.subscribedResources.add("file:///watched");
    internals.cancelledTaskIds.add("task-1");
    // The stream state a live modern subscription would have left behind.
    internals.modernStreamState = {
      active: true,
      status: "ended",
      honoredUris: ["file:///watched"],
    };
    // The dispatch is the half the UI tracks — `ResourceSubscriptionsState`
    // listens only to the event, never reading the field.
    const streamStates: { active: boolean }[] = [];
    client.addEventListener("resourceSubscriptionStreamChange", (event) => {
      streamStates.push((event as CustomEvent).detail);
    });
    // Same for the set: `ResourceSubscriptionsState` reads `event.detail` and
    // never the client's field, so clearing without announcing would leave the
    // Resources tiles standing on a reconnected session.
    const subscriptionLists: string[][] = [];
    client.addEventListener("resourceSubscriptionsChange", (event) => {
      subscriptionLists.push((event as CustomEvent).detail);
    });

    transport.onclose?.();
    await client.connect();

    expect(client.getSubscribedResources()).toEqual([]);
    expect(internals.cancelledTaskIds.size).toBe(0);
    // Cleared with the set it is derived from, not left reading `active` for
    // an empty one.
    expect(client.getResourceSubscriptionStreamState()).toMatchObject({
      active: false,
    });
    expect(streamStates.at(-1)).toMatchObject({ active: false });
    expect(subscriptionLists.at(-1)).toEqual([]);

    await client.disconnect();
  });

  it("restores the configured modern log level across a reconnect", async () => {
    // Two halves of the same member. A mid-session override must not carry into
    // the next session, and — the #1629 bug — a `disconnect()` must not leave
    // the configured level dropped, which silently stopped stamping
    // `_meta` logLevel on everything after a reconnect.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        serverSettings: {
          headers: [],
          env: [],
          metadata: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
          modernLogLevel: "info",
        },
      },
    );

    await client.connect();
    expect(client.getModernLogLevel()).toBe("info");

    client.setModernLogLevel("error");
    transport.onclose?.();
    await client.connect();
    expect(client.getModernLogLevel()).toBe("info");

    await client.disconnect();
    await client.connect();
    expect(client.getModernLogLevel()).toBe("info");

    await client.disconnect();
  });

  it("aborts a paused task-input wait when the session ends", async () => {
    // The bounded-window member: both registration sites release in a
    // `finally`, so nothing leaks permanently — this closes the gap between a
    // crash and the loop unwinding on its own.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport }) } },
    );
    await client.connect();

    // Seeded directly: reaching this map for real needs a modern task paused at
    // `input_required`, which adds nothing to what is under test. No public
    // reader, hence the cast.
    const controller = new AbortController();
    (
      client as unknown as {
        taskInputAbortControllers: Map<string, AbortController>;
      }
    ).taskInputAbortControllers.set("task-1", controller);

    transport.onclose?.();
    await client.connect();

    expect(controller.signal.aborted).toBe(true);

    await client.disconnect();
  });

  it("closes a live listen stream the next connect drops", async () => {
    // An `onerror` without an `onclose` leaves the transport up, and `connect()`
    // reuses it — so the reference the reset drops can be the last one to a
    // stream still open on the server. Nothing else can close it afterwards:
    // the `closed` handler bails on the bumped generation (production
    // behaviour, not asserted here — the stub below has no `closed` promise, so
    // that handler never runs).
    const transport = new SampleAfterConnectTransport();
    // Counted, because transport *reuse* is what makes "a stream still open on
    // the server" true — if a future change recreated it here, the scenario
    // would quietly stop applying while the test kept passing.
    let created = 0;
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => {
            created++;
            return { transport };
          },
        },
      },
    );
    await client.connect();

    let closed = false;
    // Seeded directly: establishing a real listen stream needs a modern server
    // answering `subscriptions/listen`, which adds nothing to what is tested.
    // No public writer, hence the cast.
    (
      client as unknown as {
        modernSubscription: { close: () => Promise<void> } | null;
      }
    ).modernSubscription = {
      close: async () => {
        closed = true;
      },
    };

    transport.onerror?.(new Error("stream broke, transport still up"));
    await client.connect();

    expect(closed).toBe(true);
    expect(created).toBe(1);

    await client.disconnect();
  });

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
    it(`continues teardown when the dropped stream's close() ${label}`, async () => {
      // The release obligation from the other side: the reset closes what it
      // drops, and a `close()` that fails either way is absorbed. Be precise
      // about *which* harm is absorbed at this site, because the two are not
      // interchangeable: the call is `void`-ed onto an `async` helper, so even
      // the synchronous throw becomes a dropped rejection rather than reaching
      // `disconnect()` — the teardown below it runs regardless. What the
      // wrapping prevents is the rejection going *unhandled*, which ends a Node
      // process by default. Hence the listener: it is the assertion that fails
      // if the helper's `try/catch` is removed. The two teardown assertions are
      // kept for the neighbouring regression — unwrapping this to a bare
      // `void closing.close()`, where the synchronous half would propagate.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);

      const transport = new SampleAfterConnectTransport();
      const client = new InspectorClient(
        { type: "stdio", command: "noop", args: [] },
        { environment: { transport: () => ({ transport }) } },
      );
      await client.connect();

      // Seeded directly, for the reasons `closes a live listen stream the next
      // connect drops` and `aborts a paused task-input wait when the session
      // ends` give. No public writer for either, hence the casts.
      (
        client as unknown as {
          modernSubscription: { close: () => Promise<void> } | null;
        }
      ).modernSubscription = { close };

      // A downstream teardown step, to witness that teardown continued.
      const controller = new AbortController();
      (
        client as unknown as {
          taskInputAbortControllers: Map<string, AbortController>;
        }
      ).taskInputAbortControllers.set("task-1", controller);

      try {
        await expect(client.disconnect()).resolves.toBeUndefined();
        expect(controller.signal.aborted).toBe(true);

        // Node reports an unhandled rejection after the microtask checkpoint,
        // so yield to the macrotask queue before reading the listener — nothing
        // else in this test would give it a chance to fire.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  }

  it("clears a peer request the next connect would otherwise inherit", async () => {
    // Same route as `closes a live listen stream the next connect drops`, for
    // the other collection it strands. An
    // `onerror` without an `onclose` runs neither teardown path, so the queue
    // the three teardown paths clear end-clean is still populated when
    // `connect()` reuses the live transport — and the web modal is derived from
    // its length with no status gate, so answering it would write a response
    // for the old session's request id onto the new connection. `connect()`
    // sweeps it start-clean for exactly this route.
    const transport = new ElicitAfterConnectTransport();
    // Counted for the same reason as that test: transport *reuse* is the
    // premise.
    let created = 0;
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => {
            created++;
            return { transport };
          },
        },
      },
    );
    const elicitationCounts: number[] = [];
    client.addEventListener("pendingElicitationsChange", (event) => {
      elicitationCounts.push((event as CustomEvent).detail.length);
    });

    await client.connect();
    const queued = waitForNewPendingRequest(client, "newPendingElicitation");
    transport.elicit();
    await queued;
    expect(client.getPendingElicitations()).toHaveLength(1);

    // Status goes to "error" and stops — no `onclose`, transport left cached.
    transport.onerror?.(new Error("stream broke, transport still up"));
    expect(client.getPendingElicitations()).toHaveLength(1);

    await client.connect();

    expect(client.getPendingElicitations()).toEqual([]);
    // Announced, not just emptied: the modal reads the change event.
    expect(elicitationCounts.at(-1)).toBe(0);
    expect(created).toBe(1);

    await client.disconnect();
  });

  it("sweeps the queue without reporting the outgoing session's task", async () => {
    // The sweep must stay *after* `resetSessionState()`, and the two calls read
    // as independent. Cancelling a task-augmented peer request settles it
    // synchronously into the record callback, which ends in
    // `upsertReceiverTask` — a no-op only because `clearReceiverTasks()` just
    // emptied the map. Hoisted above the reset, it would emit a
    // `notifications/tasks/status` for the ending session's task onto the
    // transport this connect is about to reuse. This is what notices.
    const transport = new SampleAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        receiverTasks: true,
      },
    );
    await client.connect();

    const queued = waitForNewPendingRequest(client, "newPendingSample");
    transport.sampleAsTask();
    await queued;

    transport.onerror?.(new Error("stream broke, transport still up"));
    // Only the reconnect's frames are under test; the first session legitimately
    // reported the task it created.
    transport.sentNotifications.length = 0;
    await client.connect();

    expect(transport.sentNotifications).not.toContain(
      "notifications/tasks/status",
    );

    await client.disconnect();
  });

  it("rejects an in-flight raw-wire request the next connect would inherit", async () => {
    // The outbound half of the same route. Milder than the queue — the id is
    // instance-scoped and monotonic, so a stale entry can't be resolved by the
    // new session's traffic — but it is round 30's symptom exactly: without the
    // sweep the poll waits out its own 30s timer and blames a timeout for what
    // was a crash.
    const transport = new ElicitAfterConnectTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        // Short so a regression names itself, as in the crash-path case above
        // — but safe here for a different reason than that one gives: this
        // test connects twice, so an SDK `initialize` *is* issued under the
        // client-wide budget. It can't race because this fixture answers
        // `initialize` synchronously from inside `send()`, so no timer is ever
        // in play. A fixture that answered a macrotask later would flake.
        timeout: 50,
      },
    );
    await client.connect();

    const pending = (
      client as unknown as {
        rawWireRequest: (
          method: string,
          params: Record<string, unknown>,
          schema: { parse: (v: unknown) => unknown },
        ) => Promise<unknown>;
      }
    ).rawWireRequest("tasks/get", { taskId: "t1" }, ModernGetTaskResultSchema);
    const settled = expect(pending).rejects.toThrow(/Connection ended/);

    // No `onclose`, so nothing settles it on the way out.
    transport.onerror?.(new Error("stream broke, transport still up"));
    await client.connect();

    await withTimeout(
      settled,
      "raw-wire request not settled by the next connect",
    );

    await client.disconnect();
  });

  it("connects when an elicit option enables no mode", async () => {
    // `{ form: false, url: false }` is a valid option that advertises no
    // elicitation capability. Registering `elicitation/create` on `this.elicit`
    // being truthy would throw "Client does not support elicitation capability"
    // before the handshake — so the client could not connect at all.
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => ({ transport: new ElicitAfterConnectTransport() }),
        },
        elicit: { form: false, url: false },
      },
    );

    await expect(client.connect()).resolves.toBeUndefined();

    await client.disconnect();
  });

  it("can reconnect after setRoots() on a client built without roots", async () => {
    // `setRoots()` makes `this.roots` defined on a client that never advertised
    // the capability. Gating the `roots/list` registration on that would throw
    // "Client does not support roots capability" from `setRequestHandler` on
    // every later connect() — before the handshake, so the client could never
    // reconnect. The gate reads what was advertised at construction instead.
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => ({ transport: new ElicitAfterConnectTransport() }),
        },
      },
    );

    await client.connect();
    await client.setRoots([{ uri: "file:///late" }]);
    await client.disconnect();

    await expect(client.connect()).resolves.toBeUndefined();
    // Stored and readable, but no server can ask for them — the capability was
    // never advertised, so no handler is registered.
    expect(client.getRoots()).toEqual([{ uri: "file:///late" }]);

    await client.disconnect();
  });

  it("advertises task requests only for capabilities it advertised", async () => {
    // `capabilities.tasks.requests` tells the server which server→client
    // requests we accept as tasks. Built from `receiverTasks` alone it would
    // invite a task-augmented `elicitation/create` that no handler answers —
    // advertise-then-refuse, the shape #1797 is about.
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => ({ transport: new ElicitAfterConnectTransport() }),
        },
        receiverTasks: true,
        elicit: false,
      },
    );

    const capabilities = client.getClientCapabilities();
    expect(capabilities.tasks).toBeDefined();
    expect(capabilities.tasks?.requests?.elicitation).toBeUndefined();
    expect(capabilities.tasks?.requests?.sampling).toBeDefined();
    expect(capabilities.elicitation).toBeUndefined();

    // Neither advertised: `requests` is omitted rather than sent empty, which
    // would claim "I accept no task-augmented requests" instead of saying
    // nothing. `tasks` itself stays — list/cancel are still serviceable.
    const noRequests = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: {
          transport: () => ({ transport: new ElicitAfterConnectTransport() }),
        },
        receiverTasks: true,
        sample: false,
        elicit: false,
      },
    );
    expect(noRequests.getClientCapabilities().tasks).toBeDefined();
    expect(noRequests.getClientCapabilities().tasks?.requests).toBeUndefined();
  });

  it("announces roots/list_changed only when roots were advertised", async () => {
    // Pins the end state rather than this client's guard: the SDK also refuses
    // the notification from a client that never declared `roots.listChanged`
    // (it rejects, which `setRoots` used to log as a send *failure*), so the
    // wire stays clean either way. What this asserts is that a server is never
    // invited to re-read roots we have no handler to serve.
    const withRoots = new ElicitAfterConnectTransport();
    const advertised = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport: withRoots }) },
        roots: [],
      },
    );
    await advertised.connect();
    await advertised.setRoots([{ uri: "file:///a" }]);
    expect(withRoots.sentNotifications).toContain(
      "notifications/roots/list_changed",
    );
    await advertised.disconnect();

    const withoutRoots = new ElicitAfterConnectTransport();
    const silent = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      { environment: { transport: () => ({ transport: withoutRoots }) } },
    );
    await silent.connect();
    await silent.setRoots([{ uri: "file:///a" }]);
    expect(withoutRoots.sentNotifications).not.toContain(
      "notifications/roots/list_changed",
    );
    // Still stored locally — only the announcement is withheld.
    expect(silent.getRoots()).toEqual([{ uri: "file:///a" }]);
    await silent.disconnect();
  });
});
