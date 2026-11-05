/**
 * #2831 — `GET /api/mcp/sessions` lists every live backend session and
 * `DELETE /api/mcp/sessions/:sessionId` terminates one, so a session whose tab
 * went away (and the stdio child behind it) can be ended without restarting
 * the Inspector.
 *
 * Like `session-detach-reap.test.ts`, these drive the real routes against a
 * real stdio child that reports its own pid, and assert on that process —
 * the resource terminating a session exists to release. Every wait is on an
 * observable condition, never a fixed sleep.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  createRemoteApp,
  SESSION_TERMINATED_MESSAGE,
  sessionServerName,
} from "@inspector/core/mcp/remote/node/server.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import type {
  RemoteSessionListResponse,
  RemoteSessionSummary,
} from "@inspector/core/mcp/remote/types.js";
import { closeHarnessServer } from "./harnessTeardown.js";

const TOKEN = "active-sessions-token";
const AUTH = { "x-mcp-remote-auth": `Bearer ${TOKEN}` };
/** Bound on waiting for a child to exit; inside the 30s test budget. */
const EXIT_WAIT_MS = 15_000;

interface Harness {
  baseUrl: string;
  server: ServerType;
}

const harnesses: Harness[] = [];
const aborts: AbortController[] = [];

async function startServer(): Promise<Harness> {
  const { app } = createRemoteApp({
    authToken: TOKEN,
    initialConfig: { defaultEnvironment: {} },
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

async function connect(h: Harness, serverName?: unknown): Promise<string> {
  const res = await fetch(`${h.baseUrl}/api/mcp/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({
      config: LONG_LIVED,
      ...(serverName !== undefined && { serverName }),
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

async function openEvents(h: Harness, sessionId: string): Promise<Response> {
  const abort = new AbortController();
  aborts.push(abort);
  const res = await fetch(
    `${h.baseUrl}/api/mcp/events?sessionId=${sessionId}`,
    { headers: AUTH, signal: abort.signal },
  );
  expect(res.status).toBe(200);
  return res;
}

/** Read the stream until `pattern` matches, returning the text read so far. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: RegExp,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!pattern.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${pattern}: ${text}`);
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

async function childPid(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<number> {
  const text = await readUntil(reader, /pid=(\d+)/);
  return Number(text.match(/pid=(\d+)/)![1]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listSessions(h: Harness): Promise<RemoteSessionSummary[]> {
  const res = await fetch(`${h.baseUrl}/api/mcp/sessions`, { headers: AUTH });
  expect(res.status).toBe(200);
  return ((await res.json()) as RemoteSessionListResponse).sessions;
}

async function terminate(h: Harness, sessionId: string): Promise<Response> {
  return fetch(`${h.baseUrl}/api/mcp/sessions/${sessionId}`, {
    method: "DELETE",
    headers: AUTH,
  });
}

describe("GET /api/mcp/sessions (#2831)", () => {
  it("requires the API token, like every other /api route", async () => {
    const h = await startServer();
    const list = await fetch(`${h.baseUrl}/api/mcp/sessions`);
    expect(list.status).toBe(401);
    const del = await fetch(`${h.baseUrl}/api/mcp/sessions/anything`, {
      method: "DELETE",
    });
    expect(del.status).toBe(401);
  });

  it("is empty before any connect", async () => {
    const h = await startServer();
    expect(await listSessions(h)).toEqual([]);
  });

  it("describes each live session, oldest first", async () => {
    const h = await startServer();
    const first = await connect(h, "  Everything  ");
    const second = await connect(h);

    const before = await listSessions(h);
    expect(before.map((s) => s.sessionId)).toEqual([first, second]);
    expect(before[0]).toMatchObject({
      sessionId: first,
      serverName: "Everything",
      transport: "stdio",
      consumerAttached: false,
      lastConsumerSeenAt: null,
      transportDead: false,
    });
    expect(Date.parse(before[0]!.createdAt)).not.toBeNaN();
    expect(before[1]).not.toHaveProperty("serverName");

    // Attaching a consumer drains the queue and marks the session attached.
    const events = await openEvents(h, first);
    const reader = events.body!.getReader();
    await childPid(reader);
    const attached = (await listSessions(h)).find((s) => s.sessionId === first);
    expect(attached).toMatchObject({
      consumerAttached: true,
      queuedEvents: 0,
    });
    expect(attached!.lastConsumerSeenAt).not.toBeNull();

    await terminate(h, first);
    await terminate(h, second);
  });
});

describe("DELETE /api/mcp/sessions/:sessionId (#2831)", () => {
  it("answers 404 for a session the backend does not hold", async () => {
    const h = await startServer();
    const res = await terminate(h, "no-such-session");
    expect(res.status).toBe(404);
  });

  it("ends a detached session's stdio child and drops it from the list", async () => {
    const h = await startServer();
    const sessionId = await connect(h, "Leaky");
    const events = await openEvents(h, sessionId);
    const reader = events.body!.getReader();
    const pid = await childPid(reader);
    reader.releaseLock();
    // The tab goes away; the session stays behind, detached.
    aborts.splice(0).forEach((a) => a.abort());
    await vi.waitFor(async () => {
      const [s] = await listSessions(h);
      expect(s!.consumerAttached).toBe(false);
    });
    const [detached] = await listSessions(h);
    expect(detached!.lastConsumerSeenAt).not.toBeNull();
    expect(isAlive(pid)).toBe(true);

    const res = await terminate(h, sessionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await listSessions(h)).toEqual([]);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: EXIT_WAIT_MS,
      interval: 50,
    });
    expect((await terminate(h, sessionId)).status).toBe(404);
  });

  it("tells an attached tab why its session ended", async () => {
    const h = await startServer();
    const sessionId = await connect(h);
    const events = await openEvents(h, sessionId);
    const reader = events.body!.getReader();
    const pid = await childPid(reader);

    expect((await terminate(h, sessionId)).status).toBe(200);

    const text = await readUntil(reader, /event: transport_error/);
    expect(text).toContain(SESSION_TERMINATED_MESSAGE);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
      timeout: EXIT_WAIT_MS,
      interval: 50,
    });
  });
});

describe("sessionServerName (#2831)", () => {
  it("keeps a non-blank string, trimmed", () => {
    expect(sessionServerName(" My Server ")).toBe("My Server");
  });

  it("drops anything that is not a non-blank string", () => {
    expect(sessionServerName(undefined)).toBeUndefined();
    expect(sessionServerName(42)).toBeUndefined();
    expect(sessionServerName({ name: "x" })).toBeUndefined();
    expect(sessionServerName("   ")).toBeUndefined();
  });

  it("cuts an over-long name to a label's length", () => {
    expect(sessionServerName("x".repeat(1000))).toHaveLength(256);
  });
});
