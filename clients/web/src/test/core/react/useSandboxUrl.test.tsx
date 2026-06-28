/**
 * Tests for useSandboxUrl — runs in happy-dom under the unit project. Uses a
 * controlled fake `fetch` so each branch (present / absent / non-string / HTTP
 * error / network throw) and the auth header are asserted directly.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSandboxUrl } from "@inspector/core/react/useSandboxUrl";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  } as unknown as Response;
}

describe("useSandboxUrl", () => {
  it("starts loading, then resolves the sandboxUrl from the config payload", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sandboxUrl: "http://localhost:6299/sandbox" }),
      );

    const { result } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.sandboxUrl).toBeUndefined();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sandboxUrl).toBe("http://localhost:6299/sandbox");
  });

  it("sends the bearer auth header when a token is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));

    renderHook(() =>
      useSandboxUrl({
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

    renderHook(() => useSandboxUrl({ baseUrl: "http://test.local", fetchFn }));

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers["x-mcp-remote-auth"]).toBeUndefined();
  });

  it("leaves sandboxUrl undefined when the payload omits it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ defaultEnvironment: {} }));

    const { result } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("leaves sandboxUrl undefined when the field is not a usable string", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ sandboxUrl: "" }));

    const { result } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("leaves sandboxUrl undefined on a non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sandboxUrl: "x" }, false));

    const { result } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("leaves sandboxUrl undefined when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sandboxUrl: "http://global/sb" }));
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const { result } = renderHook(() =>
        useSandboxUrl({ baseUrl: "http://test.local" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(globalFetch).toHaveBeenCalledWith(
        "http://test.local/api/config",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.sandboxUrl).toBe("http://global/sb");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops a response that resolves after unmount (no state update)", async () => {
    // Gate the fetch so it is still in flight when we unmount; the
    // isCancelled() guards (after fetch, after json, and in finally) must all
    // short-circuit so no setState runs on the dead component.
    let resolveFetch: ((r: Response) => void) | undefined;
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );

    const { result, unmount } = renderHook(() =>
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );
    expect(result.current.loading).toBe(true);

    unmount();
    // Resolve after unmount — the post-fetch isCancelled() guard returns early.
    resolveFetch?.(jsonResponse({ sandboxUrl: "http://late/sb" }));
    // Let the microtask queue drain so the continuation runs.
    await Promise.resolve();
    await Promise.resolve();
    // No assertion error / React warning means the guards held; the last
    // observed value stayed at its initial undefined.
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("drops a response whose json resolves after unmount", async () => {
    // Fetch resolves before unmount but the json() body resolves after, so the
    // second isCancelled() guard (post-json) is the one that short-circuits.
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
      useSandboxUrl({ baseUrl: "http://test.local", fetchFn }),
    );
    // Let the fetch resolve so we're parked awaiting json().
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await Promise.resolve();

    unmount();
    resolveJson?.({ sandboxUrl: "http://late/sb" });
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.sandboxUrl).toBeUndefined();
  });
});
