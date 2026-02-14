import { describe, it, expect, vi, beforeEach, afterEach, afterAll, } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createTransportNode } from "../mcp/node/transport.js";
import { NodeOAuthStorage } from "../auth/node/storage-node.js";
import { createOAuthClientConfig } from "../test/test-server-fixtures.js";
const oauthTestStatePath = path.join(os.tmpdir(), `mcp-oauth-${process.pid}-inspectorClient-oauth-fetchFn.json`);
function createTestOAuthConfig(options) {
    return {
        ...createOAuthClientConfig(options),
        storage: new NodeOAuthStorage(oauthTestStatePath),
    };
}
const mockAuth = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
    auth: (...args) => mockAuth(...args),
}));
describe("InspectorClient OAuth fetchFn", () => {
    let client;
    afterAll(async () => {
        try {
            await fs.unlink(oauthTestStatePath);
        }
        catch {
            // Ignore if file does not exist or already removed
        }
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => { });
        mockAuth.mockImplementation(async (provider) => {
            provider.redirectToAuthorization(new URL("http://example.com/oauth/authorize"));
            return "REDIRECT";
        });
    });
    afterEach(async () => {
        if (client) {
            try {
                await client.disconnect();
            }
            catch {
                // Ignore disconnect errors
            }
        }
        vi.restoreAllMocks();
    });
    it("should pass fetchFn to auth() when provided", async () => {
        const mockFetchFn = vi.fn();
        const oauthConfig = createTestOAuthConfig({
            mode: "static",
            clientId: "test-client",
            redirectUrl: "http://localhost:3000/callback",
        });
        client = new InspectorClient({ type: "sse", url: "http://localhost:3000/sse" }, {
            environment: {
                transport: createTransportNode,
                fetch: mockFetchFn,
                oauth: {
                    storage: oauthConfig.storage,
                    navigation: oauthConfig.navigation,
                    redirectUrlProvider: oauthConfig.redirectUrlProvider,
                },
            },
            autoSyncLists: false,
            oauth: {
                clientId: oauthConfig.clientId,
                clientSecret: oauthConfig.clientSecret,
                clientMetadataUrl: oauthConfig.clientMetadataUrl,
                scope: oauthConfig.scope,
            },
        });
        const url = await client.authenticate();
        expect(url).toBeInstanceOf(URL);
        expect(mockAuth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            fetchFn: expect.any(Function),
        }));
    });
    it("should pass fetchFn to auth() when not provided (uses default fetch)", async () => {
        const oauthConfig = createTestOAuthConfig({
            mode: "static",
            clientId: "test-client",
            redirectUrl: "http://localhost:3000/callback",
        });
        client = new InspectorClient({ type: "sse", url: "http://localhost:3000/sse" }, {
            environment: {
                transport: createTransportNode,
                oauth: {
                    storage: oauthConfig.storage,
                    navigation: oauthConfig.navigation,
                    redirectUrlProvider: oauthConfig.redirectUrlProvider,
                },
            },
            autoSyncLists: false,
            oauth: {
                clientId: oauthConfig.clientId,
                clientSecret: oauthConfig.clientSecret,
                clientMetadataUrl: oauthConfig.clientMetadataUrl,
                scope: oauthConfig.scope,
            },
        });
        await client.authenticate();
        expect(mockAuth).toHaveBeenCalled();
        const callArgs = mockAuth.mock.calls[0];
        const options = callArgs[1];
        expect(options).toHaveProperty("fetchFn");
        expect(typeof options.fetchFn).toBe("function");
    });
    it("should pass fetchFn to auth() in completeOAuthFlow when provided", async () => {
        const mockFetchFn = vi.fn();
        mockAuth.mockImplementation(async (provider) => {
            provider.saveTokens({
                access_token: "test-token",
                token_type: "Bearer",
            });
            return "AUTHORIZED";
        });
        const oauthConfig = createTestOAuthConfig({
            mode: "static",
            clientId: "test-client",
            redirectUrl: "http://localhost:3000/callback",
        });
        client = new InspectorClient({ type: "sse", url: "http://localhost:3000/sse" }, {
            environment: {
                transport: createTransportNode,
                fetch: mockFetchFn,
                oauth: {
                    storage: oauthConfig.storage,
                    navigation: oauthConfig.navigation,
                    redirectUrlProvider: oauthConfig.redirectUrlProvider,
                },
            },
            autoSyncLists: false,
            oauth: {
                clientId: oauthConfig.clientId,
                clientSecret: oauthConfig.clientSecret,
                clientMetadataUrl: oauthConfig.clientMetadataUrl,
                scope: oauthConfig.scope,
            },
        });
        await client.completeOAuthFlow("test-authorization-code");
        expect(mockAuth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            authorizationCode: "test-authorization-code",
            fetchFn: expect.any(Function),
        }));
    });
});
//# sourceMappingURL=inspectorClient-oauth-fetchFn.test.js.map