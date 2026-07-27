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
 * The last two cover the flip side of the same move. Registering the handlers
 * before the handshake also widened the window in which a server can queue a
 * request with us, so the two paths that end a connection without going through
 * `disconnect()` — a failed `connect()` and a mid-session transport close — must
 * clear that queue *and* announce it, or the web pending-request modal outlives
 * the connection it belongs to.
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
    // Wait on the client's own signal rather than counting microtasks — the
    // enqueue is one tick deep today with no margin, and an added await on the
    // SDK's inbound path would flake this (see `injectRequest` above).
    const queued = new Promise<void>((resolve) =>
      client.addEventListener("newPendingElicitation", () => resolve(), {
        once: true,
      }),
    );
    transport.elicit();
    await queued;
    expect(client.getPendingElicitations()).toHaveLength(1);

    // The server process dies.
    transport.onclose?.();

    expect(client.getPendingElicitations()).toEqual([]);
    expect(elicitationCounts.at(-1)).toBe(0);
  });
});
