import { describe, it, expect, vi } from "vitest";
import { createRemoteLogger } from "@inspector/core/mcp/remote/createRemoteLogger.js";

describe("createRemoteLogger", () => {
  it("transmits log events to /api/log with the configured auth header", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 204 }));
    const logger = createRemoteLogger({
      baseUrl: "http://example.com/",
      authToken: "secret",
      fetchFn: fetchFn as unknown as typeof fetch,
      level: "info",
    });

    logger.info({ msg: "hello" });

    // pino transmit is synchronous but the fetch is fire-and-forget — wait a
    // tick so the promise resolves and the call records.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://example.com/api/log");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect((init?.headers as Record<string, string>)["x-mcp-remote-auth"]).toBe(
      "Bearer secret",
    );
  });

  it("omits the auth header when no token is provided and uses default level", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const logger = createRemoteLogger({
      baseUrl: "http://example.com",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    logger.info({ msg: "no auth" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0]?.[1];
    expect(
      (init?.headers as Record<string, string>)["x-mcp-remote-auth"],
    ).toBeUndefined();
  });

  it("silently swallows fetch rejections so logging never throws", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network"));
    const logger = createRemoteLogger({
      baseUrl: "http://example.com",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(() => logger.info({ msg: "boom" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const logger = createRemoteLogger({ baseUrl: "http://example.com" });
      logger.info({ msg: "ping" });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchMock).toHaveBeenCalled();
  });
});
