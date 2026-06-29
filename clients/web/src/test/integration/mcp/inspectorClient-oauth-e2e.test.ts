/**
 * End-to-end OAuth tests for InspectorClient
 * These tests require a test server with OAuth enabled
 * Tests are parameterized to run against both SSE and streamable-http transports
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { FetchRequestLogState } from "@inspector/core/mcp/state/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  TestServerHttp,
  waitForOAuthWellKnown,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
  getDCRRequests,
  invalidateAccessToken,
} from "@modelcontextprotocol/inspector-test-server";
import { flushStoreFileWrites } from "@inspector/core/storage/store-io.js";
import {
  createOAuthClientConfig,
  completeOAuthAuthorization,
  createClientMetadataServer,
  type ClientMetadataDocument,
} from "../helpers/oauth-client-fixtures.js";
import {
  clearAllOAuthClientState,
  NodeOAuthStorage,
} from "@inspector/core/auth/node/index.js";
import type { InspectorClientOptions } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const oauthTestStatePath = path.join(
  os.tmpdir(),
  `mcp-oauth-${process.pid}-inspectorClient-oauth-e2e.json`,
);

function createTestOAuthConfig(
  options: Parameters<typeof createOAuthClientConfig>[0],
) {
  return {
    ...createOAuthClientConfig(options),
    storage: new NodeOAuthStorage(oauthTestStatePath),
  };
}

interface TransportConfig {
  name: string;
  serverType: "sse" | "streamable-http";
  clientType: "sse" | "streamable-http";
  endpoint: string; // "/sse" or "/mcp"
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

describe("InspectorClient OAuth E2E", () => {
  let server: TestServerHttp;
  let client: InspectorClient;
  const testRedirectUrl = "http://localhost:3001/oauth/callback";

  afterAll(async () => {
    try {
      await fs.unlink(oauthTestStatePath);
    } catch {
      // Ignore if file does not exist or already removed
    }
  });

  beforeEach(() => {
    clearOAuthTestData();
    clearAllOAuthClientState();
    // Capture console.log output instead of printing to stdout during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.stop();
    }
    // Restore console.log after each test
    vi.restoreAllMocks();
  });

  describe.each(transports)(
    "Static/Preregistered Client Mode ($name)",
    (transport) => {
      it("should complete OAuth flow with static client", async () => {
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

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        // Create client with static OAuth config
        const oauthConfig = createTestOAuthConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const stateAfterAuth = client.getOAuthFlowState();
        expect(stateAfterAuth?.oauthStep).toBe("authorization_code");
        expect(stateAfterAuth?.authorizationUrl?.href).toBe(authUrl.href);
        expect(stateAfterAuth?.oauthClientInfo).toBeDefined();
        expect(stateAfterAuth?.oauthClientInfo?.client_id).toBe(staticClientId);

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthFlowState();
        expect(stateAfterComplete?.oauthStep).toBe("complete");
        expect(stateAfterComplete?.oauthTokens).toBeDefined();
        expect(stateAfterComplete?.completedAt).toBeDefined();

        // Verify tokens are stored
        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(tokens?.token_type).toBe("Bearer");

        // Connection should now be successful
        expect(client.getStatus()).toBe("connected");
      });

      it("should retry original request after OAuth completion", async () => {
        const staticClientId = "test-static-client-2";
        const staticClientSecret = "test-static-secret-2";

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true,
            staticClients: [
              {
                clientId: staticClientId,
                clientSecret: staticClientSecret,
                redirectUris: [testRedirectUrl],
              },
            ],
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // Auth-provider flow: authenticate first, complete OAuth, then connect.
        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        expect(client.getStatus()).toBe("connected");
        const toolsResult = await client.listTools();
        expect(toolsResult).toBeDefined();
      });
    },
  );

  describe.each(transports)(
    "CIMD (Client ID Metadata Documents) Mode ($name)",
    (transport) => {
      let metadataServer: { url: string; stop: () => Promise<void> } | null =
        null;

      afterEach(async () => {
        if (metadataServer) {
          await metadataServer.stop();
          metadataServer = null;
        }
      });

      it("should complete OAuth flow with CIMD client", async () => {
        const testRedirectUrl = "http://localhost:3001/oauth/callback";

        // Create client metadata document
        const clientMetadata: ClientMetadataDocument = {
          redirect_uris: [testRedirectUrl],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "MCP Inspector Test Client",
          client_uri: "https://github.com/modelcontextprotocol/inspector",
          scope: "mcp",
        };

        // Start metadata server
        metadataServer = await createClientMetadataServer(clientMetadata);
        const metadataUrl = metadataServer.url;

        // Create test server with OAuth enabled and CIMD support
        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportCIMD: true,
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        // Create client with CIMD config
        const oauthConfig = createTestOAuthConfig({
          mode: "cimd",
          clientMetadataUrl: metadataUrl,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // CIMD pre-registration via authenticate() (supports http:// test metadata URLs)
        const authUrl = await client.authenticate();
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

      it("should retry original request after OAuth completion with CIMD", async () => {
        const testRedirectUrl = "http://localhost:3001/oauth/callback";

        const clientMetadata: ClientMetadataDocument = {
          redirect_uris: [testRedirectUrl],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "MCP Inspector Test Client",
          scope: "mcp",
        };

        metadataServer = await createClientMetadataServer(clientMetadata);
        const metadataUrl = metadataServer.url;

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportCIMD: true,
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "cimd",
          clientMetadataUrl: metadataUrl,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        expect(client.getStatus()).toBe("connected");
        const toolsResult = await client.listTools();
        expect(toolsResult).toBeDefined();
      });
    },
  );

  describe.each(transports)(
    "DCR (Dynamic Client Registration) Mode ($name)",
    (transport) => {
      it("should register client and complete OAuth flow", async () => {
        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true,
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "dcr",
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const stateAfterAuth = client.getOAuthFlowState();
        expect(stateAfterAuth?.oauthStep).toBe("authorization_code");
        expect(stateAfterAuth?.oauthClientInfo).toBeDefined();
        expect(stateAfterAuth?.oauthClientInfo?.client_id).toBeDefined();

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthFlowState();
        expect(stateAfterComplete?.oauthStep).toBe("complete");
        expect(stateAfterComplete?.oauthTokens).toBeDefined();
        expect(stateAfterComplete?.completedAt).toBeDefined();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });
    },
  );

  describe.each(transports)(
    "Single redirect URL (DCR) ($name)",
    (transport) => {
      const redirectUrl = testRedirectUrl;

      it("should include single redirect_uri in DCR registration", async () => {
        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true,
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "dcr",
          redirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const dcr = getDCRRequests();
        expect(dcr.length).toBeGreaterThanOrEqual(1);
        const uris = dcr[dcr.length - 1]!.redirect_uris;
        expect(uris).toEqual([redirectUrl]);
      });

      it("should accept single redirect_uri on re-authentication", async () => {
        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true,
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "dcr",
          redirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrlFirst = await client.authenticate();
        if (!authUrlFirst) throw new Error("Expected authorization URL");
        const authCodeFirst = await completeOAuthAuthorization(authUrlFirst);
        await client.completeOAuthFlow(authCodeFirst);
        await client.connect();
        expect(client.getStatus()).toBe("connected");

        await client.disconnect();
        client.clearOAuthTokens();

        const authUrlSecond = await client.authenticate();
        if (!authUrlSecond) throw new Error("Expected authorization URL");
        const authCodeSecond = await completeOAuthAuthorization(authUrlSecond);
        await client.completeOAuthFlow(authCodeSecond);
        await client.connect();
        expect(client.getStatus()).toBe("connected");
      });
    },
  );

  describe.each(transports)("401 Error Handling ($name)", (transport) => {
    it("should dispatch oauthAuthorizationRequired when authenticating", async () => {
      const staticClientId = "test-client-401";
      const staticClientSecret = "test-secret-401";

      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: transport.serverType,
        ...createOAuthTestServerConfig({
          requireAuth: true,
          supportDCR: true,
          staticClients: [
            {
              clientId: staticClientId,
              clientSecret: staticClientSecret,
              redirectUris: [testRedirectUrl],
            },
          ],
        }),
      };

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      let authEventReceived = false;
      client.addEventListener("oauthAuthorizationRequired", (event) => {
        authEventReceived = true;
        expect(event.detail.url).toBeInstanceOf(URL);
      });

      await client.authenticate();
      expect(authEventReceived).toBe(true);
    });

    it("should not open the browser during connect when no tokens are stored", async () => {
      const staticClientId = "test-client-connect-no-nav";
      const staticClientSecret = "test-secret-connect-no-nav";

      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: transport.serverType,
        ...createOAuthTestServerConfig({
          requireAuth: true,
          supportDCR: true,
          staticClients: [
            {
              clientId: staticClientId,
              clientSecret: staticClientSecret,
              redirectUris: [testRedirectUrl],
            },
          ],
        }),
      };

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const navigate = vi.fn();
      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      oauthConfig.navigation = { navigateToAuthorization: navigate };

      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      await expect(client.connect()).rejects.toThrow();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("should connect on retry after OAuth without disconnect", async () => {
      const staticClientId = "test-client-connect-retry-no-disconnect";
      const staticClientSecret = "test-secret-connect-retry-no-disconnect";

      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: transport.serverType,
        ...createOAuthTestServerConfig({
          requireAuth: true,
          supportDCR: true,
          staticClients: [
            {
              clientId: staticClientId,
              clientSecret: staticClientSecret,
              redirectUris: [testRedirectUrl],
            },
          ],
        }),
      };

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const navigate = vi.fn();
      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      oauthConfig.navigation = { navigateToAuthorization: navigate };

      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      await expect(client.connect()).rejects.toThrow();
      expect(navigate).not.toHaveBeenCalled();

      const authUrl = await client.authenticate();
      if (!authUrl) throw new Error("Expected authorization URL");
      const authCode = await completeOAuthAuthorization(authUrl);
      await client.completeOAuthFlow(authCode);

      await client.connect();
      expect(await client.isOAuthAuthorized()).toBe(true);
    });
  });

  describe.each(transports)(
    "Token refresh (authProvider) ($name)",
    (transport) => {
      it("should persist refresh_token and succeed connect after 401 via refresh", async () => {
        const staticClientId = "test-refresh";
        const staticClientSecret = "test-secret-refresh";

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportRefreshTokens: true,
            staticClients: [
              {
                clientId: staticClientId,
                clientSecret: staticClientSecret,
                redirectUris: [testRedirectUrl],
              },
            ],
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;
        await waitForOAuthWellKnown(serverUrl);
        await waitForOAuthWellKnown(serverUrl);

        const oauthConfig = createTestOAuthConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        });
        const clientConfig: InspectorClientOptions = {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
          },
          oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            clientMetadataUrl: oauthConfig.clientMetadataUrl,
            scope: oauthConfig.scope,
          },
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(tokens?.refresh_token).toBeDefined();

        invalidateAccessToken(tokens!.access_token);

        await client.disconnect();
        await client.connect();

        expect(client.getStatus()).toBe("connected");
        const toolsResult = await client.listTools();
        expect(toolsResult).toBeDefined();
      });
    },
  );

  describe.each(transports)("Token Management ($name)", (transport) => {
    it("should store and retrieve OAuth tokens", async () => {
      const staticClientId = "test-client-tokens";
      const staticClientSecret = "test-secret-tokens";

      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: transport.serverType,
        ...createOAuthTestServerConfig({
          requireAuth: true,
          supportDCR: true,
          staticClients: [
            {
              clientId: staticClientId,
              clientSecret: staticClientSecret,
              redirectUris: [testRedirectUrl],
            },
          ],
        }),
      };

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      const authUrl = await client.authenticate();
      if (!authUrl) throw new Error("Expected authorization URL");
      const authCode = await completeOAuthAuthorization(authUrl);
      await client.completeOAuthFlow(authCode);
      await client.connect();

      const tokens = await client.getOAuthTokens();
      expect(tokens).toBeDefined();
      expect(tokens?.access_token).toBeDefined();
      expect(await client.isOAuthAuthorized()).toBe(true);

      client.clearOAuthTokens();
      expect(await client.isOAuthAuthorized()).toBe(false);
      expect(await client.getOAuthTokens()).toBeUndefined();
    });
  });

  describe.each(transports)("Storage path (custom) ($name)", (transport) => {
    it("should persist OAuth state to custom storagePath", async () => {
      const customPath = path.join(
        os.tmpdir(),
        `mcp-inspector-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      );

      const staticClientId = "test-storage-path";
      const staticClientSecret = "test-secret-sp";

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

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: new NodeOAuthStorage(customPath),
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      try {
        const authUrl = await client.authenticate();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        expect(client.getStatus()).toBe("connected");

        type StateShape = {
          state?: {
            servers?: Record<string, { tokens?: { access_token?: string } }>;
          };
        };
        // Persistence is fire-and-forget; await the write rather than polling.
        await flushStoreFileWrites(customPath);
        const parsed = JSON.parse(
          await fs.readFile(customPath, "utf-8"),
        ) as StateShape;
        const servers = parsed.state?.servers ?? {};
        expect(Object.keys(servers).length).toBeGreaterThan(0);
        expect(
          Object.values(servers).some((s) => !!s?.tokens?.access_token),
        ).toBe(true);
      } finally {
        try {
          await fs.unlink(customPath);
        } catch {
          /* ignore */
        }
      }
    });
  });

  describe("fetchFn integration", () => {
    it("should use provided fetchFn for OAuth HTTP requests", async () => {
      const tracker: Array<{ url: string; method: string }> = [];
      const fetchFn: typeof fetch = (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        tracker.push({
          url: typeof input === "string" ? input : input.toString(),
          method: init?.method ?? "GET",
        });
        return fetch(input, init);
      };

      const staticClientId = "test-fetchFn-client";
      const staticClientSecret = "test-fetchFn-secret";
      const transport = transports[0]!;

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

      server = new TestServerHttp(serverConfig);
      const port = await server.start();
      const serverUrl = `http://localhost:${port}`;
      await waitForOAuthWellKnown(serverUrl);

      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      });
      const clientConfig: InspectorClientOptions = {
        environment: {
          transport: createTransportNode,
          fetch: fetchFn,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );
      const fetchRequestLogState = new FetchRequestLogState(client);

      const authUrl = await client.authenticate();
      if (!authUrl) throw new Error("Expected authorization URL");
      expect(authUrl.href).toContain("/oauth/authorize");

      const authCode = await completeOAuthAuthorization(authUrl);
      await client.completeOAuthFlow(authCode);
      await client.connect();

      expect(client.getStatus()).toBe("connected");

      expect(tracker.length).toBeGreaterThan(0);
      const oauthUrls = tracker.filter(
        (c) =>
          c.url.includes("well-known") ||
          c.url.includes("/oauth/") ||
          c.url.includes("token"),
      );
      expect(oauthUrls.length).toBeGreaterThan(0);

      // Verify fetch tracking categories: auth vs transport
      const fetchRequests = fetchRequestLogState.getFetchRequests();
      const authFetches = fetchRequests.filter((r) => r.category === "auth");
      const transportFetches = fetchRequests.filter(
        (r) => r.category === "transport",
      );
      expect(authFetches.length).toBeGreaterThan(0);
      expect(transportFetches.length).toBeGreaterThan(0);
    });
  });
});
