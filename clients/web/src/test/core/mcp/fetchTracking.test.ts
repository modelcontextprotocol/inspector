import { describe, it, expect, vi } from "vitest";
import { createFetchTracker } from "@inspector/core/mcp/fetchTracking.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";

describe("createFetchTracker", () => {
  it("tracks a successful GET request with response body", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("hello", {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    const res = await fetcher("https://example.com/data");
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.method).toBe("GET");
    expect(tracked[0]?.url).toBe("https://example.com/data");
    expect(tracked[0]?.responseBody).toBe("hello");
    expect(tracked[0]?.responseStatus).toBe(200);
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

  it("skips body reading on event-stream responses", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("ignored", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await fetcher("https://example.com/events");
    expect(tracked[0]?.responseBody).toBeUndefined();
  });

  it("skips body reading for POST /mcp streamable responses", async () => {
    const baseFetch = vi.fn(async () => new Response("streamed"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await fetcher("https://example.com/mcp", { method: "POST" });
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

  it("falls back to undefined when response.clone() throws", async () => {
    const tracked: FetchRequestEntryBase[] = [];
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
    });
    await fetcher("https://example.com/data");
    expect(tracked[0]?.responseBody).toBeUndefined();
  });
});
