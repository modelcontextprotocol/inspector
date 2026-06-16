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
});
