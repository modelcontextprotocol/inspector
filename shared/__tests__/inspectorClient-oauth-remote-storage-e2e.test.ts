/**
 * End-to-end OAuth tests for InspectorClient using RemoteOAuthStorage.
 * Tests OAuth flows with remote storage (HTTP API) instead of file storage.
 * These tests verify that OAuth state persists correctly via the remote storage API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createRemoteTransport } from "../mcp/remote/createRemoteTransport.js";
import { createRemoteFetch } from "../mcp/remote/createRemoteFetch.js";
import { RemoteOAuthStorage } from "../auth/remote/storage-remote.js";
import { createRemoteApp } from "../mcp/remote/node/server.js";
import { TestServerHttp } from "../test/test-server-http.js";
import { getDefaultServerConfig } from "../test/test-server-fixtures.js";
import {
  createOAuthTestServerConfig,
  createOAuthClientConfig,
  completeOAuthAuthorization,
  createClientMetadataServer,
  type ClientMetadataDocument,
} from "../test/test-server-fixtures.js";
import { ConsoleNavigation } from "../auth/providers.js";
import {
  clearOAuthTestData,
  getDCRRequests,
  invalidateAccessToken,
} from "../test/test-server-oauth.js";
import type { InspectorClientOptions } from "../mcp/inspectorClient.js";
import type { MCPServerConfig } from "../mcp/types.js";

type TransportType = "sse" | "streamable-http";

interface TransportConfig {
  name: string;
  serverType: "sse" | "streamable-http";
  clientType: "sse" | "streamable-http";
  endpoint: string;
}

const transports: TransportConfig[] = [
  {
    name: "SSE",
    serverType: "sse",
    clientType: "sse",
    endpoint: "/sse",
  },
  {
    name: "Streamable HTTP",
    serverType: "streamable-http",
    clientType: "streamable-http",
    endpoint: "/mcp",
  },
];

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

describe("InspectorClient OAuth E2E with Remote Storage", () => {
  let mcpServer: TestServerHttp;
  let remoteServer: ServerType | null = null;
  let remoteBaseUrl: string | null = null;
  let remoteAuthToken: string | null = null;
  let client: InspectorClient;
  let tempDir: string | null = null;
  const testRedirectUrl = "http://localhost:3001/oauth/callback";

  beforeEach(() => {
    clearOAuthTestData();
    tempDir = mkdtempSync(join(tmpdir(), "inspector-remote-storage-test-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (mcpServer) {
      await mcpServer.stop();
    }
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
    vi.restoreAllMocks();
  });

  async function setupRemoteServer(): Promise<void> {
    const { baseUrl, server, authToken } = await startRemoteServer(0, {
      storageDir: tempDir!,
    });
    remoteServer = server;
    remoteBaseUrl = baseUrl;
    remoteAuthToken = authToken;
  }

  describe.each(transports)(
    "Static/Preregistered Client Mode ($name)",
    (transport) => {
      it("should complete OAuth flow with static client using remote storage", async () => {
        await setupRemoteServer();

        const staticClientId = "test-static-client";
        const staticClientSecret = "test-static-secret";

        // Create test server with OAuth enabled and static client
        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            staticClients: [
              {
                clientId: staticClientId,
                clientSecret: staticClientSecret,
                redirectUris: [testRedirectUrl],
              },
            ],
          }),
        };

        mcpServer = new TestServerHttp(serverConfig);
        const port = await mcpServer.start();
        const serverUrl = `http://localhost:${port}`;

        // Create client with remote transport and remote OAuth storage
        const createTransport = createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteFetch = createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteStorage = new RemoteOAuthStorage({
          baseUrl: remoteBaseUrl!,
          storeId: "oauth",
          authToken: remoteAuthToken!,
        });

        const oauthConfig = createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransport,
          fetchFn: remoteFetch,
          oauth: {
            ...oauthConfig,
            storage: remoteStorage,
            navigation: new ConsoleNavigation(),
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        // Verify tokens are stored
        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(tokens?.token_type).toBe("Bearer");

        // Connection should now be successful
        expect(client.getStatus()).toBe("connected");
      });

      it("should persist OAuth state and reload on new client instance", async () => {
        await setupRemoteServer();

        const staticClientId = "test-static-client-reload";
        const staticClientSecret = "test-static-secret-reload";

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            staticClients: [
              {
                clientId: staticClientId,
                clientSecret: staticClientSecret,
                redirectUris: [testRedirectUrl],
              },
            ],
          }),
        };

        mcpServer = new TestServerHttp(serverConfig);
        const port = await mcpServer.start();
        const serverUrl = `http://localhost:${port}`;

        const createTransport = createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteFetch = createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteStorage = new RemoteOAuthStorage({
          baseUrl: remoteBaseUrl!,
          storeId: "oauth",
          authToken: remoteAuthToken!,
        });

        // First client: complete OAuth flow
        const oauthConfig1 = createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig1: InspectorClientOptions = {
          transportClientFactory: createTransport,
          fetchFn: remoteFetch,
          oauth: {
            ...oauthConfig1,
            storage: remoteStorage,
          },
        };

        const client1 = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig1,
        );

        const authUrl = await client1.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client1.completeOAuthFlow(authCode);
        await client1.connect();

        const tokens1 = await client1.getOAuthTokens();
        expect(tokens1).toBeDefined();
        await client1.disconnect();

        // Wait for persistence
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Second client: should load persisted state
        const remoteStorage2 = new RemoteOAuthStorage({
          baseUrl: remoteBaseUrl!,
          storeId: "oauth",
          authToken: remoteAuthToken!,
        });

        const oauthConfig2 = createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig2: InspectorClientOptions = {
          transportClientFactory: createTransport,
          fetchFn: remoteFetch,
          oauth: {
            ...oauthConfig2,
            storage: remoteStorage2,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig2,
        );

        // Wait for storage to hydrate and tokens to be available
        await vi.waitFor(
          async () => {
            const tokens = await client.getOAuthTokens();
            if (!tokens) {
              throw new Error("Tokens not yet loaded from storage");
            }
            return tokens;
          },
          { timeout: 2000, interval: 50 },
        );

        // Should be able to connect without re-authenticating
        await client.connect();
        expect(client.getStatus()).toBe("connected");

        // Tokens should be loaded from remote storage
        const tokens2 = await client.getOAuthTokens();
        expect(tokens2).toBeDefined();
        expect(tokens2?.access_token).toBe(tokens1?.access_token);
      });
    },
  );

  describe.each(transports)(
    "DCR (Dynamic Client Registration) Mode ($name)",
    (transport) => {
      it("should register client and complete OAuth flow using remote storage", async () => {
        await setupRemoteServer();

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true,
          }),
        };

        mcpServer = new TestServerHttp(serverConfig);
        const port = await mcpServer.start();
        const serverUrl = `http://localhost:${port}`;

        const createTransport = createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteFetch = createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        });
        const remoteStorage = new RemoteOAuthStorage({
          baseUrl: remoteBaseUrl!,
          storeId: "oauth",
          authToken: remoteAuthToken!,
        });

        const oauthConfig = createOAuthClientConfig({
          mode: "dcr",
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransport,
          fetchFn: remoteFetch,
          oauth: {
            ...oauthConfig,
            storage: remoteStorage,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        // Verify tokens are stored
        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();

        expect(client.getStatus()).toBe("connected");
      });
    },
  );
});
