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
});
