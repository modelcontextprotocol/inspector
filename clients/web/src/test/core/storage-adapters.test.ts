/**
 * Tests for storage adapters (file, remote).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { waitForRemoteStore } from "@modelcontextprotocol/inspector-test-server";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createFileStorageAdapter } from "@inspector/core/storage/adapters/file-storage.js";
import { createRemoteStorageAdapter } from "@inspector/core/storage/adapters/remote-storage.js";
import { createOAuthStore } from "@inspector/core/auth/store.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";

interface StartRemoteServerOptions {
  storageDir?: string;
}

async function startRemoteServer(
  port: number,
  options: StartRemoteServerOptions = {},
): Promise<{
  baseUrl: string;
  server: ServerType;
  authToken: string;
}> {
  const { app, authToken } = createRemoteApp({
    storageDir: options.storageDir,
    initialConfig: { defaultEnvironment: {} },
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port, hostname: "127.0.0.1" },
      (info) => {
        const actualPort =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : port;
        resolve({
          baseUrl: `http://127.0.0.1:${actualPort}`,
          server,
          authToken,
        });
      },
    );
    server.on("error", reject);
  });
}

describe("Storage adapters", () => {
  describe("createRemoteStorageAdapter (unit, mocked fetch)", () => {
    function makeAdapter(fetchFn: typeof fetch, authToken?: string) {
      return createRemoteStorageAdapter({
        baseUrl: "http://remote.example/",
        storeId: "test",
        fetchFn,
        authToken,
      })!;
    }

    it("getItem returns null on 404 and parses stored blob otherwise", async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("not found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: { hi: 1 }, version: 0 })),
        )
        .mockResolvedValueOnce(new Response("{}"));

      const adapter = makeAdapter(fetchFn as typeof fetch);
      expect(await adapter.getItem("anything")).toBeNull();
      const blob = await adapter.getItem("anything");
      expect(blob).toBeTruthy();
      // Empty object response → treated as "not initialized" → null.
      expect(await adapter.getItem("anything")).toBeNull();
    });

    it("getItem throws on non-404 error responses", async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("boom", { status: 500 }));
      const adapter = makeAdapter(fetchFn as typeof fetch);
      await expect(adapter.getItem("x")).rejects.toThrow(/500/);
    });

    it("setItem throws when the POST fails", async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("nope", { status: 500 }));
      const adapter = makeAdapter(fetchFn as typeof fetch);
      await expect(
        adapter.setItem("name", { state: { a: 1 }, version: 0 }),
      ).rejects.toThrow(/500/);
    });

    it("removeItem tolerates 404 but rethrows on other failures", async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response("boom", { status: 500 }));
      const adapter = makeAdapter(fetchFn as typeof fetch);
      await expect(adapter.removeItem("x")).resolves.toBeUndefined();
      await expect(adapter.removeItem("x")).resolves.toBeUndefined();
      await expect(adapter.removeItem("x")).rejects.toThrow(/500/);
    });

    it("sends the x-mcp-remote-auth header on all three verbs when authToken is set", async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("{}"));
      const adapter = makeAdapter(fetchFn as typeof fetch, "secret");
      await adapter.getItem("x");
      await adapter.setItem("x", { state: {}, version: 0 });
      await adapter.removeItem("x");
      for (const call of fetchFn.mock.calls) {
        const headers = call[1]?.headers as Record<string, string> | undefined;
        expect(headers?.["x-mcp-remote-auth"]).toBe("Bearer secret");
      }
    });
  });

  describe("FileStorageAdapter", () => {
    let tempDir: string | null = null;

    afterEach(() => {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("creates store and persists state", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const storage = createFileStorageAdapter({ filePath });
      const store = createOAuthStore(storage);

      // Set some state
      store.getState().setServerState("https://example.com", {
        tokens: { access_token: "test-token", token_type: "Bearer" },
      });

      // Wait for persistence (Zustand persist is async; poll for file so we don't race with cleanup)
      await vi.waitFor(
        () => {
          expect(existsSync(filePath)).toBe(true);
        },
        { timeout: 2000, interval: 20 },
      );
      const fileContent = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.state.servers["https://example.com"].tokens).toEqual({
        access_token: "test-token",
        token_type: "Bearer",
      });
    });

    it("loads persisted state on initialization", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");

      // Create initial store and persist
      const storage1 = createFileStorageAdapter({ filePath });
      const store1 = createOAuthStore(storage1);
      store1.getState().setServerState("https://example.com", {
        tokens: { access_token: "initial-token", token_type: "Bearer" },
      });
      await vi.waitFor(
        () => {
          expect(existsSync(filePath)).toBe(true);
        },
        { timeout: 2000, interval: 20 },
      );

      // Create new store instance (should load persisted state)
      const storage2 = createFileStorageAdapter({ filePath });
      const store2 = createOAuthStore(storage2);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const state = store2.getState().getServerState("https://example.com");
      expect(state.tokens).toEqual({
        access_token: "initial-token",
        token_type: "Bearer",
      });
    });

    it("handles empty state after clear", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const storage = createFileStorageAdapter({ filePath });
      const store = createOAuthStore(storage);

      // Set state and persist
      store.getState().setServerState("https://example.com", {
        tokens: { access_token: "test-token", token_type: "Bearer" },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(existsSync(filePath)).toBe(true);

      // Clear all servers (this will persist empty state)
      const state = store.getState();
      const urls = Object.keys(state.servers);
      for (const url of urls) {
        state.clearServerState(url);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify file still exists but with empty servers
      expect(existsSync(filePath)).toBe(true);
      const fileContent = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(Object.keys(parsed.state.servers).length).toBe(0);
    });

    it("removeItem deletes the underlying file", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const storage = createFileStorageAdapter({ filePath });
      // createJSONStorage returns a PersistStorage<S> wrapper that delegates to
      // our adapter's removeItem callback (line 25 of file-storage.ts).
      const store = createOAuthStore(storage);
      store.getState().setServerState("https://example.com", {
        tokens: { access_token: "t", token_type: "Bearer" },
      });
      await vi.waitFor(() => expect(existsSync(filePath)).toBe(true), {
        timeout: 2000,
        interval: 20,
      });
      await storage!.removeItem("inspector-oauth-store");
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("RemoteStorageAdapter", () => {
    let remoteServer: ServerType | null = null;
    let tempDir: string | null = null;

    afterEach(async () => {
      if (remoteServer) {
        await new Promise<void>((resolve, reject) => {
          remoteServer!.close((err) => (err ? reject(err) : resolve()));
        });
        remoteServer = null;
      }
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("creates store and persists state via HTTP", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const storage = createRemoteStorageAdapter({
        baseUrl,
        storeId: "test-store",
        authToken,
      });
      const store = createOAuthStore(storage);

      // Set some state
      store.getState().setServerState("https://example.com", {
        tokens: { access_token: "test-token", token_type: "Bearer" },
      });

      await waitForRemoteStore(baseUrl, "test-store", authToken, (body) => {
        const d = body as {
          state?: {
            servers?: Record<string, { tokens?: { access_token?: string } }>;
          };
        };
        return (
          d?.state?.servers?.["https://example.com"]?.tokens?.access_token ===
          "test-token"
        );
      });

      // Verify via API
      const res = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const storeData = await res.json();
      expect(storeData.state.servers["https://example.com"].tokens).toEqual({
        access_token: "test-token",
        token_type: "Bearer",
      });
    });

    it("loads persisted state on initialization", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      // Create initial store and persist
      const storage1 = createRemoteStorageAdapter({
        baseUrl,
        storeId: "test-store",
        authToken,
      });
      const store1 = createOAuthStore(storage1);
      store1.getState().setServerState("https://example.com", {
        tokens: { access_token: "initial-token", token_type: "Bearer" },
      });
      await waitForRemoteStore(baseUrl, "test-store", authToken, (body) => {
        const d = body as {
          state?: {
            servers?: Record<string, { tokens?: { access_token?: string } }>;
          };
        };
        return (
          d?.state?.servers?.["https://example.com"]?.tokens?.access_token ===
          "initial-token"
        );
      });

      // Create new store instance (should load persisted state)
      const storage2 = createRemoteStorageAdapter({
        baseUrl,
        storeId: "test-store",
        authToken,
      });
      const store2 = createOAuthStore(storage2);
      await vi.waitFor(
        () => {
          const state = store2.getState().getServerState("https://example.com");
          if (!state.tokens) throw new Error("Store not yet hydrated");
          return state;
        },
        { timeout: 2000, interval: 50 },
      );

      const state = store2.getState().getServerState("https://example.com");
      expect(state.tokens).toEqual({
        access_token: "initial-token",
        token_type: "Bearer",
      });
    });

    it("handles empty state after clear", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const storage = createRemoteStorageAdapter({
        baseUrl,
        storeId: "test-store",
        authToken,
      });
      const store = createOAuthStore(storage);

      // Set state and persist
      store.getState().setServerState("https://example.com", {
        tokens: { access_token: "test-token", token_type: "Bearer" },
      });
      await waitForRemoteStore(baseUrl, "test-store", authToken, (body) => {
        const d = body as { state?: { servers?: Record<string, unknown> } };
        return !!d?.state?.servers && Object.keys(d.state.servers).length > 0;
      });

      // Verify it exists
      let res = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const storeData = await res.json();
      expect(Object.keys(storeData.state.servers).length).toBeGreaterThan(0);

      // Clear all servers (this will persist empty state)
      const state = store.getState();
      const urls = Object.keys(state.servers);
      for (const url of urls) {
        state.clearServerState(url);
      }
      await waitForRemoteStore(baseUrl, "test-store", authToken, (body) => {
        const d = body as { state?: { servers?: Record<string, unknown> } };
        return !d?.state?.servers || Object.keys(d.state.servers).length === 0;
      });

      // Verify it's empty
      res = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const emptyStore = await res.json();
      expect(Object.keys(emptyStore.state.servers).length).toBe(0);
    });
  });
});
