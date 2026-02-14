/**
 * Tests for storage adapters (file, remote).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createFileStorageAdapter } from "../storage/adapters/file-storage.js";
import { createRemoteStorageAdapter } from "../storage/adapters/remote-storage.js";
import { createOAuthStore } from "../auth/store.js";
import { createRemoteApp } from "../mcp/remote/node/server.js";
async function startRemoteServer(port, options = {}) {
    const { app, authToken } = createRemoteApp({
        storageDir: options.storageDir,
    });
    return new Promise((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
            const actualPort = info && typeof info === "object" && "port" in info
                ? info.port
                : port;
            resolve({
                baseUrl: `http://127.0.0.1:${actualPort}`,
                server,
                authToken,
            });
        });
        server.on("error", reject);
    });
}
describe("Storage adapters", () => {
    describe("FileStorageAdapter", () => {
        let tempDir = null;
        afterEach(() => {
            if (tempDir) {
                try {
                    rmSync(tempDir, { recursive: true });
                }
                catch {
                    // Ignore cleanup errors
                }
                tempDir = null;
            }
        });
        it("creates store and persists state", async () => {
            tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
            const filePath = join(tempDir, "test-store.json");
            const storage = createFileStorageAdapter({ filePath });
            const store = createOAuthStore(storage);
            // Set some state
            store.getState().setServerState("https://example.com", {
                tokens: { access_token: "test-token", token_type: "Bearer" },
            });
            // Wait for persistence
            await new Promise((resolve) => setTimeout(resolve, 100));
            // Verify file exists and contains state
            expect(existsSync(filePath)).toBe(true);
            const fileContent = readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(fileContent);
            expect(parsed.state.servers["https://example.com"].tokens).toEqual({
                access_token: "test-token",
                token_type: "Bearer",
            });
        });
        it("loads persisted state on initialization", async () => {
            tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
            const filePath = join(tmpdir(), "inspector-storage-test-", "test-store.json");
            // Create initial store and persist
            const storage1 = createFileStorageAdapter({ filePath });
            const store1 = createOAuthStore(storage1);
            store1.getState().setServerState("https://example.com", {
                tokens: { access_token: "initial-token", token_type: "Bearer" },
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
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
            const filePath = join(tempDir, "test-store.json");
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
    });
    describe("RemoteStorageAdapter", () => {
        let remoteServer = null;
        let tempDir = null;
        afterEach(async () => {
            if (remoteServer) {
                await new Promise((resolve, reject) => {
                    remoteServer.close((err) => (err ? reject(err) : resolve()));
                });
                remoteServer = null;
            }
            if (tempDir) {
                try {
                    rmSync(tempDir, { recursive: true });
                }
                catch {
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
            // Wait for persistence
            await new Promise((resolve) => setTimeout(resolve, 200));
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
            await new Promise((resolve) => setTimeout(resolve, 200));
            // Create new store instance (should load persisted state)
            const storage2 = createRemoteStorageAdapter({
                baseUrl,
                storeId: "test-store",
                authToken,
            });
            const store2 = createOAuthStore(storage2);
            await new Promise((resolve) => setTimeout(resolve, 200));
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
            await new Promise((resolve) => setTimeout(resolve, 200));
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
            await new Promise((resolve) => setTimeout(resolve, 200));
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
//# sourceMappingURL=storage-adapters.test.js.map