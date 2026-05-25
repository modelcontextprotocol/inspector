/**
 * Integration tests for GET /api/servers/events — the SSE channel that
 * notifies subscribed browsers when `mcp.json` changes on disk. Covers:
 *
 *   - external write to the file triggers a broadcast
 *   - external unlink triggers a broadcast
 *   - the backend's own POST/PUT/DELETE does NOT trigger a broadcast
 *     (self-write suppression via the post-write mtime capture)
 *   - multiple connected subscribers each receive the broadcast
 *
 * Tests spin up a real TCP server (so the SSE response body flows through
 * @hono/node-server rather than the in-process Hono fetch) and read the
 * stream with `fetch().body.getReader()`. Each harness calls `closeApi()`
 * in teardown so the lazy chokidar watcher is released.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  configPath: string;
  tempDir: string;
  closeApi: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-servers-events-"));
  const configPath = join(tempDir, "mcp.json");
  const { app, close: closeApi } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
  });
  const { baseUrl, server } = await new Promise<{
    baseUrl: string;
    server: ServerType;
  }>((resolve, reject) => {
    const s = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server: s });
      },
    );
    s.on("error", reject);
  });
  return { baseUrl, server, configPath, tempDir, closeApi };
}

async function teardown(h: Harness): Promise<void> {
  await h.closeApi();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

interface EventSink {
  readonly events: string[];
  /** Resolve once `events.length >= n` (or reject after `timeoutMs`). */
  waitFor(n: number, timeoutMs?: number): Promise<void>;
  close(): void;
}

/**
 * Open an SSE subscription and parse out each `data:` payload into a flat
 * string array. Resolves once the response head is received so the caller can
 * mutate the file knowing the subscriber is registered server-side.
 */
async function subscribe(baseUrl: string): Promise<EventSink> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/servers/events`, {
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE subscribe failed: ${res.status}`);
  }

  const events: string[] = [];
  const waiters: { n: number; resolve: () => void }[] = [];

  const notifyWaiters = (): void => {
    for (const w of [...waiters]) {
      if (events.length >= w.n) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let frameEnd = buffer.indexOf("\n\n");
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (dataLine) {
            events.push(dataLine.slice("data:".length).trim());
            notifyWaiters();
          }
          frameEnd = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted by caller in close(); benign.
    }
  })();

  return {
    events,
    async waitFor(n: number, timeoutMs = 2000): Promise<void> {
      if (events.length >= n) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for ${n} event(s); saw ${events.length}`,
            ),
          );
        }, timeoutMs);
        waiters.push({
          n,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    close(): void {
      controller.abort();
    },
  };
}

describe("GET /api/servers/events", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it("emits an event when an external editor writes the config file", async () => {
    // Seed the file so chokidar starts watching an existing path. The
    // subscribe() round-trip below ensures the watcher is registered before
    // we mutate the file.
    writeFileSync(
      h.configPath,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
    );
    const sink = await subscribe(h.baseUrl);

    // Small gap so chokidar's initial-scan settles before we mutate.
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(
      h.configPath,
      JSON.stringify(
        {
          mcpServers: { alpha: { type: "stdio", command: "node" } },
        },
        null,
        2,
      ) + "\n",
    );

    await sink.waitFor(1);
    expect(sink.events).toHaveLength(1);
    expect(JSON.parse(sink.events[0]!)).toEqual({ type: "change" });
    sink.close();
  });

  it("does NOT emit when the backend's own POST /api/servers writes the file", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
    );
    const sink = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    const postRes = await fetch(`${h.baseUrl}/api/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "alpha",
        config: { type: "stdio", command: "node" },
      }),
    });
    expect(postRes.status).toBe(200);

    // awaitWriteFinish stability is 100ms; allow generous margin so a real
    // (incorrectly broadcast) event would land in `events` before we assert.
    await new Promise((r) => setTimeout(r, 400));
    expect(sink.events).toEqual([]);
    sink.close();
  });

  it("does NOT emit when the backend's own PUT /api/servers/:id writes the file", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify(
        { mcpServers: { alpha: { type: "stdio", command: "old" } } },
        null,
        2,
      ) + "\n",
    );
    const sink = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    const putRes = await fetch(`${h.baseUrl}/api/servers/alpha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "alpha",
        config: { type: "stdio", command: "new" },
      }),
    });
    expect(putRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 400));
    expect(sink.events).toEqual([]);
    sink.close();
  });

  it("does NOT emit when the backend's own DELETE /api/servers/:id writes the file", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify(
        { mcpServers: { alpha: { type: "stdio", command: "node" } } },
        null,
        2,
      ) + "\n",
    );
    const sink = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    const delRes = await fetch(`${h.baseUrl}/api/servers/alpha`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 400));
    expect(sink.events).toEqual([]);
    sink.close();
  });

  it("emits a broadcast when an external edit slips in between two backend writes (peer-tab visibility)", async () => {
    // This is the race the watcher-handler suppression cannot catch on its
    // own: external editor saves AFTER the backend has read the current
    // mtime but BEFORE chokidar's awaitWriteFinish has fired, so chokidar
    // coalesces the external mtime and our merged-write mtime into one
    // event whose mtime matches our own write — and we'd suppress.
    // `writeMcpAndTrackMtime` covers this by stat()ing on entry and
    // broadcasting itself if the pre-write mtime doesn't match its tracked
    // value, so a second connected subscriber learns about the change.
    writeFileSync(
      h.configPath,
      JSON.stringify(
        { mcpServers: { alpha: { type: "stdio", command: "v1" } } },
        null,
        2,
      ) + "\n",
    );
    // Drive the first write through the backend so lastWrittenMtimeMs is
    // populated with the mtime we expect on disk going into the next write.
    const firstPut = await fetch(`${h.baseUrl}/api/servers/alpha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "alpha",
        config: { type: "stdio", command: "v2" },
      }),
    });
    expect(firstPut.status).toBe(200);

    // Subscribe AFTER the first write so the peer subscriber represents a
    // separate tab opened mid-session.
    const sink = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    // External editor writes the file directly. Need a fresh mtime distinct
    // from the last backend write, so wait a beat (mtime granularity on
    // older filesystems is ms-coarse).
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(
      h.configPath,
      JSON.stringify(
        { mcpServers: { alpha: { type: "stdio", command: "external" } } },
        null,
        2,
      ) + "\n",
    );

    // Backend write follows quickly enough that chokidar's
    // awaitWriteFinish coalesces both events. Without the pre-stat check
    // the peer subscriber would never see this edit.
    const secondPut = await fetch(`${h.baseUrl}/api/servers/alpha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "alpha",
        config: { type: "stdio", command: "v3-merged" },
      }),
    });
    expect(secondPut.status).toBe(200);

    await sink.waitFor(1);
    expect(sink.events.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(sink.events[0]!)).toEqual({ type: "change" });
    sink.close();
  });

  it("emits when the user deletes the config file", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
    );
    const sink = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    expect(existsSync(h.configPath)).toBe(true);
    unlinkSync(h.configPath);

    await sink.waitFor(1);
    expect(sink.events).toHaveLength(1);
    sink.close();
  });

  it("broadcasts to multiple connected subscribers", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
    );
    const sink1 = await subscribe(h.baseUrl);
    const sink2 = await subscribe(h.baseUrl);
    await new Promise((r) => setTimeout(r, 150));

    writeFileSync(
      h.configPath,
      JSON.stringify(
        { mcpServers: { beta: { type: "stdio", command: "node" } } },
        null,
        2,
      ) + "\n",
    );

    await Promise.all([sink1.waitFor(1), sink2.waitFor(1)]);
    expect(sink1.events).toHaveLength(1);
    expect(sink2.events).toHaveLength(1);
    sink1.close();
    sink2.close();
  });
});
