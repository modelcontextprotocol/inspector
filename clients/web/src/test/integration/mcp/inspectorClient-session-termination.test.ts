/**
 * #2924 — disconnecting over Streamable HTTP ends the server-side session.
 *
 * Before the fix `InspectorClient.disconnect()` closed the SDK client and its
 * local streams but never sent the spec's session-terminating `DELETE`, so a
 * stateful server kept every session the Inspector opened. These tests drive a
 * real Streamable HTTP test server and assert on the server's own state — the
 * `DELETE` it received, with the headers it carried, and the session map it
 * holds — over both shapes a disconnect takes:
 *
 * - **direct** (CLI, TUI, mcpdo, `--load`): the Node transport sends the
 *   `DELETE` itself;
 * - **remote** (web): the browser's `RemoteClientTransport` has no session of
 *   its own, so the web backend sends it on `/api/mcp/disconnect`, and on the
 *   detach-grace reap that follows a closed tab.
 */

import { describe, it, expect, afterEach } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createNumberedTools,
} from "@modelcontextprotocol/inspector-test-server";
import { closeHarnessServer } from "./remote/harnessTeardown.js";

const CUSTOM_HEADER = "x-inspector-test";
const CUSTOM_VALUE = "session-termination";

function settings(): InspectorServerSettings {
  return {
    headers: [{ key: CUSTOM_HEADER, value: CUSTOM_VALUE }],
    metadata: {},
    env: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };
}

let server: TestServerHttp | null = null;
let client: InspectorClient | null = null;
const backends: ServerType[] = [];
const aborts: AbortController[] = [];

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  await client?.disconnect().catch(() => {});
  client = null;
  for (const b of backends.splice(0)) await closeHarnessServer(b);
  await server?.stop().catch(() => {});
  server = null;
});

async function startTestServer(): Promise<TestServerHttp> {
  server = createTestServerHttp({
    serverInfo: createTestServerInfo("session-termination-test", "1.0.0"),
    tools: createNumberedTools(1),
  });
  await server.start();
  return server;
}

async function startBackend(sessionDetachGraceMs?: number): Promise<string> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    initialConfig: { defaultEnvironment: {} },
    ...(sessionDetachGraceMs !== undefined && { sessionDetachGraceMs }),
  });
  return new Promise<string>((resolve, reject) => {
    const backend = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => resolve(`http://127.0.0.1:${info.port}`),
    );
    backends.push(backend);
    backend.on("error", reject);
  });
}

describe("disconnect() terminates the Streamable HTTP session (#2924)", () => {
  it("direct: sends the DELETE with the session's headers and the session is gone", async () => {
    const s = await startTestServer();
    client = new InspectorClient(
      { type: "streamable-http", url: s.url },
      {
        environment: { transport: createTransportNode, fetch },
        serverSettings: settings(),
      },
    );
    const errors: unknown[] = [];
    client.addEventListener("error", (e) => errors.push(e));
    await client.connect();
    const [sessionId] = s.getActiveSessionIds();
    expect(sessionId).toBeDefined();

    await client.disconnect();

    const terminations = s.getSessionTerminations();
    expect(terminations).toHaveLength(1);
    expect(terminations[0]).toMatchObject({ sessionId, status: 200 });
    expect(terminations[0]!.headers["mcp-session-id"]).toBe(sessionId);
    expect(terminations[0]!.headers[CUSTOM_HEADER]).toBe(CUSTOM_VALUE);
    expect(terminations[0]!.headers["mcp-protocol-version"]).toBeDefined();
    expect(s.getActiveSessionIds()).toEqual([]);
    expect(client.getStatus()).toBe("disconnected");
    expect(errors).toEqual([]);
  });

  it("direct: a failed DELETE does not block local teardown or raise an error", async () => {
    const s = await startTestServer();
    const refusingFetch: typeof fetch = (input, init) =>
      init?.method === "DELETE"
        ? Promise.resolve(new Response("nope", { status: 500 }))
        : fetch(input, init);
    client = new InspectorClient(
      { type: "streamable-http", url: s.url },
      {
        environment: { transport: createTransportNode, fetch: refusingFetch },
      },
    );
    const errors: unknown[] = [];
    client.addEventListener("error", (e) => errors.push(e));
    await client.connect();

    await client.disconnect();

    expect(client.getStatus()).toBe("disconnected");
    expect(errors).toEqual([]);
    // The refusal happened client-side, so the server never saw a DELETE.
    expect(s.getSessionTerminations()).toEqual([]);
  });

  it("remote (web): the backend sends the DELETE on /api/mcp/disconnect", async () => {
    const s = await startTestServer();
    const baseUrl = await startBackend();
    client = new InspectorClient(
      { type: "streamable-http", url: s.url },
      {
        environment: { transport: createRemoteTransport({ baseUrl }) },
        serverSettings: settings(),
      },
    );
    await client.connect();
    const [sessionId] = s.getActiveSessionIds();
    expect(sessionId).toBeDefined();

    await client.disconnect();

    const terminations = s.getSessionTerminations();
    expect(terminations).toHaveLength(1);
    expect(terminations[0]).toMatchObject({ sessionId, status: 200 });
    expect(terminations[0]!.headers[CUSTOM_HEADER]).toBe(CUSTOM_VALUE);
    expect(s.getActiveSessionIds()).toEqual([]);
  });

  it("remote (web): the detach-grace reap of a closed tab sends the DELETE", async () => {
    const s = await startTestServer();
    const baseUrl = await startBackend(50);
    client = new InspectorClient(
      { type: "streamable-http", url: s.url },
      { environment: { transport: createRemoteTransport({ baseUrl }) } },
    );
    await client.connect();
    const backendSessionId = client.getRemoteBackendSessionId();
    const [sessionId] = s.getActiveSessionIds();
    expect(sessionId).toBeDefined();

    // A newer events stream takes the session's consumer over; aborting it is
    // the tab going away, which arms the (short) detach grace.
    const abort = new AbortController();
    aborts.push(abort);
    const res = await fetch(
      `${baseUrl}/api/mcp/events?sessionId=${backendSessionId}`,
      { signal: abort.signal },
    );
    expect(res.status).toBe(200);
    abort.abort();

    await expect
      .poll(() => s.getSessionTerminations().map((t) => t.sessionId), {
        timeout: 10_000,
      })
      .toEqual([sessionId]);
    expect(s.getActiveSessionIds()).toEqual([]);
  });
});
