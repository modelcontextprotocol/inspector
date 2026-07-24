/**
 * Tests for useInitialConfig — runs in happy-dom under the unit project. Uses a
 * controlled fake `fetch` so each branch (present / absent / non-string / HTTP
 * error / network throw / post-unmount guards) and the auth header are asserted
 * directly. This is the single hook that replaced useSandboxUrl /
 * useServerListWritable / useInspectorVersion (#1643), so it covers each field's
 * branch matrix in one place.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useInitialConfig } from "@inspector/core/react/useInitialConfig";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
  } as unknown as Response;
}

describe("useInitialConfig", () => {
  it("starts loading, then resolves all three fields from one config payload", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        version: "2.0.0",
        sandboxUrl: "http://localhost:6299/sandbox",
        writable: false,
      }),
    );

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    // Initial (pre-fetch) state: version/sandboxUrl undefined, writable defaults
    // true, loading true.
    expect(result.current.loading).toBe(true);
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
    expect(result.current.writable).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe("2.0.0");
    expect(result.current.sandboxUrl).toBe("http://localhost:6299/sandbox");
    expect(result.current.writable).toBe(false);
    // One static payload, one request.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends the bearer auth header when a token is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));

    renderHook(() =>
      useInitialConfig({
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
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers["x-mcp-remote-auth"]).toBeUndefined();
  });

  it("applies each field's default when the payload omits it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ defaultEnvironment: {} }));

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
    // Missing writable (legacy backend) stays writable.
    expect(result.current.writable).toBe(true);
  });

  it("leaves version/sandboxUrl undefined when the fields are not usable strings", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ version: "", sandboxUrl: "" }));

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
  });

  it("keeps writable true for any non-false value", async () => {
    // A missing/non-boolean writable must not flip the list read-only — only an
    // explicit `false` does.
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ writable: undefined }));

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writable).toBe(true);
  });

  it("applies defaults on a non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { version: "9.9.9", sandboxUrl: "http://x/sb", writable: false },
          false,
        ),
      );

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
    expect(result.current.writable).toBe(true);
  });

  it("applies defaults when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
    expect(result.current.writable).toBe(true);
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", async () => {
    const globalFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        version: "3.1.4",
        sandboxUrl: "http://global/sb",
        writable: false,
      }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(globalFetch).toHaveBeenCalledWith(
        "http://test.local/api/config",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.version).toBe("3.1.4");
      expect(result.current.sandboxUrl).toBe("http://global/sb");
      expect(result.current.writable).toBe(false);
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
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );
    expect(result.current.loading).toBe(true);

    unmount();
    // Resolve after unmount — the post-fetch isCancelled() guard returns early.
    resolveFetch?.(
      jsonResponse({ version: "2.0.0", sandboxUrl: "http://late/sb" }),
    );
    // Let the microtask queue drain so the continuation runs.
    await Promise.resolve();
    await Promise.resolve();
    // No assertion error / React warning means the guards held; every field
    // stayed at its initial value.
    expect(result.current.version).toBeUndefined();
    expect(result.current.sandboxUrl).toBeUndefined();
    expect(result.current.writable).toBe(true);
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
      useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
    );
    // Let the fetch resolve so we're parked awaiting json().
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await Promise.resolve();

    unmount();
    resolveJson?.({ version: "2.0.0", writable: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.version).toBeUndefined();
    expect(result.current.writable).toBe(true);
  });
});
