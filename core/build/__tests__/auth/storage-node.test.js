import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeOAuthStorage, getOAuthStore, } from "../../auth/node/storage-node.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { waitForStateFile } from "../../test/test-helpers.js";
// Unique path per process so parallel test files don't share the same state file
const testStatePath = path.join(os.tmpdir(), `mcp-inspector-oauth-${process.pid}-storage-node.json`);
describe("NodeOAuthStorage", () => {
    let storage;
    const testServerUrl = "http://localhost:3000";
    const stateFilePath = testStatePath;
    beforeEach(async () => {
        // Clean up any existing state file
        try {
            await fs.unlink(stateFilePath);
        }
        catch {
            // Ignore if file doesn't exist
        }
        // Reset store state by clearing all servers
        const store = getOAuthStore(testStatePath);
        const state = store.getState();
        // Clear all server states
        Object.keys(state.servers).forEach((url) => {
            state.clearServerState(url);
        });
        storage = new NodeOAuthStorage(testStatePath);
    });
    afterEach(async () => {
        // Clean up state file after each test
        try {
            await fs.unlink(stateFilePath);
        }
        catch {
            // Ignore if file doesn't exist
        }
        // Reset store state
        const store = getOAuthStore(testStatePath);
        const state = store.getState();
        Object.keys(state.servers).forEach((url) => {
            state.clearServerState(url);
        });
    });
    describe("getClientInformation", () => {
        it("should return undefined when no client information is stored", async () => {
            const result = await storage.getClientInformation(testServerUrl);
            expect(result).toBeUndefined();
        });
        it("should return stored client information", async () => {
            const clientInfo = {
                client_id: "test-client-id",
                client_secret: "test-secret",
            };
            await storage.saveClientInformation(testServerUrl, clientInfo);
            const result = await storage.getClientInformation(testServerUrl);
            expect(result).toBeDefined();
            expect(result?.client_id).toBe(clientInfo.client_id);
            expect(result?.client_secret).toBe(clientInfo.client_secret);
        });
        it("should return preregistered client information when requested", async () => {
            const preregisteredInfo = {
                client_id: "preregistered-id",
                client_secret: "preregistered-secret",
            };
            // Store as preregistered by directly setting it in the store
            const store = getOAuthStore(testStatePath);
            store.getState().setServerState(testServerUrl, {
                preregisteredClientInformation: preregisteredInfo,
            });
            const result = await storage.getClientInformation(testServerUrl, true);
            expect(result).toBeDefined();
            expect(result?.client_id).toBe(preregisteredInfo.client_id);
            expect(result?.client_secret).toBe(preregisteredInfo.client_secret);
        });
    });
    describe("saveClientInformation", () => {
        it("should save client information", async () => {
            const clientInfo = {
                client_id: "test-client-id",
            };
            await storage.saveClientInformation(testServerUrl, clientInfo);
            const result = await storage.getClientInformation(testServerUrl);
            expect(result).toBeDefined();
            expect(result?.client_id).toBe(clientInfo.client_id);
        });
        it("should overwrite existing client information", async () => {
            const firstInfo = {
                client_id: "first-id",
            };
            const secondInfo = {
                client_id: "second-id",
            };
            storage.saveClientInformation(testServerUrl, firstInfo);
            storage.saveClientInformation(testServerUrl, secondInfo);
            const result = await storage.getClientInformation(testServerUrl);
            expect(result).toBeDefined();
            expect(result?.client_id).toBe(secondInfo.client_id);
        });
    });
    describe("getTokens", () => {
        it("should return undefined when no tokens are stored", async () => {
            const result = await storage.getTokens(testServerUrl);
            expect(result).toBeUndefined();
        });
        it("should return stored tokens", async () => {
            const tokens = {
                access_token: "test-access-token",
                token_type: "Bearer",
                expires_in: 3600,
            };
            await storage.saveTokens(testServerUrl, tokens);
            const result = await storage.getTokens(testServerUrl);
            expect(result).toEqual(tokens);
        });
        it("should persist and return refresh_token", async () => {
            const tokens = {
                access_token: "test-access-token",
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: "test-refresh-token",
            };
            await storage.saveTokens(testServerUrl, tokens);
            const result = await storage.getTokens(testServerUrl);
            expect(result).toBeDefined();
            expect(result?.access_token).toBe(tokens.access_token);
            expect(result?.refresh_token).toBe(tokens.refresh_token);
        });
    });
    describe("saveTokens", () => {
        it("should save tokens", async () => {
            const tokens = {
                access_token: "test-access-token",
                token_type: "Bearer",
            };
            await storage.saveTokens(testServerUrl, tokens);
            const result = await storage.getTokens(testServerUrl);
            expect(result).toEqual(tokens);
        });
        it("should overwrite existing tokens", async () => {
            const firstTokens = {
                access_token: "first-token",
                token_type: "Bearer",
            };
            const secondTokens = {
                access_token: "second-token",
                token_type: "Bearer",
            };
            await storage.saveTokens(testServerUrl, firstTokens);
            await storage.saveTokens(testServerUrl, secondTokens);
            const result = await storage.getTokens(testServerUrl);
            expect(result).toEqual(secondTokens);
        });
    });
    describe("getCodeVerifier", () => {
        it("should return undefined when no code verifier is stored", async () => {
            const result = await storage.getCodeVerifier(testServerUrl);
            expect(result).toBeUndefined();
        });
        it("should return stored code verifier", async () => {
            const codeVerifier = "test-code-verifier";
            await storage.saveCodeVerifier(testServerUrl, codeVerifier);
            const result = await storage.getCodeVerifier(testServerUrl);
            expect(result).toBe(codeVerifier);
        });
    });
    describe("saveCodeVerifier", () => {
        it("should save code verifier", async () => {
            const codeVerifier = "test-code-verifier";
            await storage.saveCodeVerifier(testServerUrl, codeVerifier);
            const result = await storage.getCodeVerifier(testServerUrl);
            expect(result).toBe(codeVerifier);
        });
    });
    describe("getScope", () => {
        it("should return undefined when no scope is stored", async () => {
            const result = await storage.getScope(testServerUrl);
            expect(result).toBeUndefined();
        });
        it("should return stored scope", async () => {
            const scope = "read write";
            await storage.saveScope(testServerUrl, scope);
            const result = await storage.getScope(testServerUrl);
            expect(result).toBe(scope);
        });
    });
    describe("saveScope", () => {
        it("should save scope", async () => {
            const scope = "read write";
            await storage.saveScope(testServerUrl, scope);
            const result = await storage.getScope(testServerUrl);
            expect(result).toBe(scope);
        });
    });
    describe("getServerMetadata", () => {
        it("should return null when no metadata is stored", async () => {
            const result = await storage.getServerMetadata(testServerUrl);
            expect(result).toBeNull();
        });
        it("should return stored metadata", async () => {
            const metadata = {
                issuer: "http://localhost:3000",
                authorization_endpoint: "http://localhost:3000/authorize",
                token_endpoint: "http://localhost:3000/token",
                response_types_supported: ["code"],
            };
            await storage.saveServerMetadata(testServerUrl, metadata);
            const result = await storage.getServerMetadata(testServerUrl);
            expect(result).toEqual(metadata);
        });
    });
    describe("saveServerMetadata", () => {
        it("should save server metadata", async () => {
            const metadata = {
                issuer: "http://localhost:3000",
                authorization_endpoint: "http://localhost:3000/authorize",
                token_endpoint: "http://localhost:3000/token",
                response_types_supported: ["code"],
            };
            await storage.saveServerMetadata(testServerUrl, metadata);
            const result = await storage.getServerMetadata(testServerUrl);
            expect(result).toEqual(metadata);
        });
    });
    describe("clearServerState", () => {
        it("should clear all state for a server", async () => {
            const clientInfo = {
                client_id: "test-client-id",
            };
            const tokens = {
                access_token: "test-token",
                token_type: "Bearer",
            };
            await storage.saveClientInformation(testServerUrl, clientInfo);
            await storage.saveTokens(testServerUrl, tokens);
            storage.clear(testServerUrl);
            expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
            expect(await storage.getTokens(testServerUrl)).toBeUndefined();
        });
        it("should not affect state for other servers", async () => {
            const otherServerUrl = "http://localhost:4000";
            const clientInfo = {
                client_id: "test-client-id",
            };
            await storage.saveClientInformation(testServerUrl, clientInfo);
            await storage.saveClientInformation(otherServerUrl, clientInfo);
            storage.clear(testServerUrl);
            expect(await storage.getClientInformation(testServerUrl)).toBeUndefined();
            const otherResult = await storage.getClientInformation(otherServerUrl);
            expect(otherResult).toBeDefined();
            expect(otherResult?.client_id).toBe(clientInfo.client_id);
            expect(otherResult).toEqual(clientInfo);
        });
    });
    describe("multiple servers", () => {
        it("should store separate state for different servers", async () => {
            const server1Url = "http://localhost:3000";
            const server2Url = "http://localhost:4000";
            const clientInfo1 = {
                client_id: "client-1",
            };
            const clientInfo2 = {
                client_id: "client-2",
            };
            storage.saveClientInformation(server1Url, clientInfo1);
            storage.saveClientInformation(server2Url, clientInfo2);
            const result1 = await storage.getClientInformation(server1Url);
            const result2 = await storage.getClientInformation(server2Url);
            expect(result1).toEqual(clientInfo1);
            expect(result2).toEqual(clientInfo2);
        });
    });
});
describe("OAuth Store (Zustand)", () => {
    const stateFilePath = testStatePath;
    beforeEach(async () => {
        try {
            await fs.unlink(stateFilePath);
        }
        catch {
            // Ignore if file doesn't exist
        }
    });
    afterEach(async () => {
        try {
            await fs.unlink(stateFilePath);
        }
        catch {
            // Ignore if file doesn't exist
        }
    });
    it("should create a new store", () => {
        const store = getOAuthStore(testStatePath);
        expect(store).toBeDefined();
        expect(store.getState).toBeDefined();
        expect(store.setState).toBeDefined();
    });
    it("should return the same store instance via getOAuthStore", () => {
        const store1 = getOAuthStore(testStatePath);
        const store2 = getOAuthStore(testStatePath);
        expect(store1).toBe(store2);
    });
    it("should persist state to file", async () => {
        if (process.env.DEBUG_WAIT_FOR_STATE_FILE === "1") {
            console.error("[storage-node.test] state file path:", stateFilePath);
        }
        const store = getOAuthStore(testStatePath);
        const serverUrl = "http://localhost:3000";
        const clientInfo = {
            client_id: "test-client-id",
        };
        store.getState().setServerState(serverUrl, {
            clientInformation: clientInfo,
        });
        const parsed = await waitForStateFile(stateFilePath, (p) => {
            const s = p?.state?.servers?.[serverUrl];
            return !!s?.clientInformation;
        }, { timeout: 2000, interval: 50 });
        expect(parsed.state.servers[serverUrl]?.clientInformation).toEqual(clientInfo);
    });
});
describe("NodeOAuthStorage with custom storagePath", () => {
    const testServerUrl = "http://localhost:3999";
    it("should use custom path for state file", async () => {
        const customPath = path.join(os.tmpdir(), `mcp-inspector-oauth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        try {
            const storage = new NodeOAuthStorage(customPath);
            const tokens = {
                access_token: "custom-path-token",
                token_type: "Bearer",
                refresh_token: "custom-refresh",
            };
            await storage.saveTokens(testServerUrl, tokens);
            const parsed = await waitForStateFile(customPath, (p) => {
                const t = p?.state?.servers?.[testServerUrl]?.tokens;
                return t?.access_token === tokens.access_token;
            }, { timeout: 2000, interval: 50 });
            expect(parsed.state.servers[testServerUrl]?.tokens?.access_token).toBe(tokens.access_token);
            const stored = await storage.getTokens(testServerUrl);
            expect(stored?.access_token).toBe(tokens.access_token);
            expect(stored?.refresh_token).toBe(tokens.refresh_token);
        }
        finally {
            try {
                await fs.unlink(customPath);
            }
            catch {
                /* ignore */
            }
        }
    });
    it("should isolate state from default store", async () => {
        const customPath = path.join(os.tmpdir(), `mcp-inspector-oauth-isolate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        try {
            const defaultStore = getOAuthStore();
            defaultStore.getState().setServerState(testServerUrl, {
                tokens: {
                    access_token: "default-token",
                    token_type: "Bearer",
                },
            });
            const customStorage = new NodeOAuthStorage(customPath);
            await customStorage.saveTokens(testServerUrl, {
                access_token: "custom-token",
                token_type: "Bearer",
            });
            const fromCustom = await customStorage.getTokens(testServerUrl);
            expect(fromCustom?.access_token).toBe("custom-token");
            const defaultStorage = new NodeOAuthStorage();
            const fromDefault = await defaultStorage.getTokens(testServerUrl);
            expect(fromDefault?.access_token).toBe("default-token");
            defaultStore.getState().clearServerState(testServerUrl);
        }
        finally {
            try {
                await fs.unlink(customPath);
            }
            catch {
                /* ignore */
            }
        }
    });
});
//# sourceMappingURL=storage-node.test.js.map