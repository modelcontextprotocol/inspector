import { describe, it, expect } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
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
 */
class InitializedRacingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  /** Ids for the requests injected at `initialized`, by method. */
  static readonly REQUEST_IDS = { "roots/list": 9001, "tasks/list": 9002 };

  /** The client's replies to the injected requests, keyed by request id. */
  readonly replies = new Map<number, JSONRPCMessage>();
  /** Whether the client accepted the `roots/list_changed` notification. */
  notificationRejected = false;

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
    if ("id" in message && typeof message.id === "number") {
      this.replies.set(message.id, message);
    }
  }

  private deliver(message: JSONRPCMessage): void {
    try {
      this.onmessage?.(message);
    } catch {
      // An unhandled notification would surface here rather than on the wire.
      this.notificationRejected = true;
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

    // notifications/roots/list_changed — dropped silently when unregistered,
    // so assert on the effect (the rootsChange event) rather than a reply.
    expect(transport.notificationRejected).toBe(false);
    expect(rootsChanges).toEqual([roots]);

    await client.disconnect();
  });
});
