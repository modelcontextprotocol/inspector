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

  // Only an explicit `false` flips the list read-only. A nonconforming backend
  // could send a falsy-but-not-false value (null / 0 / a string); each is
  // `!== false`, so each must leave the list writable.
  it.each([null, 0, "no"])(
    "keeps writable true for writable=%j (falsy but not false)",
    async (value) => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse({ writable: value }));

      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.writable).toBe(true);
    },
  );

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
    // This test exists to exercise the post-unmount `isCancelled()` guard
    // branches; it can't detect their removal (React 18 dropped the
    // setState-after-unmount warning, and `result.current` is frozen at the last
    // render), so it only asserts the fields stayed at their initial values.
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

  describe("secretStorage (#1950)", () => {
    // The footer under a secret field reads this, so the hook's job is to hand
    // back only a descriptor it can vouch for. Every rejected shape must land
    // on `undefined` — which the footer renders as nothing — rather than on a
    // half-populated object that would render a confident wrong answer.
    it("passes through a well-formed descriptor", async () => {
      const info = {
        kind: "file",
        reason: "fallback",
        durable: true,
        plaintext: true,
        path: "/home/node/.mcp-inspector/secrets.json",
      };
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secretStorage: info }));

      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.secretStorage).toEqual(info);
    });

    it("passes through the optional file fields when they are well-typed", async () => {
      const info = {
        kind: "file",
        reason: "fallback",
        durable: true,
        plaintext: true,
        path: "/home/node/.mcp-inspector/secrets.json",
        pendingEncryption: true,
        looseMode: 0o644,
        permissionsUnknown: "EACCES",
      };
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secretStorage: info }));
      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.secretStorage).toEqual(info);
    });

    it("passes through a descriptor that reports an unreadable file", async () => {
      // `plaintext` is legitimately absent here; the guard must accept that
      // shape rather than requiring a field the backend cannot honestly set.
      const info = {
        kind: "file",
        reason: "fallback",
        durable: true,
        path: "/home/node/.mcp-inspector/secrets.json",
        encryptionUnknown: "not valid JSON",
      };
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secretStorage: info }));
      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.secretStorage).toEqual(info);
    });

    it("is undefined on a backend that omits the field", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.secretStorage).toBeUndefined();
    });

    it.each([
      ["a non-object", "keyring"],
      ["null", null],
      ["an unknown kind", { kind: "vault", durable: true }],
      ["a missing kind", { durable: true, path: "/x" }],
      // The dangerous one: `kind` alone passed the old check, and a missing
      // `plaintext` is falsy, so it rendered as the quiet *encrypted* file —
      // the most misleading thing this footer can say, produced by the absence
      // of information rather than by anything the backend claimed.
      ["a file descriptor with nothing but a kind", { kind: "file" }],
      [
        "a file descriptor missing its path",
        { kind: "file", reason: "fallback", durable: true, plaintext: false },
      ],
      [
        "a file descriptor missing plaintext",
        { kind: "file", reason: "fallback", durable: true, path: "/x" },
      ],
      [
        "a descriptor with an unknown reason",
        { kind: "keyring", reason: "vibes", durable: true },
      ],
      [
        "a descriptor with a non-boolean durable",
        { kind: "memory", reason: "fallback", durable: "no" },
      ],
      [
        // The truthy-string trap: the footer would read this as "already
        // re-encrypting" and print advice that is the opposite of the truth.
        "a stringly-typed pendingEncryption",
        {
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/x",
          pendingEncryption: "false",
        },
      ],
      [
        "a non-numeric looseMode",
        {
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/x",
          looseMode: "644",
        },
      ],
      [
        // Neither half of the encryption question answered.
        "a file descriptor with neither plaintext nor encryptionUnknown",
        { kind: "file", reason: "fallback", durable: true, path: "/x" },
      ],
      [
        // Both answered, which is contradictory — the state was either read
        // or it wasn't.
        "a file descriptor with both plaintext and encryptionUnknown",
        {
          kind: "file",
          reason: "fallback",
          durable: true,
          path: "/x",
          plaintext: true,
          encryptionUnknown: "not valid JSON",
        },
      ],
      [
        "encryptionUnknown on a memory descriptor",
        {
          kind: "memory",
          reason: "fallback",
          durable: false,
          encryptionUnknown: "not valid JSON",
        },
      ],
      [
        "a non-string permissionsUnknown",
        {
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/x",
          permissionsUnknown: true,
        },
      ],
      [
        // Each file-only field is rejected on its own, so no single one can
        // slip through on the back of the others being absent.
        "permissionsUnknown on a keyring descriptor",
        {
          kind: "keyring",
          reason: "default",
          durable: true,
          permissionsUnknown: "EACCES",
        },
      ],
      [
        "looseMode on a keyring descriptor",
        { kind: "keyring", reason: "default", durable: true, looseMode: 0o644 },
      ],
      [
        "pendingEncryption on a memory descriptor",
        {
          kind: "memory",
          reason: "fallback",
          durable: false,
          pendingEncryption: true,
        },
      ],
      [
        "a path on a memory descriptor",
        {
          kind: "memory",
          reason: "fallback",
          durable: false,
          path: "/x/secrets.json",
        },
      ],
      [
        // File-only fields on a non-file kind mean the payload was not built
        // by a backend we understand; rendering a mixture of two stores'
        // answers is worse than rendering nothing.
        "file fields on a memory descriptor",
        {
          kind: "memory",
          reason: "fallback",
          durable: false,
          plaintext: true,
        },
      ],
    ])("rejects %s", async (_label, value) => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(jsonResponse({ secretStorage: value }));
      const { result } = renderHook(() =>
        useInitialConfig({ baseUrl: "http://test.local", fetchFn }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.secretStorage).toBeUndefined();
    });
  });
});
