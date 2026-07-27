import { describe, it, expect, vi } from "vitest";
import type {
  JSONRPCMessage,
  Root,
  Transport,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

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
 * that queue and announce it — otherwise the web pending-request modal outlives
 * the connection it belongs to. There are three: a failed `connect()`, a
 * mid-session transport close, and an explicit `disconnect()`. `disconnect()`
 * and the crash path clear before dispatching `disconnect`, so a handler
 * reading the queue sees it empty. `connect()`'s own catch dispatches no
 * `disconnect` — though on a real transport its `dropCachedTransport()` usually
 * fires `onclose` first, which clears, announces and *does* dispatch one, so
 * the catch's own call is really the backstop for the auth-recovery sub-case,
 * where the transport is retained and no `onclose` fires. The crash and
 * failure paths emit the change events immediately; `disconnect()` batches them
 * with its other teardown dispatches.
 *
 * Some cases cover the other side of the registration gates. Client capabilities
 * are fixed at construction, so each gate must key off what was actually
 * advertised rather than the option it was derived from: a later `setRoots()`
 * must not make a subsequent `connect()` register a roots handler that was
 * never advertised, and an `elicit` option that enables no mode must not
 * register an elicitation handler. Either mistake throws before the handshake,
 * so the client cannot connect at all.
 *
 * The converse category is the advertised capability object itself: it must
 * only invite requests we actually serve. `capabilities.tasks.requests` names
 * the server→client requests we accept as tasks, so it is built from the
 * sampling/elicitation capabilities rather than from `receiverTasks` alone —
 * otherwise a server takes an invitation we answer `-32601` on, which is where
 * this whole thread started.
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
    const reply = new Promise<JSONRPCMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`No reply to injected ${method} (id ${id})`));
      }, 1000);
      // Cleared on reply — an armed timer outliving the test is the #1760
      // teardown-crash class, even though this callback touches no `window`.
      this.waiters.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
    this.deliver({ jsonrpc: "2.0", id, method });
    return reply;
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
 * Resolve when the client enqueues an elicitation. Waits on the client's own
 * signal rather than counting microtasks — the enqueue is one tick deep today
 * with no margin, and an added await on the SDK's inbound path would flake it.
 * Raced with a reject for the same reason `injectRequest` is: a regression that
 * stops the enqueue should fail here, not hang to the vitest timeout.
 */
function waitForNewPendingElicitation(client: InspectorClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No newPendingElicitation after elicit()")),
      1000,
    );
    client.addEventListener(
      "newPendingElicitation",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Connects cleanly, then samples on demand and records the client's reply. */
class SampleAfterConnectTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  static readonly SAMPLE_ID = 9401;

  async start(): Promise<void> {}
  async close(): Promise<void> {}

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
    const queued = waitForNewPendingElicitation(client);
    transport.elicit();
    await queued;
    expect(client.getPendingElicitations()).toHaveLength(1);

    // The server process dies.
    transport.onclose?.();

    expect(client.getPendingElicitations()).toEqual([]);
    expect(elicitationCounts.at(-1)).toBe(0);
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
    const queued = waitForNewPendingElicitation(client);
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
    const queued = new Promise<void>((resolve) =>
      client.addEventListener("newPendingSample", () => resolve(), {
        once: true,
      }),
    );
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
});
