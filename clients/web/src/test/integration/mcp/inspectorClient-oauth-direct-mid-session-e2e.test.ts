/**
 * Mid-session OAuth recovery over direct (TUI/CLI) transport.
 * Uses createAuthChallengeInterceptFetch + handleAuthChallenge on InspectorClient.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import {
  TestServerHttp,
  waitForOAuthWellKnown,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
  invalidateAccessToken,
} from "@modelcontextprotocol/inspector-test-server";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import {
  createOAuthClientConfig,
  completeOAuthAuthorization,
} from "../helpers/oauth-client-fixtures.js";
import { ConsoleNavigation } from "@inspector/core/auth/providers.js";
import type { InspectorClientOptions } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const oauthTestStatePath = join(
  tmpdir(),
  `mcp-oauth-${process.pid}-direct-mid-session-e2e.json`,
);

function createTestOAuthConfig(
  options: Parameters<typeof createOAuthClientConfig>[0],
) {
  return {
    ...createOAuthClientConfig(options),
    storage: new NodeOAuthStorage(oauthTestStatePath),
  };
}

describe("InspectorClient direct mid-session OAuth", () => {
  let mcpServer: TestServerHttp | null = null;
  const testRedirectUrl = "http://localhost:3000/oauth/callback";

  beforeEach(() => {
    clearOAuthTestData();
  });

  afterEach(async () => {
    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = null;
    }
  }, 30_000);

  afterAll(() => {
    try {
      rmSync(oauthTestStatePath, { force: true });
    } catch {
      // ignore
    }
  });

  it("recovers from invalidated access token after connect via silent refresh without disconnect", async () => {
    const staticClientId = "test-direct-mid-session";
    const staticClientSecret = "test-secret-direct-mid-session";

    const serverConfig = {
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
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

    mcpServer = new TestServerHttp(serverConfig);
    const port = await mcpServer.start();
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
          navigation: new ConsoleNavigation(),
          redirectUrlProvider: oauthConfig.redirectUrlProvider,
        },
      },
      directAuthRecovery: true,
      oauth: {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        clientMetadataUrl: oauthConfig.clientMetadataUrl,
        scope: oauthConfig.scope,
      },
    };

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    {
      const { code, iss } = await completeOAuthAuthorization(authUrl);
      await client.completeOAuthFlow(code, iss);
    }
    await client.connect();

    const tokens = await client.getOAuthTokens();
    expect(tokens?.refresh_token).toBeDefined();
    invalidateAccessToken(tokens!.access_token);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);
    expect(client.getStatus()).toBe("connected");

    await client.disconnect();
  }, 30_000);

  it("step-up after insufficient_scope throws AuthRecoveryRequiredError then succeeds after OAuth", async () => {
    const staticClientId = "test-direct-step-up";
    const staticClientSecret = "test-secret-direct-step-up";

    const baseConfig = getDefaultServerConfig();
    const serverConfig = {
      ...baseConfig,
      serverType: "streamable-http" as const,
      tools: baseConfig.tools!.map((tool) =>
        tool.name === "get_temp"
          ? { ...tool, requiredScopes: ["weather:read"] }
          : tool,
      ),
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

    mcpServer = new TestServerHttp(serverConfig);
    const port = await mcpServer.start();
    const serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);

    const oauthConfig = createTestOAuthConfig({
      mode: "static",
      clientId: staticClientId,
      clientSecret: staticClientSecret,
      redirectUrl: testRedirectUrl,
      scope: "mcp tools:read",
    });

    const clientConfig: InspectorClientOptions = {
      environment: {
        transport: createTransportNode,
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
          redirectUrlProvider: oauthConfig.redirectUrlProvider,
        },
      },
      directAuthRecovery: true,
      oauth: {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        clientMetadataUrl: oauthConfig.clientMetadataUrl,
        scope: oauthConfig.scope,
      },
    };

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    {
      const { code, iss } = await completeOAuthAuthorization(authUrl);
      await client.completeOAuthFlow(code, iss);
    }
    await client.connect();

    const toolsResult = await client.listTools();
    const getTempTool = toolsResult.tools.find((t) => t.name === "get_temp");
    expect(getTempTool).toBeDefined();

    let recovery: AuthRecoveryRequiredError | undefined;
    try {
      await client.callTool(getTempTool!, { city: "NYC", units: "C" });
    } catch (error) {
      if (error instanceof AuthRecoveryRequiredError) {
        recovery = error;
      } else {
        throw error;
      }
    }
    expect(recovery?.authChallenge.reason).toBe("insufficient_scope");
    expect(recovery!.authorizationUrl.searchParams.get("scope")).toContain(
      "weather:read",
    );

    const { code: stepUpCode, iss: stepUpCodeIss } =
      await completeOAuthAuthorization(recovery!.authorizationUrl);
    await client.completeOAuthFlow(stepUpCode, stepUpCodeIss);

    const result = await client.callTool(getTempTool!, {
      city: "NYC",
      units: "C",
    });
    expect(result.success).toBe(true);

    await client.disconnect();
  }, 30_000);
});
