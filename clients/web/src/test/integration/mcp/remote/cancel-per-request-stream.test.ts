/**
 * #2140 — the Cancel button must send the transport's cancellation signal.
 *
 * On a 2026-07-28 Streamable HTTP connection the spec makes *closing the
 * request's SSE response stream* the cancellation signal, and says a
 * `notifications/cancelled` is neither required nor expected. The SDK
 * implements that fork itself: `Protocol.request` aborts a per-request
 * `AbortController` — handed to the transport as
 * `TransportSendOptions.requestSignal` — when the connection is modern **and**
 * the transport advertises `hasPerRequestStream`; otherwise it POSTs the
 * notification.
 *
 * The web client lost it at the proxy boundary. The real upstream transport
 * lives on the Node backend, and the browser's `RemoteClientTransport` neither
 * advertised the flag nor applied a `requestSignal` to its
 * `POST /api/mcp/send` — so every web cancel took the stdio branch, the server
 * answered the notification `202 Accepted` and dropped it, and the tool kept
 * running to completion. Only a manual disconnect actually cancelled anything.
 *
 * This drives the whole chain the browser drives — InspectorClient ->
 * RemoteClientTransport -> the Hono backend -> a real upstream Streamable HTTP
 * transport -> a modern test server — and asserts at the far end, on the
 * server's own request abort signal. Nothing shallower reaches it: each of the
 * three hops can drop the signal on its own, and a unit test of any one of them
 * passes while the chain stays broken.
 */

import { describe, it, expect, afterEach } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  type TestServerHttp,
  type ToolDefinition,
} from "@modelcontextprotocol/inspector-test-server";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A tool that never returns on its own. It reports when it started, and whether
 * the server-side request signal — which the SDK aborts when the client closes
 * this request's response stream — ever fired.
 */
function createSlowTool(): {
  tool: ToolDefinition;
  started: Promise<void>;
  aborted: Promise<boolean>;
} {
  const started = deferred<void>();
  const aborted = deferred<boolean>();
  const tool: ToolDefinition = {
    name: "slow_task",
    description: "Runs until the client cancels it",
    handler: async (_params, _context, extra) => {
      extra?.signal?.addEventListener("abort", () => aborted.resolve(true), {
        once: true,
      });
      started.resolve();
      // Never settles: this call ends by cancellation or not at all, so a
      // regression shows up as the test's own timeout rather than as a pass.
      return new Promise(() => {});
    },
  };
  return { tool, started: started.promise, aborted: aborted.promise };
}

async function startRemoteBackend(): Promise<{
  baseUrl: string;
  server: ServerType;
  authToken: string;
}> {
  const { app, authToken } = createRemoteApp({
    initialConfig: { defaultEnvironment: {} },
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server, authToken });
      },
    );
    server.on("error", reject);
  });
}

describe("web-client cancellation over a per-request stream (#2140)", () => {
  let client: InspectorClient | null = null;
  let backend: ServerType | null = null;
  let upstream: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
      client = null;
    }
    if (backend) {
      const server = backend;
      backend = null;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (upstream) {
      try {
        await upstream.stop();
      } catch {
        // Ignore stop errors.
      }
      upstream = null;
    }
  });

  it("aborts the upstream request stream, which the server observes as cancellation", async () => {
    const slow = createSlowTool();
    upstream = createTestServerHttp({
      serverInfo: createTestServerInfo("cancel-test", "1.0.0"),
      tools: [slow.tool],
      modern: {},
    });
    await upstream.start();

    const { baseUrl, server, authToken } = await startRemoteBackend();
    backend = server;

    const connected = new InspectorClient(
      { type: "streamable-http", url: upstream.url },
      {
        environment: {
          transport: createRemoteTransport({ baseUrl, authToken }),
        },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    await connected.connect();
    client = connected;
    expect(connected.getProtocolEra()).toBe("modern");

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "slow_task");
    expect(tool).toBeDefined();

    // Hold the rejection from the first turn so the runner never sees it as
    // unhandled while we wait on the server side.
    const settled = connected.callTool(tool!, {}).catch((err: unknown) => err);

    await slow.started;
    expect(connected.cancelToolCall()).toBe(true);

    // The user-facing contract is unchanged: a deliberate cancel still surfaces
    // as ToolCallCancelledError, whichever wire signal carried it.
    await expect(settled).resolves.toBeInstanceOf(ToolCallCancelledError);

    // The assertion that matters. Before the fix the server saw only a
    // `notifications/cancelled` it was free to ignore (and did), its request
    // signal never fired, and this promise never resolved.
    await expect(slow.aborted).resolves.toBe(true);
  });

  it("advertises the per-request stream only for streamable-http", () => {
    // The flag is what the SDK forks on, and the factory is where a server's
    // configured type reaches the transport. stdio and SSE multiplex every
    // request over one shared channel: there is no per-request stream to close,
    // and aborting anything would take the whole session down — so they must
    // keep the `notifications/cancelled` mechanism.
    const create = createRemoteTransport({ baseUrl: "http://unused.example" });
    expect(
      create({ type: "stdio", command: "echo", args: [] }, {}).transport
        .hasPerRequestStream,
    ).toBe(false);
    expect(
      create({ type: "sse", url: "http://unused.example/sse" }, {}).transport
        .hasPerRequestStream,
    ).toBe(false);
    expect(
      create({ type: "streamable-http", url: "http://unused.example/mcp" }, {})
        .transport.hasPerRequestStream,
    ).toBe(true);
  });
});
