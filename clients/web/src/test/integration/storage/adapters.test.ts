/**
 * Tests for OAuth persistence (file + remote) and store-io flush helpers.
 */

import { describe, it, expect, afterEach } from "vitest";
import { waitForRemoteStore } from "@modelcontextprotocol/inspector-test-server";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/storage-remote.js";
import { OAuthMemoryStore } from "@inspector/core/auth/store.js";
import { createFileOAuthPersistBackend } from "@inspector/core/auth/node/oauth-persist-file.js";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";
import {
  oauthSecretServerId,
  LEGACY_TOKENS_FIELD,
} from "@inspector/core/auth/node/oauth-secrets.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import {
  writeStoreFile,
  flushStoreFileWrites,
} from "@inspector/core/storage/store-io.js";

interface StartRemoteServerOptions {
  storageDir?: string;
  secretStore?: InMemorySecretStore;
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
    secretStore: options.secretStore ?? new InMemorySecretStore(),
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

describe("OAuth persistence", () => {
  describe("OAuth file persistence", () => {
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
      const secretStore = new InMemorySecretStore();
      const storage = new NodeOAuthStorage(filePath, secretStore);

      await storage.saveTokens("https://example.com", {
        access_token: "test-token",
        token_type: "Bearer",
      });

      await flushStoreFileWrites(filePath);
      // Tokens are split into the secret store; the file keeps only the
      // non-secret residue for the server entry.
      const fileContent = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.servers["https://example.com"]).toBeDefined();
      expect(parsed.servers["https://example.com"].tokens).toBeUndefined();
      expect(
        JSON.parse(
          (await secretStore.get(
            oauthSecretServerId("https://example.com"),
            LEGACY_TOKENS_FIELD,
          ))!,
        ),
      ).toEqual({ access_token: "test-token", token_type: "Bearer" });

      // A joined read through the backend sees the full state again.
      const backend = createFileOAuthPersistBackend({ filePath, secretStore });
      const snapshot = await backend.read();
      expect(snapshot?.servers["https://example.com"].tokens).toEqual({
        access_token: "test-token",
        token_type: "Bearer",
      });
    });

    it("loads persisted state on initialization", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const secretStore = new InMemorySecretStore();

      const storage1 = new NodeOAuthStorage(filePath, secretStore);
      await storage1.saveTokens("https://example.com", {
        access_token: "initial-token",
        token_type: "Bearer",
      });
      await flushStoreFileWrites(filePath);

      const backend = createFileOAuthPersistBackend({ filePath, secretStore });
      const snapshot = await backend.read();
      const freshMemory = new OAuthMemoryStore(snapshot ?? undefined);
      const state = freshMemory
        .getState()
        .getServerState("https://example.com");
      expect(state.tokens).toEqual({
        access_token: "initial-token",
        token_type: "Bearer",
      });
    });

    it("reads legacy persist envelope, migrates secrets, and rewrites as plain JSON on save", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const secretStore = new InMemorySecretStore();
      await writeStoreFile(
        filePath,
        JSON.stringify({
          state: {
            servers: {
              "https://example.com": {
                tokens: { access_token: "legacy", token_type: "Bearer" },
              },
            },
            idpSessions: {},
          },
          version: 0,
        }),
      );

      const storage = new NodeOAuthStorage(filePath, secretStore);
      expect(await storage.getTokens("https://example.com")).toEqual({
        access_token: "legacy",
        token_type: "Bearer",
      });

      // The durable store makes the read migrate: plaintext tokens move to
      // the secret store and the file is stripped.
      expect(
        await secretStore.get(
          oauthSecretServerId("https://example.com"),
          LEGACY_TOKENS_FIELD,
        ),
      ).not.toBeNull();

      await storage.saveScope("https://example.com", "read");
      await flushStoreFileWrites(filePath);

      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed.servers["https://example.com"].scope).toBe("read");
      expect(parsed.servers["https://example.com"].tokens).toBeUndefined();
      expect(parsed.version).toBeUndefined();
      expect(parsed.state).toBeUndefined();
    });

    it("handles empty state after clear", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const storage = new NodeOAuthStorage(filePath);

      await storage.saveTokens("https://example.com", {
        access_token: "test-token",
        token_type: "Bearer",
      });
      await flushStoreFileWrites(filePath);
      expect(existsSync(filePath)).toBe(true);

      await storage.clear("https://example.com");
      await flushStoreFileWrites(filePath);

      expect(existsSync(filePath)).toBe(true);
      const fileContent = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(Object.keys(parsed.servers).length).toBe(0);
    });

    it("remove deletes the underlying file", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "test-store.json");
      const storage = new NodeOAuthStorage(filePath);
      await storage.saveTokens("https://example.com", {
        access_token: "t",
        token_type: "Bearer",
      });
      await flushStoreFileWrites(filePath);
      expect(existsSync(filePath)).toBe(true);
      const backend = createFileOAuthPersistBackend({ filePath });
      await backend.remove!();
      expect(existsSync(filePath)).toBe(false);
    });

    it("write without sections replaces the whole file (legacy path)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "oauth.json");
      await writeStoreFile(
        filePath,
        JSON.stringify({
          servers: { "https://other.example": { scope: "other" } },
          idpSessions: {},
        }),
      );
      await flushStoreFileWrites(filePath);

      const backend = createFileOAuthPersistBackend({ filePath });
      await backend.write({
        servers: { "https://mine.example": { scope: "mine" } },
        idpSessions: {},
      });
      await flushStoreFileWrites(filePath);

      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed.servers).toEqual({
        "https://mine.example": { scope: "mine" },
      });
    });

    it("sectioned write merges only the named entries over the file", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "oauth.json");
      // Another process's state already on disk.
      await writeStoreFile(
        filePath,
        JSON.stringify({
          servers: { "https://other.example": { scope: "other" } },
          idpSessions: { "https://idp.example": { idToken: "other-idp" } },
        }),
      );
      await flushStoreFileWrites(filePath);

      const backend = createFileOAuthPersistBackend({ filePath });
      // This process's snapshot never saw the other entries — a stale
      // whole-file write would erase them; the sectioned write must not.
      await backend.write(
        {
          servers: { "https://mine.example": { scope: "mine" } },
          idpSessions: {},
        },
        { servers: ["https://mine.example"] },
      );
      await flushStoreFileWrites(filePath);

      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed.servers).toEqual({
        "https://other.example": { scope: "other" },
        "https://mine.example": { scope: "mine" },
      });
      expect(parsed.idpSessions).toEqual({
        "https://idp.example": { idToken: "other-idp" },
      });
    });

    it("sectioned write propagates deletions of the named entries", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "oauth.json");
      await writeStoreFile(
        filePath,
        JSON.stringify({
          servers: {
            "https://keep.example": { scope: "keep" },
            "https://cleared.example": { scope: "stale" },
          },
          idpSessions: {},
        }),
      );
      await flushStoreFileWrites(filePath);

      const backend = createFileOAuthPersistBackend({ filePath });
      // The named server is absent from the snapshot (it was cleared) — the
      // merge must delete it rather than resurrect the disk copy.
      await backend.write(
        { servers: {}, idpSessions: {} },
        { servers: ["https://cleared.example"] },
      );
      await flushStoreFileWrites(filePath);

      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed.servers).toEqual({
        "https://keep.example": { scope: "keep" },
      });
    });

    it("sectioned write against a missing file writes just the named entries", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const filePath = join(tempDir!, "oauth.json");
      const backend = createFileOAuthPersistBackend({ filePath });
      await backend.write(
        {
          servers: { "https://mine.example": { scope: "mine" } },
          idpSessions: {},
        },
        { servers: ["https://mine.example"] },
      );
      await flushStoreFileWrites(filePath);
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(parsed).toEqual({
        servers: { "https://mine.example": { scope: "mine" } },
        idpSessions: {},
      });
    });
  });

  describe("flushStoreFileWrites", () => {
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

    it("resolves immediately when nothing is in flight", async () => {
      await expect(flushStoreFileWrites()).resolves.toBeUndefined();
      await expect(
        flushStoreFileWrites("/no/such/path.json"),
      ).resolves.toBeUndefined();
    });

    it("awaits the pending write for a specific path", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-flush-test-"));
      const filePath = join(tempDir, "store.json");

      const write = writeStoreFile(filePath, '{"hello":"world"}');
      await flushStoreFileWrites(filePath);
      expect(existsSync(filePath)).toBe(true);
      expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({
        hello: "world",
      });
      await write;
    });

    it("awaits all pending writes when no path is given", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-flush-test-"));
      const a = join(tempDir, "a.json");
      const b = join(tempDir, "b.json");

      const writes = Promise.all([
        writeStoreFile(a, '{"n":1}'),
        writeStoreFile(b, '{"n":2}'),
      ]);
      await flushStoreFileWrites();
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
      await writes;
    });

    it("serializes overlapping writes to the same path (last write wins)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-flush-test-"));
      const filePath = join(tempDir, "store.json");

      const first = writeStoreFile(filePath, '{"v":1}');
      const second = writeStoreFile(filePath, '{"v":2}');
      await Promise.all([first, second]);
      await flushStoreFileWrites(filePath);
      expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ v: 2 });
    });
  });

  describe("Remote OAuth persistence", () => {
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

      const storage = new RemoteOAuthStorage({
        baseUrl,
        authToken,
      });

      await storage.saveTokens("https://example.com", {
        access_token: "test-token",
        token_type: "Bearer",
      });

      await waitForRemoteStore(baseUrl, "oauth", authToken, (body) => {
        const d = body as {
          servers?: Record<string, { tokens?: { access_token?: string } }>;
        };
        return (
          d?.servers?.["https://example.com"]?.tokens?.access_token ===
          "test-token"
        );
      });

      const res = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const storeData = await res.json();
      expect(storeData.servers["https://example.com"].tokens).toEqual({
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

      const storage1 = new RemoteOAuthStorage({
        baseUrl,
        authToken,
      });
      await storage1.saveTokens("https://example.com", {
        access_token: "initial-token",
        token_type: "Bearer",
      });
      await waitForRemoteStore(baseUrl, "oauth", authToken, (body) => {
        const d = body as {
          servers?: Record<string, { tokens?: { access_token?: string } }>;
        };
        return (
          d?.servers?.["https://example.com"]?.tokens?.access_token ===
          "initial-token"
        );
      });

      const storage2 = new RemoteOAuthStorage({
        baseUrl,
        authToken,
      });

      expect(await storage2.getTokens("https://example.com")).toEqual({
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

      const storage = new RemoteOAuthStorage({
        baseUrl,
        authToken,
      });

      await storage.saveTokens("https://example.com", {
        access_token: "test-token",
        token_type: "Bearer",
      });
      await waitForRemoteStore(baseUrl, "oauth", authToken, (body) => {
        const d = body as { servers?: Record<string, unknown> };
        return !!d?.servers && Object.keys(d.servers).length > 0;
      });

      let res = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const storeData = await res.json();
      expect(Object.keys(storeData.servers).length).toBeGreaterThan(0);

      await storage.clear("https://example.com");
      await waitForRemoteStore(baseUrl, "oauth", authToken, (body) => {
        const d = body as { servers?: Record<string, unknown> };
        return !d?.servers || Object.keys(d.servers).length === 0;
      });

      res = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(res.status).toBe(200);
      const emptyStore = await res.json();
      expect(Object.keys(emptyStore.servers).length).toBe(0);
    });

    it("plain POST fully replaces the store and splits secrets on disk", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const secretStore = new InMemorySecretStore();
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
        secretStore,
      });
      remoteServer = server;
      const headers = {
        "Content-Type": "application/json",
        "x-mcp-remote-auth": `Bearer ${authToken}`,
      };

      const post = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          servers: {
            "https://example.com": {
              scope: "read",
              tokens: { access_token: "posted", token_type: "Bearer" },
            },
          },
          idpSessions: {},
        }),
      });
      expect(post.status).toBe(200);

      // On disk: residue only. Via the store: the secret. Via GET: rejoined.
      const raw = JSON.parse(
        readFileSync(join(tempDir, "oauth.json"), "utf-8"),
      );
      expect(raw.servers["https://example.com"].scope).toBe("read");
      expect(raw.servers["https://example.com"].tokens).toBeUndefined();
      expect(
        await secretStore.get(
          oauthSecretServerId("https://example.com"),
          LEGACY_TOKENS_FIELD,
        ),
      ).not.toBeNull();
      const got = await fetch(`${baseUrl}/api/storage/oauth`, { headers });
      expect((await got.json()).servers["https://example.com"].tokens).toEqual({
        access_token: "posted",
        token_type: "Bearer",
      });
    });

    it("POST over the body cap is refused with 413 before parsing", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const secretStore = new InMemorySecretStore();
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
        secretStore,
      });
      remoteServer = server;
      const headers = {
        "Content-Type": "application/json",
        "x-mcp-remote-auth": `Bearer ${authToken}`,
      };

      // Just over MAX_STORAGE_BODY_BYTES (4 MiB): the bodyLimit middleware
      // must reject before c.req.json() buffers it, and nothing may land on
      // disk.
      const oversized = `{"servers":{},"idpSessions":{},"pad":"${"x".repeat(
        4 * 1024 * 1024,
      )}"}`;
      const res = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "POST",
        headers,
        body: oversized,
      });
      expect(res.status).toBe(413);
      expect((await res.json()).error).toBe("Storage payload too large");
      expect(existsSync(join(tempDir, "oauth.json"))).toBe(false);
    });

    it("DELETE purges the file and its secret-store entries", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const secretStore = new InMemorySecretStore();
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
        secretStore,
      });
      remoteServer = server;
      const headers = {
        "Content-Type": "application/json",
        "x-mcp-remote-auth": `Bearer ${authToken}`,
      };

      await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          servers: {
            "https://example.com": {
              tokens: { access_token: "doomed", token_type: "Bearer" },
            },
          },
          idpSessions: {},
        }),
      });
      expect(
        await secretStore.get(
          oauthSecretServerId("https://example.com"),
          LEGACY_TOKENS_FIELD,
        ),
      ).not.toBeNull();

      const del = await fetch(`${baseUrl}/api/storage/oauth`, {
        method: "DELETE",
        headers,
      });
      expect(del.status).toBe(200);
      expect(existsSync(join(tempDir, "oauth.json"))).toBe(false);
      expect(
        await secretStore.get(
          oauthSecretServerId("https://example.com"),
          LEGACY_TOKENS_FIELD,
        ),
      ).toBeNull();
    });
  });
});
