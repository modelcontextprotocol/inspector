/**
 * #2824 — a closed or reloaded web tab must not leak its backend session and
 * the stdio child process behind it.
 *
 * The browser going away drops `/api/mcp/events` and, before this fix, sent
 * nothing else: the session (and its spawned server) lived until the Inspector
 * exited. These tests drive the real routes against a real stdio child that
 * reports its own pid, and assert on that process — the thing that actually
 * leaked — rather than on the session map alone.
 *
 * The grace windows here are short real-time values rather than fake timers:
 * the work being timed spans a spawned process, real sockets and the SDK's
 * own close path, none of which a faked clock can drive. Each wait is on an
 * observable condition (the child is gone, the session answers 404), never a
 * fixed sleep, and the timer mechanics themselves are covered with fake
 * timers in `remote-session.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { closeHarnessServer } from "./harnessTeardown.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
}

/**
 * Grace for tests that open the events stream: it also bounds the gap between
 * `connect` returning and the events GET arriving, so it is sized for a loaded
 * machine. A test that went over it fails loudly on the events GET's 404.
 */
const ATTACHED_GRACE_MS = 3_000;
/** Bound on waiting for a reap to be observable; inside the 30s test budget. */
const REAP_WAIT_MS = 15_000;

const harnesses: Harness[] = [];
const aborts: AbortController[] = [];

async function startServer(sessionDetachGraceMs?: number): Promise<Harness> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    initialConfig: { defaultEnvironment: {} },
    ...(sessionDetachGraceMs !== undefined && { sessionDetachGraceMs }),
  });
  const h = await new Promise<Harness>((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => resolve({ baseUrl: `http://127.0.0.1:${info.port}`, server }),
    );
    server.on("error", reject);
  });
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  for (const h of harnesses.splice(0)) await closeHarnessServer(h.server);
});

/** A long-lived stdio child that announces its pid on stderr. */
const LONG_LIVED: MCPServerConfig = {
  type: "stdio",
  command: process.execPath,
  args: [
    "-e",
    "process.stderr.write('pid=' + process.pid + '\\n'); setInterval(() => {}, 1000);",
  ],
};

async function connect(h: Harness): Promise<string> {
  const res = await fetch(`${h.baseUrl}/api/mcp/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: LONG_LIVED }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

/** Open the events stream; the caller aborts it to simulate the tab going away. */
async function openEvents(
  h: Harness,
  sessionId: string,
): Promise<{ res: Response; abort: AbortController }> {
  const abort = new AbortController();
  aborts.push(abort);
  const res = await fetch(
    `${h.baseUrl}/api/mcp/events?sessionId=${sessionId}`,
    { signal: abort.signal },
  );
  return { res, abort };
}

/** Read the stream until the child's `pid=` stderr line arrives. */
async function readChildPid(res: Response): Promise<number> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const match = text.match(/pid=(\d+)/);
    if (match) {
      reader.releaseLock();
      return Number(match[1]);
    }
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before the pid line: ${text}`);
    text += decoder.decode(value, { stream: true });
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the backend still knows the session, asked through `/api/mcp/send`
 * (404 once it is forgotten). Not through `/api/mcp/events`, which would
 * *attach* a consumer and reset the very grace being measured, and not
 * through `/api/mcp/disconnect`, which answers 200 either way.
 */
async function sendStatus(h: Harness, sessionId: string): Promise<number> {
  const res = await fetch(`${h.baseUrl}/api/mcp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      message: { jsonrpc: "2.0", method: "notifications/initialized" },
    }),
  });
  await res.body?.cancel();
  return res.status;
}

async function disconnect(h: Harness, sessionId: string): Promise<void> {
  await fetch(`${h.baseUrl}/api/mcp/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

describe("remote session detach grace (#2824)", () => {
  it("closes the transport — ending the stdio child — once the events stream has been gone for the grace window", async () => {
    const h = await startServer(ATTACHED_GRACE_MS);
    const sessionId = await connect(h);
    const { res, abort } = await openEvents(h, sessionId);
    expect(res.status).toBe(200);
    const pid = await readChildPid(res);
    expect(isAlive(pid)).toBe(true);

    // The tab closes: the stream drops and nothing else arrives.
    abort.abort();

    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: REAP_WAIT_MS,
      interval: 50,
    });
    expect(await sendStatus(h, sessionId)).toBe(404);
  });

  it("reaps a session whose browser never opens the events stream at all", async () => {
    const h = await startServer(100);
    const sessionId = await connect(h);

    await vi.waitFor(
      async () => expect(await sendStatus(h, sessionId)).toBe(404),
      { timeout: REAP_WAIT_MS, interval: 50 },
    );
  });

  it("keeps the session for a consumer that reattaches inside the window", async () => {
    // Default grace (60s): nothing here can reach it.
    const h = await startServer();
    const sessionId = await connect(h);
    const first = await openEvents(h, sessionId);
    expect(first.res.status).toBe(200);
    const pid = await readChildPid(first.res);
    first.abort.abort();

    // The OAuth redirect's `attachToSession` reopens the stream.
    const second = await openEvents(h, sessionId);
    expect(second.res.status).toBe(200);
    expect(isAlive(pid)).toBe(true);

    await disconnect(h, sessionId);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: REAP_WAIT_MS,
      interval: 50,
    });
  });

  it("an explicit disconnect ends the child at once and the later stream drop is a no-op", async () => {
    const h = await startServer();
    const sessionId = await connect(h);
    const { res, abort } = await openEvents(h, sessionId);
    const pid = await readChildPid(res);

    // What the web client's `pagehide` keepalive request does.
    await disconnect(h, sessionId);
    abort.abort();

    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: REAP_WAIT_MS,
      interval: 50,
    });
    expect(await sendStatus(h, sessionId)).toBe(404);
  });
});

describe("InspectorClient.releaseRemoteSessionOnPageHide (#2824)", () => {
  it("releases the backend session of a connected remote client", async () => {
    const h = await startServer();
    const { command, args } = getTestMcpServerCommand();
    const client = new InspectorClient(
      { type: "stdio", command, args },
      {
        environment: {
          transport: createRemoteTransport({ baseUrl: h.baseUrl }),
        },
      },
    );
    await client.connect();
    const sessionId = client.getRemoteBackendSessionId();
    expect(sessionId).toBeDefined();

    expect(client.releaseRemoteSessionOnPageHide()).toBe(true);
    await vi.waitFor(
      async () => expect(await sendStatus(h, sessionId!)).toBe(404),
      { timeout: REAP_WAIT_MS, interval: 50 },
    );
    await client.disconnect().catch(() => {});
  });

  it("returns false while the client holds no remote transport", () => {
    // Before `connect()` there is no transport at all, which is also what a
    // client built on a direct (non-remote) transport reports here.
    const client = new InspectorClient(
      { type: "stdio", command: process.execPath, args: [] },
      {
        environment: {
          transport: createRemoteTransport({ baseUrl: "http://127.0.0.1:9" }),
        },
      },
    );
    expect(client.releaseRemoteSessionOnPageHide()).toBe(false);
  });
});
