import { describe, it, expect, afterEach } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { FetchRequestLogState } from "@inspector/core/mcp/state/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type {
  AnnotatedRequestTimeoutData,
  ConnectionDiagnostics,
} from "@inspector/core/mcp/connectionDiagnostics.js";

/**
 * Request-timeout diagnostics against a real connection (#2318).
 *
 * The #2187 shape: a server that answers `initialize`, holds the standalone
 * `GET /mcp` notification stream open without ever emitting an event, and
 * never answers `tools/list`. The SDK's per-request timeout fires and the
 * Inspector's word on it used to be `Request timed out`. These tests drive the
 * real transport, the real SDK client and the real timeout, and assert on what
 * the rejection now says — plus the snapshot and the events it is built from.
 *
 * Hand-rolled rather than a composable test server because the fixture has
 * to misbehave in ways the SDK's own server cannot be configured to: hold a
 * request forever, and push raw bytes down the GET stream on cue.
 */

/** A short budget so the timeout fires in test time rather than in 60s. */
const REQUEST_TIMEOUT_MS = 300;

type ToolsListMode = "hang" | "error";

interface HangingServer {
  url: string;
  /** Every JSON-RPC method the server was sent, in order. */
  calls: string[];
  /** Write one SSE event onto every open GET stream. */
  pushEvent: (message: Record<string, unknown>) => void;
  /** Write a comment-only keepalive block onto every open GET stream. */
  pushKeepalive: () => void;
  /** How many GET streams have been opened so far. */
  streamsOpened: () => number;
  setToolsListMode: (mode: ToolsListMode) => void;
  stop: () => Promise<void>;
}

function startHangingServer(): Promise<HangingServer> {
  const calls: string[] = [];
  const streams = new Set<ServerResponse>();
  const held = new Set<ServerResponse>();
  let streamsOpened = 0;
  let toolsListMode: ToolsListMode = "hang";

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET") {
      streamsOpened += 1;
      streams.add(res);
      res.on("close", () => streams.delete(res));
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      // Headers out now, so the client's fetch resolves and the stream reads
      // as open — without a byte of event data on it.
      res.flushHeaders();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id?: unknown;
      method: string;
    };
    calls.push(body.method);
    // Notifications (`notifications/initialized`, and the SDK's own
    // `notifications/cancelled` when the timeout fires) get an empty 202.
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const reply = (payload: Record<string, unknown>) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...payload }));
    };
    if (body.method === "initialize") {
      reply({
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "hanging-server", version: "1.0.0" },
        },
      });
      return;
    }
    if (body.method === "tools/list") {
      if (toolsListMode === "error") {
        reply({ error: { code: -32603, message: "tools/list exploded" } });
        return;
      }
      // Never answered. Kept so teardown can release the socket.
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    reply({ result: {} });
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      /* v8 ignore next -- listen() on a fresh server always yields an AddressInfo */
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        calls,
        pushEvent: (message) => {
          for (const res of streams) {
            res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
          }
        },
        pushKeepalive: () => {
          for (const res of streams) res.write(": keepalive\n\n");
        },
        streamsOpened: () => streamsOpened,
        setToolsListMode: (mode) => {
          toolsListMode = mode;
        },
        stop: () =>
          new Promise((done) => {
            for (const res of held) res.destroy();
            for (const res of streams) res.destroy();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Poll until `predicate` holds; the failure names what never became true. */
async function waitUntil(
  what: string,
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("InspectorClient request-timeout diagnostics (#2318)", () => {
  let client: InspectorClient | null = null;
  let server: HangingServer | null = null;

  /**
   * `beforeConnect` runs on the constructed client before `connect()`, so a
   * listener it attaches sees every fetch — including the notification-stream
   * GET, which the SDK can open and the transport can log before `connect()`
   * resolves (#2580).
   */
  async function connectTo(
    url: string,
    beforeConnect?: (c: InspectorClient) => void,
  ): Promise<InspectorClient> {
    client = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        // Pinned legacy so the connect is exactly `initialize` and nothing
        // else — the assertions below name the last response by method.
        versionNegotiation: eraToVersionNegotiation("legacy"),
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    beforeConnect?.(client);
    await client.connect();
    return client;
  }

  /** The SDK opens the GET stream after `notifications/initialized`, off the connect path. */
  async function waitForNotificationStream(c: InspectorClient): Promise<void> {
    await waitUntil(
      "the notification stream to be tracked",
      () => c.getConnectionDiagnostics().notificationStream !== undefined,
    );
  }

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // Teardown only — the assertions already ran.
    }
    client = null;
    await server?.stop();
    server = null;
  });

  it("annotates the timeout with the request, the unanswered set, the last response and the stream", async () => {
    server = await startHangingServer();
    const c = await connectTo(server.url);
    await waitForNotificationStream(c);
    server.pushKeepalive();

    let caught: unknown;
    try {
      await c.listTools();
    } catch (err) {
      caught = err;
    }

    expect(SdkError.isInstance(caught)).toBe(true);
    const error = caught as SdkError;
    expect(error.code).toBe(SdkErrorCode.RequestTimeout);
    expect(error.message).toMatch(
      new RegExp(
        "^Request timed out after 300ms \\(tools/list\\)\\. " +
          "1 request is unanswered: tools/list \\(sent \\d+(ms|s) ago\\)\\. " +
          "Last response received \\d+(ms|s) ago \\(initialize\\)\\. " +
          "Notification stream \\(GET /mcp\\) open for \\d+(ms|s), 0 events delivered\\.$",
      ),
    );
    // The structured form rides along for consumers that want it.
    const data = error.data as AnnotatedRequestTimeoutData;
    expect(data.timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(data.method).toBe("tools/list");
    expect(data.diagnostics.outstandingRequests.map((r) => r.method)).toEqual([
      "tools/list",
    ]);
    expect(data.diagnostics.lastResponse?.method).toBe("initialize");
    expect(data.diagnostics.notificationStream?.eventCount).toBe(0);
    // The SDK gave up on the request; the connection did not answer it. It is
    // still unanswered, and the live snapshot keeps saying so.
    expect(
      c.getConnectionDiagnostics().outstandingRequests.map((r) => r.method),
    ).toEqual(["tools/list"]);
    // The keepalive comment reached the client and was not counted.
    expect(c.getConnectionDiagnostics().notificationStream?.eventCount).toBe(0);
    // The SDK's legacy cancel rode the wire and the server saw the whole
    // exchange in order. The cancel is fire-and-forget on the SDK side — the
    // rejection lands before the POST does — so wait for it to arrive.
    const calls = server.calls;
    await waitUntil("the cancellation to reach the server", () =>
      calls.includes("notifications/cancelled"),
    );
    expect(calls).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "notifications/cancelled",
    ]);
  });

  it("emits connectionDiagnosticsChange as the state moves, and counts stream events", async () => {
    server = await startHangingServer();
    // Subscribe the log before connecting: the GET can be logged before
    // `connect()` resolves, and a log attached afterwards misses it (#2580).
    let log!: FetchRequestLogState;
    const c = await connectTo(server.url, (created) => {
      log = new FetchRequestLogState(created);
    });
    const snapshots: ConnectionDiagnostics[] = [];
    c.addEventListener("connectionDiagnosticsChange", (event) =>
      snapshots.push(event.detail),
    );
    try {
      await waitForNotificationStream(c);
      const stream = c.getConnectionDiagnostics().notificationStream!;
      expect(stream.url).toBe(server.url);
      expect(stream.closedAt).toBeUndefined();
      // Open from when the headers arrived, not from when the GET went out.
      const getEntryAtOpen = log
        .getFetchRequests()
        .find((entry) => entry.method === "GET");
      if (!getEntryAtOpen) {
        throw new Error("the notification-stream GET was never logged");
      }
      expect(stream.openedAt).toBe(
        getEntryAtOpen.timestamp.getTime() + (getEntryAtOpen.duration ?? 0),
      );
      // The snapshot is a copy: mutating it does not reach the client.
      const snapshot = c.getConnectionDiagnostics();
      snapshot.outstandingRequests.push({
        id: "x",
        method: "bogus",
        sentAt: 0,
      });
      expect(c.getConnectionDiagnostics().outstandingRequests).toEqual([]);

      // A server push on the notification stream is an event.
      server.pushEvent({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });
      await waitUntil(
        "the stream event to be counted",
        () => c.getConnectionDiagnostics().notificationStream?.eventCount === 1,
      );
      // ...and the Network log's entry for the GET carries the same state.
      const getEntry = log
        .getFetchRequests()
        .find((entry) => entry.method === "GET");
      expect(getEntry?.stream).toEqual({ eventCount: 1 });

      // The timeout path dispatched a snapshot with the request outstanding.
      await expect(c.listTools()).rejects.toThrow(/Request timed out/);
      expect(
        snapshots.some((s) =>
          s.outstandingRequests.some((r) => r.method === "tools/list"),
        ),
      ).toBe(true);

      // Disconnecting aborts the stream: the watcher reports the close and
      // the snapshot — which outlives the session until the next connect —
      // records it.
      await c.disconnect();
      await waitUntil(
        "the stream close to be recorded",
        () =>
          c.getConnectionDiagnostics().notificationStream?.closedAt !==
          undefined,
      );
      expect(c.getConnectionDiagnostics().notificationStream).toMatchObject({
        eventCount: 1,
      });
    } finally {
      log.destroy();
    }
  });

  it("starts the next session clean", async () => {
    server = await startHangingServer();
    const c = await connectTo(server.url);
    await waitForNotificationStream(c);
    await expect(c.listTools()).rejects.toThrow(/Request timed out/);
    expect(c.getConnectionDiagnostics().outstandingRequests).toHaveLength(1);

    await c.disconnect();
    await c.connect();

    const fresh = c.getConnectionDiagnostics();
    expect(fresh.outstandingRequests).toEqual([]);
    expect(fresh.lastResponse?.method).toBe("initialize");
    // Whether the new session's GET has landed yet is timing; what must not be
    // there is the previous session's stream.
    await waitForNotificationStream(c);
    expect(c.getConnectionDiagnostics().notificationStream?.closedAt).toBe(
      undefined,
    );
    expect(server.streamsOpened()).toBe(2);
  });

  it("leaves a failure that is not a timeout exactly as the SDK threw it", async () => {
    server = await startHangingServer();
    server.setToolsListMode("error");
    const c = await connectTo(server.url);

    await expect(c.listTools()).rejects.toThrow(/tools\/list exploded/);
    await expect(c.listTools()).rejects.not.toThrow(/unanswered/);
    // Answered (with an error), so nothing is outstanding.
    expect(c.getConnectionDiagnostics().outstandingRequests).toEqual([]);
    expect(c.getConnectionDiagnostics().lastResponse?.method).toBe(
      "tools/list",
    );
  });
});
