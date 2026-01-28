/**
 * End-to-end OAuth tests for InspectorClient
 * These tests require a test server with OAuth enabled
 * Tests are parameterized to run against both SSE and streamable-http transports
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { TestServerHttp } from "../test/test-server-http.js";
import { getDefaultServerConfig } from "../test/test-server-fixtures.js";
import {
  createOAuthTestServerConfig,
  createOAuthClientConfig,
  completeOAuthAuthorization,
  createClientMetadataServer,
  type ClientMetadataDocument,
} from "../test/test-server-fixtures.js";
import { clearOAuthTestData } from "../test/test-server-oauth.js";
import { clearAllOAuthClientState } from "../auth/index.js";
import type { InspectorClientOptions } from "../mcp/inspectorClient.js";
import type { MCPServerConfig } from "../mcp/types.js";

type TransportType = "sse" | "streamable-http";

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
        const guidedRedirectUrl = "http://localhost:3001/oauth/callback/guided";

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
                redirectUris: [testRedirectUrl, guidedRedirectUrl],
              },
            ],
          }),
        };

        server = new TestServerHttp(serverConfig);
        const port = await server.start();
        const serverUrl = `http://localhost:${port}`;

        // Create client with static OAuth config
        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "static",
            clientId: staticClientId,
            clientSecret: staticClientSecret,
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticateGuided();
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

      it("should complete OAuth flow with static client using authenticate() (normal mode)", async () => {
        const staticClientId = "test-static-client-normal";
        const staticClientSecret = "test-static-secret-normal";

        const serverConfig = {
          ...getDefaultServerConfig(),
          serverType: transport.serverType,
          ...createOAuthTestServerConfig({
            requireAuth: true,
            supportDCR: true, // Needed for authenticate() to work
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "static",
            clientId: staticClientId,
            clientSecret: staticClientSecret,
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // Use authenticate() (normal mode) - should use SDK's auth()
        const authUrl = await client.authenticate();
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(tokens?.token_type).toBe("Bearer");
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "static",
            clientId: staticClientId,
            clientSecret: staticClientSecret,
            redirectUrl: testRedirectUrl,
          }),
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
        const guidedRedirectUrl = "http://localhost:3001/oauth/callback/guided";

        // Create client metadata document (guided mode uses .../callback/guided)
        const clientMetadata: ClientMetadataDocument = {
          redirect_uris: [testRedirectUrl, guidedRedirectUrl],
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

        // Create client with CIMD config
        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "cimd",
            clientMetadataUrl: metadataUrl,
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // CIMD uses guided mode (HTTP clientMetadataUrl); auth() requires HTTPS
        const authUrl = await client.authenticateGuided();
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
        const guidedRedirectUrl = "http://localhost:3001/oauth/callback/guided";

        const clientMetadata: ClientMetadataDocument = {
          redirect_uris: [testRedirectUrl, guidedRedirectUrl],
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "cimd",
            clientMetadataUrl: metadataUrl,
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticateGuided();
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "dcr",
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrl = await client.authenticate();
        expect(authUrl.href).toContain("/oauth/authorize");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("should register client and complete OAuth flow using authenticate() (normal mode)", async () => {
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "dcr",
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // Use authenticate() (normal mode) - should trigger DCR via SDK's auth()
        const authUrl = await client.authenticate();
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("should register client and complete OAuth flow using authenticateGuided() (guided mode)", async () => {
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

        const clientConfig: InspectorClientOptions = {
          oauth: createOAuthClientConfig({
            mode: "dcr",
            redirectUrl: testRedirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        // Use authenticateGuided() (guided mode) - should trigger DCR via state machine
        const authUrl = await client.authenticateGuided();
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
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

      const clientConfig: InspectorClientOptions = {
        oauth: createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        }),
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
  });

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

      const clientConfig: InspectorClientOptions = {
        oauth: createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        }),
      };

      client = new InspectorClient(
        {
          type: transport.clientType,
          url: `${serverUrl}${transport.endpoint}`,
        } as MCPServerConfig,
        clientConfig,
      );

      const authUrl = await client.authenticate();
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
});
