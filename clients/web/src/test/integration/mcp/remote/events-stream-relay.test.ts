/**
 * #3029 — an `events/stream` through the web relay.
 *
 * The relay waits for every request's answer twice: the backend holds
 * `POST /api/mcp/send` open until it arrives, and the browser waits for it on
 * the event channel, each with a 60 s budget (#2028). A push stream is answered
 * only when its subscription ends, so either wait firing would tear down a
 * healthy stream. Both are unbounded for `events/stream`, and both are released
 * by a cancellation.
 *
 * Driven the way the browser drives it — InspectorClient -> RemoteClientTransport
 * -> the Hono backend -> a real upstream Streamable HTTP transport -> the
 * Events fixture — with the browser's budget shrunk so "outlives the relay
 * wait" is observable in a test, and the backend's asserted directly.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { Tool } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { RemoteSession } from "@inspector/core/mcp/remote/node/remote-session.js";
import {
  eraToVersionNegotiation,
  type CreateTransport,
} from "@inspector/core/mcp/types.js";
import {
  EventSubscriptionsState,
  type EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  loadConfig,
  resolveConfig,
  EVENT_TYPE_NAMES,
  EVENTS_CONTROL_TOOL_NAMES,
} from "@modelcontextprotocol/inspector-test-server";

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");

/** The browser's relay wait, shrunk from 60 s so outliving it is testable. */
const BROWSER_WAIT_MS = 400;
/** Condition-wait budget; strictly inside the 30 s integration budget. */
const WAIT = { timeout: 10_000, interval: 20 };

async function startBackend(): Promise<{
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

describe("events/stream through the web relay (#3029)", () => {
  let client: InspectorClient | null = null;
  let backend: ServerType | null = null;
  let upstream: TestServerHttp | null = null;
  let state: EventSubscriptionsState | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    state?.destroy();
    state = null;
    try {
      await client?.disconnect();
    } catch {
      // ignore
    }
    client = null;
    if (backend) {
      const server = backend;
      backend = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      await upstream?.stop();
    } catch {
      // ignore
    }
    upstream = null;
  });

  async function connect(): Promise<{
    c: InspectorClient;
    baseUrl: string;
    authToken: string;
  }> {
    upstream = createTestServerHttp({
      ...resolveConfig(loadConfig(MODERN_CONFIG)),
      port: undefined,
    });
    await upstream.start();
    const started = await startBackend();
    backend = started.server;
    const { baseUrl, authToken } = started;
    const transport: CreateTransport = (config, options = {}) => ({
      transport: new RemoteClientTransport(
        {
          baseUrl,
          authToken,
          sseResponseTimeoutMs: BROWSER_WAIT_MS,
          onFetchRequest: options.onFetchRequest,
        },
        config,
      ),
    });
    const c = new InspectorClient(
      { type: "streamable-http", url: upstream.url },
      {
        environment: { transport },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    client = c;
    await c.connect();
    expect(c.getProtocolEra()).toBe("modern");
    return { c, baseUrl, authToken };
  }

  async function control(
    c: InspectorClient,
    name: string,
    args: Record<string, string | number> = {},
  ): Promise<Record<string, unknown>> {
    const tools: Tool[] = (await c.listAllTools()).tools;
    const tool = tools.find((t) => t.name === name)!;
    const result = await c.callTool(tool, args);
    expect(result.success).toBe(true);
    return (result.result?.structuredContent ?? {}) as Record<string, unknown>;
  }

  async function openStreams(c: InspectorClient): Promise<number> {
    const stats = await control(c, EVENTS_CONTROL_TOOL_NAMES.stats);
    return stats.openStreams as number;
  }

  function sub(s: EventSubscriptionsState, id: string): EventSubscription {
    return s.getSubscription(id)!;
  }

  it("keeps a push stream open past the relay's waits, and cancels it on stop", async () => {
    const backendWait = vi.spyOn(
      RemoteSession.prototype,
      "waitForRequestResponse",
    );
    const { c } = await connect();
    const s = new EventSubscriptionsState(c);
    state = s;
    const { events } = await c.listAllEvents();
    const incident = events.find((e) => e.name === EVENT_TYPE_NAMES.allModes)!;

    const created = s.subscribe(incident, { mode: "push", heartbeatMs: 100 });
    await vi.waitFor(
      () => expect(sub(s, created.id).status).toBe("active"),
      WAIT,
    );
    // The backend holds the stream's send open with no timeout.
    const streamWait = backendWait.mock.calls.find(
      ([id]) => id === sub(s, created.id).subscriptionId,
    );
    expect(streamWait?.[1]).toBe(0);

    // Outlive the browser's relay wait by a wide margin, then deliver. A
    // deliberate wall-clock wait: the property under test is that nothing
    // fires within it, so there is no condition to wait on instead.
    await new Promise((resolve) => setTimeout(resolve, BROWSER_WAIT_MS * 3));
    expect(sub(s, created.id).status).toBe("active");
    expect(sub(s, created.id).counts.reconnects).toBe(0);
    await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
      name: EVENT_TYPE_NAMES.allModes,
    });
    await vi.waitFor(
      () => expect(sub(s, created.id).counts.events).toBe(1),
      WAIT,
    );

    // Stop is the browser's abort, carried through to the upstream stream.
    s.stop(created.id);
    await vi.waitFor(async () => expect(await openStreams(c)).toBe(0), WAIT);
  });

  it("releases the backend's held send when the request is cancelled", async () => {
    const { c, baseUrl, authToken } = await connect();
    const sessionId = c.getRemoteBackendSessionId()!;
    const headers = {
      "content-type": "application/json",
      "x-mcp-remote-auth": `Bearer ${authToken}`,
    };
    const post = (message: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/mcp/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId,
          message,
          protocolVersion: "2026-07-28",
        }),
      });

    // A stream request the browser's SDK client knows nothing about, sent the
    // way the stdio cancellation path would: its send is held open...
    const held = post({
      jsonrpc: "2.0",
      id: 9001,
      method: "events/stream",
      params: {
        name: EVENT_TYPE_NAMES.allModes,
        arguments: {},
        cursor: null,
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    });
    await vi.waitFor(async () => expect(await openStreams(c)).toBe(1), WAIT);

    // ...until a `notifications/cancelled` for it releases it as answered.
    const cancelled = await post({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 9001, reason: "stopped" },
    });
    expect(cancelled.ok).toBe(true);
    const response = await held;
    expect(await response.json()).toEqual({ ok: true });
    await vi.waitFor(async () => expect(await openStreams(c)).toBe(0), WAIT);
  });
});
