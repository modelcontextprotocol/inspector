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
import type { MCPConfig } from "@inspector/core/mcp/types";

interface Harness {
  fetchFn: typeof fetch;
  configPath: string;
  tempDir: string;
}

function setupHarness(): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-useServers-"));
  const configPath = join(tempDir, "mcp.json");
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
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
  return { fetchFn, configPath, tempDir };
}

function teardownHarness(h: Harness): void {
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

  afterEach(() => {
    teardownHarness(h);
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
        metadata: [{ key: "trace", value: "abc" }],
        connectionTimeout: 5000,
        requestTimeout: 30000,
      });
    });

    await waitFor(() => {
      expect(result.current.servers[0]?.settings).toEqual({
        headers: [{ key: "X-Tenant", value: "acme" }],
        metadata: [{ key: "trace", value: "abc" }],
        connectionTimeout: 5000,
        requestTimeout: 30000,
      });
    });
    const stored = readConfig(h.configPath).mcpServers.alpha as {
      type?: string;
      url?: string;
      settings?: unknown;
    };
    expect(stored.type).toBe("streamable-http");
    expect(stored.url).toBe("https://x.test/mcp");
    expect(stored.settings).toBeDefined();
  });

  it("updateServerSettings throws when the target id does not exist", async () => {
    const { result } = renderHook(() =>
      useServers({ baseUrl: "http://test.local", fetchFn: h.fetchFn }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateServerSettings("nonexistent", {
          headers: [],
          metadata: [],
          connectionTimeout: 0,
          requestTimeout: 0,
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
            settings: {
              headers: [{ key: "X-Keep", value: "yes" }],
              metadata: [],
              connectionTimeout: 0,
              requestTimeout: 0,
            },
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
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
    });
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
