/**
 * Tests for useServerListWritable — runs in happy-dom under the unit project.
 * Uses a controlled fake `fetch` so each branch (writable / read-only / absent
 * field / HTTP error / network throw) and the auth header are asserted directly.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useServerListWritable } from "@inspector/core/react/useServerListWritable";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  } as unknown as Response;
}

describe("useServerListWritable", () => {
  it("defaults to writable while loading, then keeps true for a writable session", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ writable: true }));

    const { result } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.writable).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(true);
  });

  it("resolves writable:false for a read-only session", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ writable: false }));

    const { result } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(false);
  });

  it("stays writable when the field is absent (legacy backend)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(true);
  });

  it("sends the bearer auth header when a token is provided", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ writable: false }));

    renderHook(() =>
      useServerListWritable({
        baseUrl: "http://test.local/",
        authToken: "secret-token",
        fetchFn,
      }),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    // Trailing slash on baseUrl is trimmed.
    expect(url).toBe("http://test.local/api/config");
    expect((init.headers as Record<string, string>)["x-mcp-remote-auth"]).toBe(
      "Bearer secret-token",
    );
  });

  it("stays writable on an HTTP error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ writable: false }, false));

    const { result } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );

    // An !ok response is ignored (the body is never read), so the writable
    // default survives even though loading still settles via `finally`.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(true);
  });

  it("stays writable when fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(true);
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ writable: false }));
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const { result } = renderHook(() =>
        useServerListWritable({ baseUrl: "http://test.local" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(globalFetch).toHaveBeenCalledWith(
        "http://test.local/api/config",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.writable).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops a response that resolves after unmount (no state update)", async () => {
    // Gate the fetch so it is still in flight at unmount; the isCancelled()
    // guards (after fetch and in finally) short-circuit so no setState runs on
    // the dead component and `loading` is never flipped.
    let resolveFetch: ((r: Response) => void) | undefined;
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );

    const { result, unmount } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );
    expect(result.current.loading).toBe(true);

    unmount();
    resolveFetch?.(jsonResponse({ writable: false }));
    await Promise.resolve();
    await Promise.resolve();
    // Guards held: the post-unmount value stayed at the writable default.
    expect(result.current.writable).toBe(true);
  });

  it("drops a response whose json resolves after unmount", async () => {
    // Fetch resolves before unmount but json() resolves after, exercising the
    // second isCancelled() guard (post-json).
    let resolveJson: ((v: unknown) => void) | undefined;
    const res = {
      ok: true,
      status: 200,
      json: () =>
        new Promise((r) => {
          resolveJson = r;
        }),
    } as unknown as Response;
    const fetchFn = vi.fn().mockResolvedValue(res);

    const { result, unmount } = renderHook(() =>
      useServerListWritable({ baseUrl: "http://test.local", fetchFn }),
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await Promise.resolve();

    unmount();
    resolveJson?.({ writable: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.writable).toBe(true);
  });
});
