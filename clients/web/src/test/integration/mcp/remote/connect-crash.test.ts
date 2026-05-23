/**
 * Regression test for the crash-on-startup race: when a stdio subprocess
 * spawns successfully but exits before the browser opens the SSE events
 * stream, the user should see the actual error (stderr + transport_error)
 * — not a bare "Session not found" 404.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
}

async function startServer(): Promise<Harness> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
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
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server });
      },
    );
    server.on("error", reject);
  });
}

async function teardown(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
}

interface ParsedSseEvent {
  type: string;
  data: unknown;
}

/**
 * Read a streaming Response body and parse Server-Sent Events. Stops when
 * the server closes the stream (read returns done).
 *
 * The SSE `data:` field carries the full SessionEvent JSON (both `type` and
 * `data`), per the writer in /api/mcp/events — we unwrap and surface just
 * the inner `.data` as the event payload, so callers can read e.g.
 * `event.data.message` for stdio_log without an extra hop.
 */
async function readSseEvents(res: Response): Promise<ParsedSseEvent[]> {
  if (!res.body) return [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: ParsedSseEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    // SSE events terminate with a blank line — split on it.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let type: string | undefined;
      let dataLine: string | undefined;
      for (const line of block.split("\n")) {
        if (line.startsWith("event:"))
          type = line.slice("event:".length).trim();
        else if (line.startsWith("data:"))
          dataLine = line.slice("data:".length).trim();
      }
      if (type && dataLine) {
        const parsed = JSON.parse(dataLine) as { data?: unknown };
        events.push({ type, data: parsed.data });
      }
    }
    if (done) break;
  }
  return events;
}

describe("crash-on-startup error surfacing", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startServer();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it("surfaces stderr + transport_error when the subprocess exits before the events stream opens", async () => {
    // node -e writes to stderr then exits non-zero. The transport itself
    // spawns fine (so POST /api/mcp/connect returns 200), but the process
    // is dead by the time the browser opens /api/mcp/events. Pre-fix, the
    // session was deleted in transport.onclose and the events endpoint
    // returned a bare 404; now it returns an SSE stream that drains the
    // queued stderr + transport_error events and closes.
    const config: MCPServerConfig = {
      type: "stdio",
      command: process.execPath, // current `node` binary
      args: [
        "-e",
        "process.stderr.write('boom from script\\n'); process.exit(1);",
      ],
    };

    const connectRes = await fetch(`${h.baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    expect(connectRes.status).toBe(200);
    const { sessionId } = (await connectRes.json()) as { sessionId: string };
    expect(typeof sessionId).toBe("string");

    // Give the subprocess time to die before opening the events stream.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const eventsRes = await fetch(
      `${h.baseUrl}/api/mcp/events?sessionId=${sessionId}`,
    );
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.headers.get("content-type")).toMatch(/event-stream/);

    const events = await readSseEvents(eventsRes);

    // Stderr event for "boom from script" plus a transport_error closing
    // the stream — the user now sees the real reason instead of "Session
    // not found".
    const stderrEvents = events.filter((e) => e.type === "stdio_log");
    expect(stderrEvents.length).toBeGreaterThan(0);
    const stderrText = stderrEvents
      .map((e) => (e.data as { message?: string } | undefined)?.message ?? "")
      .join("\n");
    expect(stderrText).toMatch(/boom from script/);

    const transportError = events.find((e) => e.type === "transport_error");
    expect(transportError).toBeDefined();
    const err = transportError?.data as { error: string; code: number };
    expect(err.error).toMatch(/Transport closed/);
    expect(err.code).toBe(-32000);
  });
});
