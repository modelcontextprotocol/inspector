import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  TRACKED_BODY_MAX_BYTES,
  TRUNCATED_BODY_SUFFIX,
  createFetchTracker,
} from "@inspector/core/mcp/fetchTracking.js";

/**
 * The recorded-body cap against a real socket and Node's own `fetch`, whose
 * `Response.clone()` is the tee the tracker relies on. A unit test with a
 * hand-built stream shows the cap; only a real body shows that cutting the
 * tracker's clone off leaves the transport's copy of a POST event stream
 * flowing to its end, with nothing stalled behind the cancelled branch.
 */

// One SSE event per write, ~8 KiB each.
const EVENT = `event: message\ndata: ${JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/progress",
  params: { progressToken: "t", progress: 1, message: "x".repeat(8192) },
})}\n\n`;
const EVENT_BYTES = Buffer.byteLength(EVENT);

let server: http.Server | null = null;

afterEach(async () => {
  const s = server;
  server = null;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
});

/**
 * Serve every request with an SSE body of `events` events (endless when
 * `undefined`), writing at the pace the client reads so the server itself
 * never buffers.
 */
async function serveEventStream(events: number | undefined): Promise<string> {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let sent = 0;
    const write = (): void => {
      while (events === undefined || sent < events) {
        sent += 1;
        if (!res.write(EVENT)) {
          res.once("drain", write);
          return;
        }
      }
      res.end();
    };
    res.on("error", () => {});
    write();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/mcp`;
}

function trackedFetch() {
  const bodies: string[] = [];
  const fetcher = createFetchTracker(fetch, {
    updateResponseBody: (_id, body) => bodies.push(body),
  });
  return { fetcher, bodies };
}

async function waitFor(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((r) => setTimeout(r, 10));
}

describe("createFetchTracker recorded-body cap over a real socket", () => {
  it("records a bounded prefix of an endless POST event stream while the caller keeps reading it", async () => {
    const url = await serveEventStream(undefined);
    const { fetcher, bodies } = trackedFetch();

    const res = await fetcher(url, { method: "POST", body: "{}" });
    const reader = res.body!.getReader();
    // Read well past the cap on the caller's copy, as the transport would.
    let read = 0;
    while (read < TRACKED_BODY_MAX_BYTES * 4) {
      const next = await reader.read();
      expect(next.done).toBe(false);
      read += next.value!.byteLength;
    }
    await waitFor(() => bodies.length > 0);
    await reader.cancel();

    expect(bodies).toHaveLength(1);
    const recorded = bodies[0]!;
    expect(recorded.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(true);
    expect(recorded.length - TRUNCATED_BODY_SUFFIX.length).toBe(
      TRACKED_BODY_MAX_BYTES,
    );
    expect(recorded.startsWith(EVENT)).toBe(true);
  });

  it("delivers an over-cap POST event stream to the caller whole and in order", async () => {
    const events = Math.ceil((TRACKED_BODY_MAX_BYTES * 3) / EVENT_BYTES);
    const url = await serveEventStream(events);
    const { fetcher, bodies } = trackedFetch();

    const res = await fetcher(url, { method: "POST", body: "{}" });
    const text = await res.text();

    expect(text).toBe(EVENT.repeat(events));
    await waitFor(() => bodies.length > 0);
    expect(bodies[0]!.length - TRUNCATED_BODY_SUFFIX.length).toBe(
      TRACKED_BODY_MAX_BYTES,
    );
    expect(bodies[0]!.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(true);
  });

  it("records a normal POST event stream intact", async () => {
    const url = await serveEventStream(3);
    const { fetcher, bodies } = trackedFetch();

    const res = await fetcher(url, { method: "POST", body: "{}" });
    const text = await res.text();

    await waitFor(() => bodies.length > 0);
    expect(text).toBe(EVENT.repeat(3));
    expect(bodies).toEqual([EVENT.repeat(3)]);
  });
});
