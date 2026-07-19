/**
 * Tests for useServers — runs in happy-dom under the unit project, but
 * exercises a real `createRemoteApp` Hono instance via `app.fetch` (no TCP,
 * no port juggling) backed by a per-test tmp `mcp.json`. The route handlers
 * and on-disk persistence are exercised end-to-end alongside the React hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useServers } from "@inspector/core/react/useServers";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server";
import { DEFAULT_SEED_CONFIG } from "@inspector/core/mcp/serverList";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store";
import type { MCPConfig } from "@inspector/core/mcp/types";

interface Harness {
  fetchFn: typeof fetch;
  configPath: string;
  tempDir: string;
  closeApi: () => Promise<void>;
}

function setupHarness(): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-useServers-"));
  const configPath = join(tempDir, "mcp.json");
  const { app, close: closeApi } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
    // Inject an in-memory secret store so the test never touches the
    // developer's real OS keychain (and so the suite passes on Linux CI
    // runners without libsecret).
    secretStore: new InMemorySecretStore(),
  });
  // Wrap so the typing matches Web fetch — Hono's app.fetch expects a Request
  // (not a URL string), so build one from string/URL inputs before dispatch.
  const fetchFn: typeof fetch = async (input, init) => {
    const req =
      input instanceof Request
        ? input
        : new Request(input as string | URL, init);
    return app.fetch(req) as Promise<Response>;
  };
  return { fetchFn, configPath, tempDir, closeApi };
}

async function teardownHarness(h: Harness): Promise<void> {
  // Closing here releases the lazy chokidar watcher started by the SSE
  // subscription useServers opens on mount. Without it the watcher would
  // hang around for the lifetime of the vitest worker — harmless for the
  // suite as a whole, but it would slow worker exit and could leak inotify
  // watches on Linux.
  await h.closeApi();
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readConfig(path: string): MCPConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as MCPConfig;
}

describe("useServers", () => {
  let h: Harness;

  beforeEach(() => {
    h = setupHarness();
  });

  afterEach(async () => {
    await teardownHarness(h);
  });

  it("starts in loading state, then loads and converts the seed config", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.servers).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const ids = result.current.servers.map((s) => s.id);
    expect(ids).toEqual([
      "filesystem-server-default",
      "everything-server-default",
    ]);
    // Map key is used as both id and name; connection initializes disconnected
    for (const s of result.current.servers) {
      expect(s.name).toBe(s.id);
      expect(s.connection).toEqual({ status: "disconnected" });
    }
    expect(result.current.error).toBeUndefined();
  });

  it("addServer persists and refreshes the list", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addServer("alpha", {
        type: "stdio",
        command: "node",
      });
    });

    await waitFor(() => {
      expect(result.current.servers.some((s) => s.id === "alpha")).toBe(true);
    });
    expect(readConfig(h.configPath).mcpServers.alpha).toEqual({
      type: "stdio",
      command: "node",
    });
  });

  it("importSource returns a result for a known source type", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await result.current.importSource("cursor");
    expect(res.type).toBe("cursor");
    expect(typeof res.found).toBe("boolean");
    expect(Array.isArray(res.searched)).toBe(true);
  });

  it("importSource throws on an unknown source type", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.importSource("bogus")).rejects.toThrow(
      /Unknown import source/,
    );
  });

  it("addServer throws on 409 (duplicate id)", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addServer("alpha", {
        type: "stdio",
        command: "node",
      });
    });

    await expect(
      act(async () => {
        await result.current.addServer("alpha", {
          type: "stdio",
          command: "other",
        });
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("updateServer renames a key and updates config", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { alpha: { type: "stdio", command: "old" } },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateServer("alpha", "alpha-renamed", {
        type: "stdio",
        command: "new",
      });
    });

    await waitFor(() => {
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha-renamed",
      ]);
    });
    const cfg = readConfig(h.configPath);
    expect(cfg.mcpServers).not.toHaveProperty("alpha");
    expect(cfg.mcpServers["alpha-renamed"]).toEqual({
      type: "stdio",
      command: "new",
    });
  });

  it("removeServer drops the entry and refreshes", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "node" },
          beta: { type: "stdio", command: "node" },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]),
    );

    await act(async () => {
      await result.current.removeServer("alpha");
    });

    await waitFor(() => {
      expect(result.current.servers.map((s) => s.id)).toEqual(["beta"]);
    });
  });

  it("refresh() re-reads from disk when the file changes externally", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // External edit (simulates the user editing mcp.json by hand)
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { hand: { type: "stdio", command: "hand-edited" } },
      }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.servers.map((s) => s.id)).toEqual(["hand"]);
  });

  it("auto-refreshes when the /api/servers/events SSE channel signals a change", async () => {
    // Mount the hook (which also opens the SSE subscription) and let the
    // initial GET settle so we're observing a steady state before mutating
    // the file.
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Give chokidar a beat to register with the now-seeded file. The lazy
    // watcher inside createRemoteApp starts on the first SSE subscriber, so
    // by the time the initial GET resolves the watcher is already attached.
    // The pause covers any platform-specific scan-stabilization window
    // before we mutate.
    await new Promise((r) => setTimeout(r, 200));

    // Simulate an external editor save. The watcher fires → SSE broadcasts
    // → the hook's reader-loop calls refresh() without us touching the
    // exposed refresh() API.
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { external: { type: "stdio", command: "outside" } },
      }) + "\n",
    );

    await waitFor(
      () => {
        expect(result.current.servers.map((s) => s.id)).toEqual(["external"]);
      },
      { timeout: 3000 },
    );
  });

  it("SSE-driven refresh does not flip loading back to true (no skeleton flicker)", async () => {
    // Regression guard for the background-refresh split: a consumer
    // rendering a loading spinner / skeleton must not see `loading` go
    // true on every external mcp.json edit. The hook's SSE handler calls
    // refreshInternal(true), which skips the setLoading toggles entirely;
    // sampling a single point can miss the bug under React batching, so
    // record every observed `loading` value across the SSE cycle and
    // assert none of them is true.
    const loadingHistory: boolean[] = [];
    const { result } = renderHook(() => {
      const r = useServers({
        baseUrl: "http://test.local",
        fetchFn: h.fetchFn,
      });
      loadingHistory.push(r.loading);
      return r;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Slice off the mount-phase renders; only renders after the initial
    // load are subject to the no-flicker contract.
    const baselineLen = loadingHistory.length;

    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { flicker: { type: "stdio", command: "outside" } },
      }) + "\n",
    );

    await waitFor(
      () => {
        expect(result.current.servers.map((s) => s.id)).toEqual(["flicker"]);
      },
      { timeout: 3000 },
    );

    const postRefreshLoadings = loadingHistory.slice(baselineLen);
    expect(postRefreshLoadings.length).toBeGreaterThan(0);
    expect(postRefreshLoadings.every((v) => v === false)).toBe(true);
  });

  it("captures the error message on fetch network failure", async () => {
    const failingFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: failingFetch as typeof fetch,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.servers).toEqual([]);
  });

  it("captures the error message on HTTP 500 from the backend", async () => {
    const failingFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "disk full" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: failingFetch as typeof fetch,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("disk full");
  });

  it("falls back to HTTP status when the error body has no `error` field", async () => {
    const failingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("oops", { status: 502 }));
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: failingFetch as typeof fetch,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("HTTP 502");
  });

  it("sends the x-mcp-remote-auth header when authToken is provided", async () => {
    const seenHeaders: Headers[] = [];
    const sniffingFetch: typeof fetch = async (input, init) => {
      seenHeaders.push(new Headers(init?.headers));
      return h.fetchFn(input, init);
    };
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        authToken: "secret",
        fetchFn: sniffingFetch,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seenHeaders[0]?.get("x-mcp-remote-auth")).toBe("Bearer secret");
  });

  it("updateServerSettings persists the new settings node without touching config", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "streamable-http", url: "https://x.test/mcp" },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateServerSettings("alpha", {
        headers: [{ key: "X-Tenant", value: "acme" }],
        env: [],
        metadata: [{ key: "trace", value: "abc" }],
        connectionTimeout: 5000,
        requestTimeout: 30000,
        taskTtl: 30000,
        maxFetchRequests: 1000,
        roots: [],
      });
    });

    await waitFor(() => {
      expect(result.current.servers[0]?.settings).toEqual({
        headers: [{ key: "X-Tenant", value: "acme" }],
        env: [],
        metadata: [{ key: "trace", value: "abc" }],
        connectionTimeout: 5000,
        requestTimeout: 30000,
        taskTtl: 30000,
        maxFetchRequests: 1000,
        autoRefreshOnListChanged: false,
        singlePageLists: false,
        roots: [],
      });
    });
    const stored = readConfig(h.configPath).mcpServers
      .alpha as unknown as Record<string, unknown>;
    // Post-#1358: settings round-trip onto top-level keys on disk, no
    // nested `settings` wrapper. Each non-zero/non-empty field surfaces
    // as a sibling of `type` / `url`.
    expect(stored.type).toBe("streamable-http");
    expect(stored.url).toBe("https://x.test/mcp");
    expect(stored).not.toHaveProperty("settings");
    expect(stored.headers).toEqual({ "X-Tenant": "acme" });
    expect(stored.metadata).toEqual([{ key: "trace", value: "abc" }]);
    expect(stored.connectionTimeout).toBe(5000);
    expect(stored.requestTimeout).toBe(30000);
    expect(stored.taskTtl).toBe(30000);
  });

  it("updateServerSettings throws when the target id does not exist (server-side 404)", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateServerSettings("nonexistent", {
          headers: [],
          env: [],
          metadata: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
        });
      }),
    ).rejects.toThrow(/not found/);
  });

  it("updateServer preserves the existing settings node across a config update", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: {
            type: "streamable-http",
            url: "https://x.test/mcp",
            // Post-#1358 flat shape on disk; the hook lifts `headers` into
            // the pair-array `settings.headers` it exposes.
            headers: { "X-Keep": "yes" },
          },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      // ServerConfigModal saves do not touch settings; updateServer must not
      // drop them, otherwise the user loses persisted headers / metadata when
      // they tweak the URL.
      await result.current.updateServer("alpha", "alpha", {
        type: "streamable-http",
        url: "https://x.test/other",
      });
    });

    await waitFor(() => {
      expect(result.current.servers[0]?.config).toMatchObject({
        url: "https://x.test/other",
      });
    });
    expect(result.current.servers[0]?.settings).toEqual({
      headers: [{ key: "X-Keep", value: "yes" }],
      env: [],
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
      // Absent taskTtl on disk reads back as the product default for the form.
      taskTtl: 60000,
      maxFetchRequests: 1000,
      // Absent autoRefreshOnListChanged on disk reads back as false.
      autoRefreshOnListChanged: false,
      singlePageLists: false,
      // Absent roots on disk reads back as an empty list for the form.
      roots: [],
    });
  });

  it("reorderServers persists the new order to disk and updates the list", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "a" },
          beta: { type: "stdio", command: "b" },
          gamma: { type: "stdio", command: "g" },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]),
    );

    await act(async () => {
      await result.current.reorderServers(["gamma", "alpha", "beta"]);
    });

    await waitFor(() => {
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "gamma",
        "alpha",
        "beta",
      ]);
    });
    // mcp.json map iteration order reflects the new order.
    expect(Object.keys(readConfig(h.configPath).mcpServers)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("reorderServers updates the list optimistically before the round-trip resolves", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "a" },
          beta: { type: "stdio", command: "b" },
        },
      }),
    );

    let resolvePut: (() => void) | undefined;
    const gatedFetch: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === "PUT" && url.endsWith("/api/servers/order")) {
        // Hold the PUT response open so we can observe the optimistic state
        // that must already be applied before the network settles.
        await new Promise<void>((r) => {
          resolvePut = r;
        });
      }
      return h.fetchFn(input, init);
    };

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: gatedFetch }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]),
    );

    let pending: Promise<void>;
    act(() => {
      pending = result.current.reorderServers(["beta", "alpha"]);
    });

    // Optimistic reorder is visible while the PUT is still in flight.
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "beta",
        "alpha",
      ]),
    );

    await act(async () => {
      resolvePut?.();
      await pending;
    });
  });

  it("reorderServers reverts to disk truth and throws when the set no longer matches (409)", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "a" },
          beta: { type: "stdio", command: "b" },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]),
    );

    // Incomplete set (missing `beta`) — the backend rejects with 409 and the
    // hook re-fetches, snapping the list back to the on-disk order.
    await expect(
      act(async () => {
        await result.current.reorderServers(["alpha"]);
      }),
    ).rejects.toThrow(/does not match/);

    await waitFor(() => {
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]);
    });
    expect(Object.keys(readConfig(h.configPath).mcpServers)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("updateServer throws the backend error message on a non-ok response", async () => {
    // Drive the mutator through a fetchFn that serves the initial GET from the
    // real app but fails the PUT, so the updateServer !res.ok throw path runs.
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (init?.method === "PUT") {
            return new Response(JSON.stringify({ error: "put blew up" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateServer("alpha", "alpha", {
          type: "stdio",
          command: "node",
        });
      }),
    ).rejects.toThrow("put blew up");
  });

  it("removeServer throws the backend error message on a non-ok response", async () => {
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (init?.method === "DELETE") {
            return new Response(JSON.stringify({ error: "delete blew up" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.removeServer("filesystem-server-default");
      }),
    ).rejects.toThrow("delete blew up");
  });

  it("importSource throws the backend error message on a non-ok response", async () => {
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/api/import-source")) {
            return new Response(JSON.stringify({ error: "import blew up" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.importSource("cursor")).rejects.toThrow(
      "import blew up",
    );
  });

  it("reorderServers rethrows a non-Error rejection wrapped as an Error", async () => {
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "a" },
          beta: { type: "stdio", command: "b" },
        },
      }),
    );

    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (init?.method === "PUT" && url.endsWith("/api/servers/order")) {
            // Reject with a non-Error so the `err instanceof Error` false
            // branch (wrap-as-Error) is taken.
            return Promise.reject("string failure");
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]),
    );

    await expect(
      act(async () => {
        await result.current.reorderServers(["beta", "alpha"]);
      }),
    ).rejects.toThrow("string failure");

    // Reverted to disk truth after the failed round-trip.
    await waitFor(() => {
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]);
    });
  });

  it("reorderServers keeps stray entries the requested order omitted", async () => {
    // Defensive stray-keep branch: pass an order that drops `beta`. The
    // optimistic setter appends the un-listed entry at the end so nothing
    // vanishes before the failed-reorder refresh reconciles. The PUT 409s
    // (incomplete set), so the list reverts — but the optimistic stray-keep
    // ran first, which is the branch under test.
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: {
          alpha: { type: "stdio", command: "a" },
          beta: { type: "stdio", command: "b" },
        },
      }),
    );

    let resolvePut: (() => void) | undefined;
    const observed: string[][] = [];
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (init?.method === "PUT" && url.endsWith("/api/servers/order")) {
            // Hold the PUT so we can sample the optimistic stray-kept order.
            await new Promise<void>((r) => {
              resolvePut = r;
            });
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() =>
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]),
    );

    let pending: Promise<void>;
    act(() => {
      // Only `alpha` in the order; `beta` is the stray that must be kept.
      pending = result.current.reorderServers(["alpha"]);
    });

    await waitFor(() => {
      observed.push(result.current.servers.map((s) => s.id));
      // alpha first (requested), beta appended as the stray.
      expect(result.current.servers.map((s) => s.id)).toEqual([
        "alpha",
        "beta",
      ]);
    });

    await act(async () => {
      resolvePut?.();
      await pending.catch(() => undefined);
    });
  });

  it("ignores an SSE channel that responds non-ok (no crash, list stays)", async () => {
    // The events subscription returns !ok, hitting the `!res.ok || !res.body`
    // early return so the reader loop is never entered.
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/api/servers/events")) {
            return new Response("nope", { status: 503 });
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The hook still loaded the list from the (real) GET handler.
    expect(result.current.servers.length).toBeGreaterThan(0);
  });

  it("ignores an SSE channel with no body (no crash)", async () => {
    // ok:true but a null body — exercises the `!res.body` half of the guard.
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/api/servers/events")) {
            return { ok: true, body: null } as unknown as Response;
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.servers.length).toBeGreaterThan(0);
  });

  it("survives an SSE reader that throws mid-stream (catch swallows it)", async () => {
    // A body whose reader.read() rejects — the reader-loop catch swallows the
    // error and the hook stays in last-known-good state.
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/api/servers/events")) {
            const body = {
              getReader: () => ({
                read: () => Promise.reject(new Error("stream broke")),
              }),
            };
            return { ok: true, body } as unknown as Response;
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(result.current.servers.length).toBeGreaterThan(0);
  });

  it("SSE reader loop fires a background refresh once per multi-frame chunk", async () => {
    // A single decode chunk carrying two `\n\n`-separated frames must collapse
    // to one refresh (sawFrame true once), then the stream ends (done:true).
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { seed: { type: "stdio", command: "s" } },
      }),
    );

    let reads = 0;
    const encoder = new TextEncoder();
    const { result } = renderHook(() =>
      useServers({
        baseUrl: "http://test.local",
        fetchFn: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/api/servers/events")) {
            const body = {
              getReader: () => ({
                read: async () => {
                  reads += 1;
                  if (reads === 1) {
                    // Two frames in one chunk → one background refresh.
                    return {
                      done: false,
                      value: encoder.encode("event: change\n\n\n\n"),
                    };
                  }
                  return { done: true, value: undefined };
                },
              }),
            };
            return { ok: true, body } as unknown as Response;
          }
          return h.fetchFn(url, init);
        },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Mutate disk, then the queued background refresh re-reads it.
    writeFileSync(
      h.configPath,
      JSON.stringify({
        mcpServers: { afterframe: { type: "stdio", command: "x" } },
      }),
    );

    // The two-frame chunk triggers exactly one refreshInternal(true); allow it
    // to resolve and pick up the new disk state.
    await waitFor(
      () => {
        expect(result.current.servers.map((s) => s.id)).toEqual(["afterframe"]);
      },
      { timeout: 3000 },
    );
  });

  it("falls back to globalThis.fetch when no fetchFn is provided", async () => {
    // No fetchFn → the `doFetch = fetchFn ?? globalThis.fetch` default branch.
    const globalFetch = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        return h.fetchFn(url, init);
      });
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const { result } = renderHook(() =>
        useServers({ baseUrl: "http://test.local" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(globalFetch).toHaveBeenCalled();
      expect(result.current.servers.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("uses DEFAULT_SEED_CONFIG keys on the first load (seed-write contract)", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.servers.map((s) => s.id)).toEqual(
      Object.keys(DEFAULT_SEED_CONFIG.mcpServers),
    );
  });
});
