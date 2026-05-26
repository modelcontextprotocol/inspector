import { describe, it, expect, vi } from "vitest";
import { createFetchTracker } from "@inspector/core/mcp/fetchTracking.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";

// The tracker fires `trackRequest` synchronously with an entry whose
// responseBody is always undefined, then reads the body in the background
// and calls `updateResponseBody(id, body)` when done. This helper waits a
// microtask so the background read can complete before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createFetchTracker", () => {
  it("tracks a successful GET request and emits the response body asynchronously", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("hello", {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });

    const res = await fetcher("https://example.com/data");
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.method).toBe("GET");
    expect(tracked[0]?.url).toBe("https://example.com/data");
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(tracked[0]?.responseStatus).toBe(200);

    await flush();
    expect(bodies).toEqual([{ id: tracked[0]!.id, body: "hello" }]);
  });

  it("accepts URL objects and Request instances as input", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await fetcher(new URL("https://example.com/foo"));
    await fetcher(
      new Request("https://example.com/bar", {
        method: "POST",
        body: "hello",
        headers: { "x-custom": "yes" },
      }),
    );
    expect(tracked).toHaveLength(2);
    expect(tracked[0]?.url).toBe("https://example.com/foo");
    expect(tracked[1]?.url).toBe("https://example.com/bar");
    expect(tracked[1]?.requestHeaders["x-custom"]).toBe("yes");
    expect(tracked[1]?.requestBody).toBe("hello");
  });

  it("falls back to String() for non-string init bodies and yields undefined when conversion throws", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    const throwingBody = {
      toString() {
        throw new Error("not coercible");
      },
    };
    await fetcher("https://example.com/x", {
      method: "POST",
      body: throwingBody as unknown as BodyInit,
    });
    expect(tracked[0]?.requestBody).toBeUndefined();
  });

  it("captures the error path when baseFetch throws", async () => {
    const baseFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await expect(
      fetcher("https://example.com/fail", { method: "POST" }),
    ).rejects.toThrow("network down");
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.error).toBe("network down");
    expect(tracked[0]?.responseStatus).toBeUndefined();
  });

  it("captures the error path when baseFetch throws a non-Error", async () => {
    const baseFetch = vi.fn(async () => {
      throw "stringly-typed";
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await expect(fetcher("https://example.com/fail")).rejects.toBe(
      "stringly-typed",
    );
    expect(tracked[0]?.error).toBe("stringly-typed");
  });

  it("skips body reading on GET event-stream responses (long-lived stream)", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("ignored", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/events", { method: "GET" });
    await flush();
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });

  it("skips body reading on GET application/x-ndjson responses", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("ignored", {
          headers: { "content-type": "application/x-ndjson" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/events", { method: "GET" });
    await flush();
    expect(bodies).toHaveLength(0);
  });

  it("emits the body for a POST event-stream response after the stream closes (bounded)", async () => {
    // Streamable HTTP POST /mcp answers with SSE that closes after the
    // reply. The tracker must NOT block on this read — the transport
    // needs to consume the stream first to drive progress notifications.
    // Body therefore arrives asynchronously via updateResponseBody.
    const sse =
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
    const baseFetch = vi.fn(
      async () =>
        new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/mcp", { method: "POST" });
    expect(tracked[0]?.responseBody).toBeUndefined();
    await flush();
    expect(bodies).toEqual([{ id: tracked[0]!.id, body: sse }]);
  });

  it("emits the body for a POST /mcp JSON response asynchronously", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/mcp", { method: "POST" });
    expect(tracked[0]?.responseBody).toBeUndefined();
    await flush();
    expect(bodies).toEqual([
      {
        id: tracked[0]!.id,
        body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
      },
    ]);
  });

  it("does not block the caller awaiting the response body", async () => {
    // If the body promise hangs forever (simulating a long-lived stream
    // mid-flight), the tracker still has to resolve the outer fetcher
    // promise immediately. Otherwise the transport blocks waiting on us.
    const neverEnding = new ReadableStream({
      start() {
        // Never enqueue, never close — `.text()` on a clone of this would hang.
      },
    });
    const baseFetch = vi.fn(
      async () => new Response(neverEnding, { status: 200 }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    const res = await fetcher("https://example.com/slow", { method: "POST" });
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.responseBody).toBeUndefined();
  });

  it("survives a Request whose body cannot be cloned/read", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    const req = new Request("https://example.com/post", {
      method: "POST",
      body: "payload",
    });
    // Force clone() to throw, exercising the inner catch
    Object.defineProperty(req, "clone", {
      value: () => {
        throw new Error("clone failed");
      },
    });
    await fetcher(req);
    expect(tracked[0]?.requestBody).toBeUndefined();
  });

  it("does not call updateResponseBody when response.clone() throws", async () => {
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const baseFetch = vi.fn(async () => {
      const r = new Response("body");
      Object.defineProperty(r, "clone", {
        value: () => {
          throw new Error("nope");
        },
      });
      return r;
    });
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/data");
    await flush();
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });
});
