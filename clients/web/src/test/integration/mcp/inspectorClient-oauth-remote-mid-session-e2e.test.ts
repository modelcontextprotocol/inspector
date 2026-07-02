/**
 * Mid-session OAuth recovery over the web remote transport.
 * Verifies inline auth_challenge on /api/mcp/send, silent refresh, auth-state push, and retry.
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import { createRemoteFetch } from "@inspector/core/mcp/remote/createRemoteFetch.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
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
  `mcp-oauth-${process.pid}-remote-mid-session-e2e.json`,
);

function createTestOAuthConfig(
  options: Parameters<typeof createOAuthClientConfig>[0],
) {
  return {
    ...createOAuthClientConfig(options),
    storage: new NodeOAuthStorage(oauthTestStatePath),
  };
}

async function startRemoteServer(port: number): Promise<{
  baseUrl: string;
  server: ServerType;
  authToken: string;
}> {
  const { app, authToken } = createRemoteApp({
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

describe("InspectorClient remote mid-session OAuth", () => {
  let remoteServer: ServerType | null = null;
  let mcpServer: TestServerHttp | null = null;
  let remoteBaseUrl: string | undefined;
  let remoteAuthToken: string | undefined;
  const testRedirectUrl = "http://localhost:3000/oauth/callback";

  beforeEach(() => {
    clearOAuthTestData();
  });

  afterEach(async () => {
    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = null;
    }
    if (remoteServer) {
      await new Promise<void>((resolve) => {
        remoteServer!.close(() => resolve());
      });
      remoteServer = null;
    }
    remoteBaseUrl = undefined;
    remoteAuthToken = undefined;
  }, 30_000);

  afterAll(() => {
    try {
      rmSync(oauthTestStatePath, { force: true });
    } catch {
      // ignore
    }
  });

  async function setupRemoteServer(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), "inspector-remote-mid-session-"));
    const { baseUrl, server, authToken } = await startRemoteServer(0);
    remoteBaseUrl = baseUrl;
    remoteAuthToken = authToken;
    remoteServer = server;
    rmSync(tmp, { recursive: true, force: true });
  }

  it("recovers from invalidated access token after connect via silent refresh and auth-state push", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-mid-session";
    const staticClientSecret = "test-secret-mid-session";

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
        transport: createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        fetch: createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    await client.completeOAuthFlow(await completeOAuthAuthorization(authUrl));
    await client.connect();

    const tokens = await client.getOAuthTokens();
    expect(tokens?.refresh_token).toBeDefined();
    invalidateAccessToken(tokens!.access_token);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);
    expect(client.getStatus()).toBe("connected");

    await client.disconnect();
  }, 15_000);

  it("recovers on reconnect when stored access token was invalidated before connect", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-reconnect-mid-session";
    const staticClientSecret = "test-secret-reconnect-mid-session";

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
        transport: createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        fetch: createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    await client.completeOAuthFlow(await completeOAuthAuthorization(authUrl));
    await client.connect();

    const tokens = await client.getOAuthTokens();
    invalidateAccessToken(tokens!.access_token);

    await client.connect();

    expect(client.getStatus()).toBe("connected");
    await client.disconnect();
  });

  it("step-up re-auth after insufficient_scope lets scoped tool succeed", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-step-up";
    const staticClientSecret = "test-secret-step-up";

    const baseConfig = getDefaultServerConfig();
    const serverConfig = {
      ...baseConfig,
      tools: baseConfig.tools!.map((tool) =>
        tool.name === "get_temp"
          ? { ...tool, requiredScopes: ["weather:read"] }
          : tool,
      ),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        scopesSupported: ["mcp", "tools:read", "weather:read"],
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
        transport: createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        fetch: createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    await client.completeOAuthFlow(await completeOAuthAuthorization(authUrl));
    await client.connect();

    const toolsResult = await client.listTools();
    const echoTool = toolsResult.tools.find((t) => t.name === "echo");
    const getTempTool = toolsResult.tools.find((t) => t.name === "get_temp");
    expect(echoTool).toBeDefined();
    expect(getTempTool).toBeDefined();

    await client.callTool(echoTool!, { message: "hello" });

    const remoteSessionId = client.getRemoteBackendSessionId();
    expect(remoteSessionId).toBeDefined();

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

    const mcpServerUrl = `${serverUrl}/mcp`;
    const scopeBeforeStepUp = oauthConfig.storage.getScope(mcpServerUrl);
    expect(scopeBeforeStepUp).toContain("mcp");
    expect(scopeBeforeStepUp).not.toContain("weather:read");

    expect(recovery!.authorizationUrl.searchParams.get("scope")).toContain(
      "weather:read",
    );

    const stepUpCode = await completeOAuthAuthorization(
      recovery!.authorizationUrl,
    );

    // Mirror `/oauth/callback`: new InspectorClient instance, same persisted OAuth
    // storage, reattach to the live remote backend session.
    const callbackClient = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );
    await callbackClient.resumeAfterOAuth(stepUpCode, { remoteSessionId });

    expect(callbackClient.getStatus()).toBe("connected");

    const scopeAfterStepUp = oauthConfig.storage.getScope(mcpServerUrl);
    expect(scopeAfterStepUp).toContain("weather:read");
    expect(scopeAfterStepUp).toContain("mcp");

    const callbackTools = await callbackClient.listTools();
    const callbackGetTemp = callbackTools.tools.find(
      (t) => t.name === "get_temp",
    );
    expect(callbackGetTemp).toBeDefined();

    const result = await callbackClient.callTool(callbackGetTemp!, {
      city: "NYC",
      units: "C",
    });
    expect(result.success).toBe(true);
    const content = result.result?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content?.[0]).toHaveProperty("type", "text");
    expect("text" in content![0] && content![0].text).toContain("25");

    await callbackClient.disconnect();
    await client.disconnect();
  }, 30_000);

  it("resumeAfterOAuth falls back to connect when remote session is dead", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-resume-fallback";
    const staticClientSecret = "test-secret-resume-fallback";

    const serverConfig = {
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        supportRefreshTokens: false,
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
        transport: createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        fetch: createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    const initialCode = await completeOAuthAuthorization(authUrl);
    await client.completeOAuthFlow(initialCode);
    await client.connect();

    const mcpServerUrl = `${serverUrl}/mcp`;
    await oauthConfig.storage.clearTokens(mcpServerUrl);
    const reauthUrl = await client.authenticate();
    if (!reauthUrl) throw new Error("Expected reauth URL");
    const code = await completeOAuthAuthorization(reauthUrl);

    const callbackClient = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );
    const connectSpy = vi.spyOn(callbackClient, "connect");
    await callbackClient.resumeAfterOAuth(code, {
      remoteSessionId: "dead-remote-session-id",
    });
    expect(connectSpy).toHaveBeenCalled();
    connectSpy.mockRestore();

    expect(callbackClient.getStatus()).toBe("connected");
    const toolsResult = await callbackClient.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    await callbackClient.disconnect();
    await client.disconnect();
  }, 30_000);

  it("dispatches authChallengeInteractive for ambient interactive recovery", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-ambient-interactive";
    const staticClientSecret = "test-secret-ambient-interactive";

    const serverConfig = {
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        supportRefreshTokens: false,
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      {
        environment: {
          transport: createRemoteTransport({
            baseUrl: remoteBaseUrl!,
            authToken: remoteAuthToken!,
          }),
          fetch: createRemoteFetch({
            baseUrl: remoteBaseUrl!,
            authToken: remoteAuthToken!,
          }),
          oauth: {
            storage: oauthConfig.storage,
            navigation: new ConsoleNavigation(),
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      },
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    await client.completeOAuthFlow(await completeOAuthAuthorization(authUrl));
    await client.connect();

    const tokens = await client.getOAuthTokens();
    invalidateAccessToken(tokens!.access_token);

    const interactive = vi.fn();
    client.addEventListener("authChallengeInteractive", interactive);

    await client.handleAmbientAuthChallenge({ reason: "token_expired" });

    expect(interactive).toHaveBeenCalledOnce();
    expect(interactive.mock.calls[0]![0].detail.challenge.reason).toBe(
      "token_expired",
    );
    expect(
      interactive.mock.calls[0]![0].detail.authorizationUrl,
    ).toBeInstanceOf(URL);

    await client.disconnect();
  }, 15_000);

  it("recovers from ambient auth notification after idle token invalidation", async () => {
    await setupRemoteServer();

    const staticClientId = "test-remote-ambient-auth";
    const staticClientSecret = "test-secret-ambient-auth";

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
        transport: createRemoteTransport({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        fetch: createRemoteFetch({
          baseUrl: remoteBaseUrl!,
          authToken: remoteAuthToken!,
        }),
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
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

    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      clientConfig,
    );

    const authUrl = await client.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    await client.completeOAuthFlow(await completeOAuthAuthorization(authUrl));
    await client.connect();

    const tokens = await client.getOAuthTokens();
    invalidateAccessToken(tokens!.access_token);

    const recovered = vi.fn();
    client.addEventListener("authChallengeRecovered", recovered);

    await client.handleAmbientAuthChallenge({ reason: "token_expired" });

    expect(recovered).toHaveBeenCalled();

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);
    expect(client.getStatus()).toBe("connected");

    await client.disconnect();
  }, 15_000);
});
