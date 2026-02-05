/**
 * End-to-end OAuth tests for InspectorClient
 * These tests require a test server with OAuth enabled
 * Tests are parameterized to run against both SSE and streamable-http transports
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createTransportNode } from "../mcp/transport.js";
import { TestServerHttp } from "../test/test-server-http.js";
import { waitForStateFile } from "../test/test-helpers.js";
import { getDefaultServerConfig } from "../test/test-server-fixtures.js";
import {
  createOAuthTestServerConfig,
  createOAuthClientConfig,
  completeOAuthAuthorization,
  createClientMetadataServer,
  type ClientMetadataDocument,
} from "../test/test-server-fixtures.js";
import {
  clearOAuthTestData,
  getDCRRequests,
  invalidateAccessToken,
} from "../test/test-server-oauth.js";
import { clearAllOAuthClientState, NodeOAuthStorage } from "../auth/index.js";
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

        // Create client with static OAuth config
        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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
          transportClientFactory: createTransportNode,
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

        const stateAfterAuth = client.getOAuthState();
        expect(stateAfterAuth?.authType).toBe("normal");
        expect(stateAfterAuth?.oauthStep).toBe("authorization_code");
        expect(stateAfterAuth?.authorizationUrl?.href).toBe(authUrl.href);
        expect(stateAfterAuth?.oauthClientInfo).toBeDefined();
        expect(stateAfterAuth?.oauthClientInfo?.client_id).toBe(staticClientId);

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthState();
        expect(stateAfterComplete?.authType).toBe("normal");
        expect(stateAfterComplete?.oauthStep).toBe("complete");
        expect(stateAfterComplete?.oauthTokens).toBeDefined();
        expect(stateAfterComplete?.completedAt).toBeDefined();
        expect(typeof stateAfterComplete?.completedAt).toBe("number");

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
          transportClientFactory: createTransportNode,
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

        // Create client with CIMD config
        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        const authUrl = await client.runGuidedAuth();
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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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
          transportClientFactory: createTransportNode,
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

        const stateAfterAuth = client.getOAuthState();
        expect(stateAfterAuth?.authType).toBe("normal");
        expect(stateAfterAuth?.oauthStep).toBe("authorization_code");
        expect(stateAfterAuth?.oauthClientInfo).toBeDefined();
        expect(stateAfterAuth?.oauthClientInfo?.client_id).toBeDefined();

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthState();
        expect(stateAfterComplete?.authType).toBe("normal");
        expect(stateAfterComplete?.oauthStep).toBe("complete");
        expect(stateAfterComplete?.oauthTokens).toBeDefined();
        expect(stateAfterComplete?.completedAt).toBeDefined();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("should register client and complete OAuth flow using runGuidedAuth() (automated guided mode)", async () => {
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
          transportClientFactory: createTransportNode,
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

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthState();
        expect(stateAfterComplete?.authType).toBe("guided");
        expect(stateAfterComplete?.oauthStep).toBe("complete");
        expect(stateAfterComplete?.completedAt).toBeDefined();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("should complete OAuth flow using manual guided mode (beginGuidedAuth + proceedOAuthStep)", async () => {
        const staticClientId = "test-static-manual";
        const staticClientSecret = "test-static-secret-manual";

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        await client.beginGuidedAuth();

        while (true) {
          const state = client.getOAuthState();
          if (
            state?.oauthStep === "authorization_code" ||
            state?.oauthStep === "complete"
          ) {
            break;
          }
          await client.proceedOAuthStep();
        }

        const state = client.getOAuthState();
        const authUrl = state?.authorizationUrl;
        if (!authUrl) throw new Error("Expected authorizationUrl");
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const stateAfterComplete = client.getOAuthState();
        expect(stateAfterComplete?.authType).toBe("guided");
        expect(stateAfterComplete?.oauthStep).toBe("complete");

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("runGuidedAuth continues from already-started guided flow", async () => {
        const staticClientId = "test-run-from-started";
        const staticClientSecret = "test-secret-run-from-started";

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        await client.beginGuidedAuth();
        await client.proceedOAuthStep();

        const stateBeforeRun = client.getOAuthState();
        expect(stateBeforeRun?.oauthStep).not.toBe("authorization_code");
        expect(stateBeforeRun?.oauthStep).not.toBe("complete");

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        expect(authUrl.href).toContain("/oauth/authorize");

        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        const tokens = await client.getOAuthTokens();
        expect(tokens).toBeDefined();
        expect(tokens?.access_token).toBeDefined();
        expect(client.getStatus()).toBe("connected");
      });

      it("runGuidedAuth returns undefined when already complete", async () => {
        const staticClientId = "test-run-complete";
        const staticClientSecret = "test-secret-run-complete";

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);

        const stateAfterComplete = client.getOAuthState();
        expect(stateAfterComplete?.oauthStep).toBe("complete");

        const authUrlAgain = await client.runGuidedAuth();
        expect(authUrlAgain).toBeUndefined();
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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
          oauth: createOAuthClientConfig({
            mode: "dcr",
            redirectUrl,
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

        const dcr = getDCRRequests();
        expect(dcr.length).toBeGreaterThanOrEqual(1);
        const uris = dcr[dcr.length - 1]!.redirect_uris;
        expect(uris).toEqual([redirectUrl]);
      });

      it("should accept single redirect_uri for both normal and guided auth", async () => {
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
          transportClientFactory: createTransportNode,
          oauth: createOAuthClientConfig({
            mode: "dcr",
            redirectUrl,
          }),
        };

        client = new InspectorClient(
          {
            type: transport.clientType,
            url: `${serverUrl}${transport.endpoint}`,
          } as MCPServerConfig,
          clientConfig,
        );

        const authUrlNormal = await client.authenticate();
        const authCodeNormal = await completeOAuthAuthorization(authUrlNormal);
        await client.completeOAuthFlow(authCodeNormal);
        await client.connect();
        expect(client.getStatus()).toBe("connected");

        await client.disconnect();

        const authUrlGuided = await client.runGuidedAuth();
        if (!authUrlGuided) throw new Error("Expected authorization URL");
        const authCodeGuided = await completeOAuthAuthorization(authUrlGuided);
        await client.completeOAuthFlow(authCodeGuided);
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

      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
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

  describe.each(transports)(
    "Resource metadata discovery and oauthStepChange ($name)",
    (transport) => {
      it("should discover resource metadata and set resource in guided flow", async () => {
        const staticClientId = "test-resource-metadata";
        const staticClientSecret = "test-secret-rm";

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        await client.runGuidedAuth();

        const state = client.getOAuthState();
        expect(state).toBeDefined();
        expect(state?.authType).toBe("guided");
        expect(state?.resourceMetadata).toBeDefined();
        expect(state?.resourceMetadata?.resource).toBeDefined();
        expect(
          state?.resourceMetadata?.authorization_servers?.length,
        ).toBeGreaterThanOrEqual(1);
        expect(state?.resourceMetadata?.scopes_supported).toBeDefined();
        expect(state?.resource).toBeInstanceOf(URL);
        expect(state?.resource?.href).toBe(state?.resourceMetadata?.resource);
        expect(state?.resourceMetadataError).toBeNull();
      });

      it("should dispatch oauthStepChange on each step transition in guided flow", async () => {
        const staticClientId = "test-step-events";
        const staticClientSecret = "test-secret-se";

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

        const stepEvents: Array<{
          step: string;
          previousStep: string;
          state: unknown;
        }> = [];
        client.addEventListener("oauthStepChange", (event) => {
          stepEvents.push({
            step: event.detail.step,
            previousStep: event.detail.previousStep,
            state: event.detail.state,
          });
        });

        const authUrl = await client.runGuidedAuth();
        if (!authUrl) throw new Error("Expected authorization URL");
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);

        const expectedTransitions = [
          { previousStep: "metadata_discovery", step: "client_registration" },
          {
            previousStep: "client_registration",
            step: "authorization_redirect",
          },
          {
            previousStep: "authorization_redirect",
            step: "authorization_code",
          },
          { previousStep: "authorization_code", step: "token_request" },
          { previousStep: "token_request", step: "complete" },
        ];

        expect(stepEvents.length).toBe(expectedTransitions.length);
        for (let i = 0; i < expectedTransitions.length; i++) {
          const e = stepEvents[i];
          expect(e).toBeDefined();
          expect(e?.step).toBe(expectedTransitions[i]!.step);
          expect(e?.previousStep).toBe(expectedTransitions[i]!.previousStep);
          expect(e?.state).toBeDefined();
          expect(typeof e?.state === "object" && e?.state !== null).toBe(true);
        }

        const finalState = client.getOAuthState();
        expect(finalState?.authType).toBe("guided");
        expect(finalState?.oauthStep).toBe("complete");
        expect(finalState?.oauthTokens).toBeDefined();
        expect(finalState?.completedAt).toBeDefined();
        expect(typeof finalState?.completedAt).toBe("number");
      });
    },
  );

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

        const clientConfig: InspectorClientOptions = {
          transportClientFactory: createTransportNode,
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

      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
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

      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
        oauth: {
          ...createOAuthClientConfig({
            mode: "static",
            clientId: staticClientId,
            clientSecret: staticClientSecret,
            redirectUrl: testRedirectUrl,
          }),
          storage: new NodeOAuthStorage(customPath),
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
        const authCode = await completeOAuthAuthorization(authUrl);
        await client.completeOAuthFlow(authCode);
        await client.connect();

        expect(client.getStatus()).toBe("connected");

        type StateShape = {
          state?: {
            servers?: Record<string, { tokens?: { access_token?: string } }>;
          };
        };
        const parsed = await waitForStateFile<StateShape>(
          customPath,
          (p) => {
            const servers = (p as StateShape)?.state?.servers ?? {};
            return Object.values(servers).some(
              (s) =>
                !!(s as { tokens?: { access_token?: string } })?.tokens
                  ?.access_token,
            );
          },
          { timeout: 2000, interval: 50 },
        );
        expect(Object.keys(parsed.state?.servers ?? {}).length).toBeGreaterThan(
          0,
        );
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

      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
        fetchFn,
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

      const authUrl = await client.runGuidedAuth();
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
      const fetchRequests = client.getFetchRequests();
      const authFetches = fetchRequests.filter((r) => r.category === "auth");
      const transportFetches = fetchRequests.filter(
        (r) => r.category === "transport",
      );
      expect(authFetches.length).toBeGreaterThan(0);
      expect(transportFetches.length).toBeGreaterThan(0);
    });
  });
});
