/**
 * Regression tests for #1858 — the web UI hanging forever on "Connecting…"
 * in Firefox.
 *
 * Firefox does not hand a streaming `fetch()` response to JS until the first
 * *body* byte arrives (Chromium resolves on headers). Both SSE endpoints used
 * to flush headers and then stay silent until there was something to report,
 * which deadlocked `/api/mcp/events`: the browser transport awaits that fetch
 * before the MCP client sends `initialize`, so nothing was ever reported and
 * the fetch never resolved.
 *
 * The fix is a priming SSE comment written the instant each stream opens.
 * These tests assert the bytes land on an otherwise-idle stream — the
 * behavior the browser depends on — rather than any particular payload.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { closeHarnessServer } from "./harnessTeardown.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  storageDir: string;
}

async function setup(): Promise<Harness> {
  const storageDir = mkdtempSync(join(tmpdir(), "sse-priming-"));
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    storageDir,
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
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server, storageDir });
      },
    );
    server.on("error", reject);
  });
}

/**
 * Read the first body chunk off a streaming response, or reject if none
 * arrives within `timeoutMs`. Pre-fix, an idle stream produced no chunk at
 * all — which is exactly what stalled Firefox — so the timeout is the
 * assertion that matters here.
 */
async function firstChunk(res: Response, timeoutMs = 3000): Promise<string> {
  if (!res.body) throw new Error("response has no body");
  const reader = res.body.getReader();
  try {
    const read = reader.read().then(({ value }) => {
      return value ? new TextDecoder().decode(value) : "";
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`no body bytes within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([read, timeout]);
  } finally {
    await reader.cancel().catch(() => {
      /* stream already torn down */
    });
  }
}

/** The inert SSE comment frame the backend primes each stream with. */
const PRIMING_FRAME = ":\n\n";

describe("SSE streams are primed on open (#1858)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await closeHarnessServer(h.server);
    rmSync(h.storageDir, { recursive: true, force: true });
  });

  it("GET /api/mcp/events flushes bytes before any MCP traffic", async () => {
    // A subprocess that spawns and stays alive but never speaks — the state
    // the session is in between `connect` and the client's `initialize`.
    // This is precisely the window in which the deadlock occurred.
    const config: MCPServerConfig = {
      type: "stdio",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
    };

    const connectRes = await fetch(`${h.baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    expect(connectRes.status).toBe(200);
    const { sessionId } = (await connectRes.json()) as { sessionId: string };

    const controller = new AbortController();
    try {
      const eventsRes = await fetch(
        `${h.baseUrl}/api/mcp/events?sessionId=${sessionId}`,
        { signal: controller.signal },
      );
      expect(eventsRes.status).toBe(200);

      expect(await firstChunk(eventsRes)).toBe(PRIMING_FRAME);
    } finally {
      controller.abort();
      await fetch(`${h.baseUrl}/api/mcp/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {
        /* best-effort teardown */
      });
    }
  });

  it("GET /api/servers/events flushes bytes before any file change", async () => {
    const controller = new AbortController();
    try {
      const res = await fetch(`${h.baseUrl}/api/servers/events`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);

      expect(await firstChunk(res)).toBe(PRIMING_FRAME);
    } finally {
      controller.abort();
    }
  });

  it("primes with an SSE comment, which carries no event or data field", () => {
    // The priming frame must be inert: a conforming parser drops it, so no
    // client needs to know about it. Guards against it ever being changed
    // into something a consumer would mistake for a real event.
    const lines = PRIMING_FRAME.split("\n");
    expect(lines.some((l) => l.startsWith("data:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("event:"))).toBe(false);
    expect(lines[0]).toBe(":");
  });
});
