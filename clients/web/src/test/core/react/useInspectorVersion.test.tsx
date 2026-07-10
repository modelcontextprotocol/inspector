/**
 * Tests for useInspectorVersion — runs in happy-dom under the unit project. Uses
 * a controlled fake `fetch` so each branch (present / absent / non-string / HTTP
 * error / network throw / post-unmount guards) and the auth header are asserted
 * directly. Mirrors useSandboxUrl's test (same `/api/config` fetch shape).
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useInspectorVersion } from "@inspector/core/react/useInspectorVersion";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  } as unknown as Response;
}

describe("useInspectorVersion", () => {
  it("starts loading, then resolves the version from the config payload", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ version: "2.0.0" }));

    const { result } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.version).toBeUndefined();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe("2.0.0");
  });

  it("sends the bearer auth header when a token is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));

    renderHook(() =>
      useInspectorVersion({
        baseUrl: "http://test.local/",
        authToken: "secret-token",
        fetchFn,
      }),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0];
    // Trailing slash on baseUrl is normalized away.
    expect(url).toBe("http://test.local/api/config");
    expect(init.method).toBe("GET");
    expect(init.headers["x-mcp-remote-auth"]).toBe("Bearer secret-token");
  });

  it("omits the auth header when no token is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));

    renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers["x-mcp-remote-auth"]).toBeUndefined();
  });

  it("leaves version undefined when the payload omits it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ defaultEnvironment: {} }));

    const { result } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
  });

  it("leaves version undefined when the field is not a usable string", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ version: "" }));

    const { result } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
  });

  it("leaves version undefined on a non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ version: "9.9.9" }, false));

    const { result } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
  });

  it("leaves version undefined when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ version: "3.1.4" }));
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const { result } = renderHook(() =>
        useInspectorVersion({ baseUrl: "http://test.local" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(globalFetch).toHaveBeenCalledWith(
        "http://test.local/api/config",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.version).toBe("3.1.4");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops a response that resolves after unmount (no state update)", async () => {
    let resolveFetch: ((r: Response) => void) | undefined;
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );

    const { result, unmount } = renderHook(() =>
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );
    expect(result.current.loading).toBe(true);

    unmount();
    resolveFetch?.(jsonResponse({ version: "2.0.0" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.version).toBeUndefined();
  });

  it("drops a response whose json resolves after unmount", async () => {
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
      useInspectorVersion({ baseUrl: "http://test.local", fetchFn }),
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await Promise.resolve();

    unmount();
    resolveJson?.({ version: "2.0.0" });
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.version).toBeUndefined();
  });
});
