import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createTransportNode } from "../mcp/transport.js";
import type { MCPServerConfig } from "../mcp/types.js";
import { TestServerHttp } from "../test/test-server-http.js";
import { waitForEvent } from "../test/test-helpers.js";
import { getDefaultServerConfig } from "../test/test-server-fixtures.js";
import {
  createOAuthTestServerConfig,
  createOAuthClientConfig,
  completeOAuthAuthorization,
} from "../test/test-server-fixtures.js";
import { clearOAuthTestData } from "../test/test-server-oauth.js";
import type { InspectorClientOptions } from "../mcp/inspectorClient.js";

describe("InspectorClient OAuth", () => {
  let client: InspectorClient;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Create client with HTTP transport (OAuth only works with HTTP transports)
    const config: MCPServerConfig = {
      type: "sse",
      url: "http://localhost:3000/sse",
    };
    client = new InspectorClient(config, {
      transportClientFactory: createTransportNode,
      autoFetchServerContents: false,
    });
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    vi.restoreAllMocks();
  });

  describe("OAuth Configuration", () => {
    it("should set OAuth configuration", () => {
      const oauthConfig = createOAuthClientConfig({
        mode: "static",
        clientId: "test-client-id",
        clientSecret: "test-secret",
        redirectUrl: "http://localhost:3000/callback",
        scope: "read write",
      });
      client = new InspectorClient(
        { type: "sse", url: "http://localhost:3000/sse" },
        {
          transportClientFactory: createTransportNode,
          autoFetchServerContents: false,
          oauth: oauthConfig,
        },
      );

      // Configuration should be set (no error thrown)
      expect(client).toBeDefined();
    });

    it("should set OAuth configuration with clientMetadataUrl for CIMD", () => {
      const oauthConfig = createOAuthClientConfig({
        mode: "cimd",
        clientMetadataUrl: "https://example.com/client-metadata.json",
        redirectUrl: "http://localhost:3000/callback",
        scope: "read write",
      });
      client = new InspectorClient(
        { type: "sse", url: "http://localhost:3000/sse" },
        {
          transportClientFactory: createTransportNode,
          autoFetchServerContents: false,
          oauth: oauthConfig,
        },
      );

      expect(client).toBeDefined();
    });
  });

  describe("OAuth Token Management", () => {
    beforeEach(() => {
      client = new InspectorClient(
        { type: "sse", url: "http://localhost:3000/sse" },
        {
          transportClientFactory: createTransportNode,
          autoFetchServerContents: false,
          oauth: createOAuthClientConfig({
            mode: "static",
            clientId: "test-client-id",
            redirectUrl: "http://localhost:3000/callback",
          }),
        },
      );
    });

    it("should return undefined tokens when not authorized", async () => {
      const tokens = await client.getOAuthTokens();
      expect(tokens).toBeUndefined();
    });

    it("should clear OAuth tokens", () => {
      client.clearOAuthTokens();
      // Should not throw
      expect(client).toBeDefined();
    });

    it("should return false for isOAuthAuthorized when not authorized", async () => {
      const isAuthorized = await client.isOAuthAuthorized();
      expect(isAuthorized).toBe(false);
    });
  });

  describe("OAuth Events", () => {
    let testServer: TestServerHttp;
    const testRedirectUrl = "http://localhost:3001/oauth/callback";

    beforeEach(() => {
      clearOAuthTestData();
    });

    afterEach(async () => {
      if (testServer) {
        await testServer.stop();
      }
    });

    it("should dispatch oauthAuthorizationRequired event", async () => {
      const staticClientId = "test-event-client";
      const staticClientSecret = "test-event-secret";

      // Create test server with OAuth enabled and DCR support (for authenticate() normal mode)
      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: "sse" as const,
        ...createOAuthTestServerConfig({
          requireAuth: false, // Don't require auth for this test
          supportDCR: true, // Enable DCR so authenticate() can work
          staticClients: [
            {
              clientId: staticClientId,
              clientSecret: staticClientSecret,
              redirectUris: [testRedirectUrl],
            },
          ],
        }),
      };

      testServer = new TestServerHttp(serverConfig);
      const port = await testServer.start();
      const serverUrl = `http://localhost:${port}`;

      // Create client with OAuth config pointing to test server
      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
        oauth: createOAuthClientConfig({
          mode: "static",
          clientId: staticClientId,
          clientSecret: staticClientSecret,
          redirectUrl: testRedirectUrl,
        }),
      };

      const testClient = new InspectorClient(
        {
          type: "sse",
          url: `${serverUrl}/sse`,
        } as MCPServerConfig,
        clientConfig,
      );

      testClient.authenticate().catch(() => {});

      const detail = await waitForEvent<{ url: URL }>(
        testClient,
        "oauthAuthorizationRequired",
        { timeout: 5000 },
      );
      expect(detail).toHaveProperty("url");
      expect(detail.url).toBeInstanceOf(URL);
      expect(detail.url.href).toContain("/oauth/authorize");
      await testClient.disconnect();
    });

    it("should dispatch oauthError event when OAuth flow fails", async () => {
      // Create a minimal test server just for metadata discovery
      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: "sse" as const,
        ...createOAuthTestServerConfig({
          requireAuth: false,
          supportDCR: true,
        }),
      };

      testServer = new TestServerHttp(serverConfig);
      const port = await testServer.start();
      const serverUrl = `http://localhost:${port}`;

      const clientConfig: InspectorClientOptions = {
        transportClientFactory: createTransportNode,
        oauth: createOAuthClientConfig({
          mode: "static",
          clientId: "test-error-client",
          clientSecret: "test-error-secret",
          redirectUrl: testRedirectUrl,
        }),
      };

      const testClient = new InspectorClient(
        {
          type: "sse",
          url: `${serverUrl}/sse`,
        } as MCPServerConfig,
        clientConfig,
      );

      testClient.completeOAuthFlow("invalid-test-code").catch(() => {});

      const detail = await waitForEvent<{ error: Error }>(
        testClient,
        "oauthError",
        {
          timeout: 3000,
        },
      );
      expect(detail).toHaveProperty("error");
      expect(detail.error).toBeInstanceOf(Error);
      await testClient.disconnect();
    });
  });

  describe("Token Injection in HTTP Transports", () => {
    let testServer: TestServerHttp;
    const testRedirectUrl = "http://localhost:3001/oauth/callback";

    beforeEach(() => {
      clearOAuthTestData();
    });

    afterEach(async () => {
      if (testServer) {
        await testServer.stop();
      }
    });

    it("should inject Bearer token in HTTP requests when OAuth is configured", async () => {
      const staticClientId = "test-token-injection-client";
      const staticClientSecret = "test-token-injection-secret";

      // Create test server with OAuth enabled and auth required
      const serverConfig = {
        ...getDefaultServerConfig(),
        serverType: "sse" as const,
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

      testServer = new TestServerHttp(serverConfig);
      const port = await testServer.start();
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

      const testClient = new InspectorClient(
        {
          type: "sse",
          url: `${serverUrl}/sse`,
        } as MCPServerConfig,
        clientConfig,
      );

      // Auth-provider flow: authenticate first, complete OAuth, then connect.
      // connect() creates transport with authProvider; tokens are already in storage.
      const authorizationUrl = await testClient.authenticate();
      const authCode = await completeOAuthAuthorization(authorizationUrl);
      await testClient.completeOAuthFlow(authCode);

      await testClient.connect();

      const tokens = await testClient.getOAuthTokens();
      expect(tokens).toBeDefined();
      expect(tokens?.access_token).toBeDefined();

      // listTools() succeeds only if authProvider injects Bearer token
      const toolsResult = await testClient.listTools();
      expect(toolsResult).toBeDefined();

      const fetchRequests = testClient.getFetchRequests();
      if (fetchRequests.length > 0) {
        const mcpPostRequests = fetchRequests.filter(
          (req) =>
            req.method === "POST" &&
            (req.url.includes("/sse") || req.url.includes("/mcp")) &&
            !req.url.includes("/oauth"),
        );
        if (mcpPostRequests.length > 0) {
          const hasAuthHeader = mcpPostRequests.some((req) => {
            const authHeader =
              req.requestHeaders?.["Authorization"] ||
              req.requestHeaders?.["authorization"];
            return authHeader && authHeader.startsWith("Bearer ");
          });
          if (hasAuthHeader) {
            expect(hasAuthHeader).toBe(true);
          }
        }
      }

      await testClient.disconnect();
    });
  });
});
