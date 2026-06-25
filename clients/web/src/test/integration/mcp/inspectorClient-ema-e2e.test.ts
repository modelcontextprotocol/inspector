/**
 * End-to-end EMA (enterprise-managed authorization) tests for InspectorClient.
 * Mock IdP + mock resource AS + protected-resource MCP test server.
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
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { ConsoleNavigation } from "@inspector/core/auth/providers.js";
import {
  clearAllOAuthClientState,
  NodeOAuthStorage,
} from "@inspector/core/auth/node/index.js";
import { flushStoreFileWrites } from "@inspector/core/storage/store-io.js";
import {
  TestServerHttp,
  getDefaultServerConfig,
  createExternalResourceOAuthTestServerConfig,
} from "@modelcontextprotocol/inspector-test-server";
import type { InspectorClientOptions } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import {
  createEmaMockKeyMaterial,
  createMockIdToken,
  EMA_MOCK_IDP_CLIENT_ID,
  EMA_MOCK_IDP_CLIENT_SECRET,
  EMA_MOCK_RESOURCE_CLIENT_ID,
  EMA_MOCK_RESOURCE_CLIENT_SECRET,
  startMockIdpServer,
  startMockResourceAsServer,
  type StoppableMockServer,
} from "./ema-mock-servers.js";

const testRedirectUrl = "http://127.0.0.1:3001/oauth/callback";
const oauthTestStatePath = path.join(
  os.tmpdir(),
  `mcp-ema-${process.pid}-inspectorClient-ema-e2e.json`,
);

function createStaticRedirectUrlProvider(redirectUrl: string) {
  return { getRedirectUrl: () => redirectUrl };
}

async function waitForProtectedResourceMetadata(
  serverBase: string,
): Promise<void> {
  const url = `${serverBase.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const res = await fetch(url);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`protected resource metadata not ready: ${url}`);
}

describe("InspectorClient EMA E2E", () => {
  let mcpServer: TestServerHttp;
  let client: InspectorClient;
  let mockIdp: StoppableMockServer;
  let mockAs: StoppableMockServer;
  let storage: NodeOAuthStorage;
  let mcpPort: number;
  let mcpUrl: string;

  afterAll(async () => {
    try {
      await fs.unlink(oauthTestStatePath);
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    clearAllOAuthClientState();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const keys = await createEmaMockKeyMaterial();
    mockAs = await startMockResourceAsServer({ keys });
    mockIdp = await startMockIdpServer();

    const serverConfig = {
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createExternalResourceOAuthTestServerConfig({
        authorizationServers: [mockAs.baseUrl],
        requireAuth: true,
        scopesSupported: ["mcp"],
        accessTokenIssuers: [mockAs.baseUrl],
        jwksUri: `${mockAs.baseUrl}/jwks`,
      }),
    };

    mcpServer = new TestServerHttp(serverConfig);
    mcpPort = await mcpServer.start();
    const serverBase = `http://127.0.0.1:${mcpPort}`;
    mcpUrl = `${serverBase}/mcp`;
    await waitForProtectedResourceMetadata(serverBase);

    storage = new NodeOAuthStorage(oauthTestStatePath);
    const idToken = await createMockIdToken(mockIdp.baseUrl);
    await storage.saveIdpSession(mockIdp.baseUrl, { idToken });
    await flushStoreFileWrites(oauthTestStatePath);
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    if (mcpServer) {
      await mcpServer.stop();
    }
    if (mockIdp) {
      await mockIdp.stop();
    }
    if (mockAs) {
      await mockAs.stop();
    }
    vi.restoreAllMocks();
  });

  function createEmaClient(): InspectorClient {
    const clientConfig: InspectorClientOptions = {
      environment: {
        transport: createTransportNode,
        oauth: {
          storage,
          navigation: new ConsoleNavigation(),
          redirectUrlProvider: createStaticRedirectUrlProvider(testRedirectUrl),
        },
      },
      oauth: {
        enterpriseManaged: true,
        clientId: EMA_MOCK_RESOURCE_CLIENT_ID,
        clientSecret: EMA_MOCK_RESOURCE_CLIENT_SECRET,
        scope: "mcp",
      },
      enterpriseManagedAuth: {
        idp: {
          issuer: mockIdp.baseUrl,
          clientId: EMA_MOCK_IDP_CLIENT_ID,
          clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
        },
      },
    };

    return new InspectorClient(
      {
        type: "streamable-http",
        url: mcpUrl,
      } as MCPServerConfig,
      clientConfig,
    );
  }

  it("connects via silent EMA (cached IdP session + legs 2–3)", async () => {
    client = createEmaClient();
    await client.connect();

    expect(client.getStatus()).toBe("connected");

    const tokens = await client.getOAuthTokens();
    expect(tokens?.access_token).toBeDefined();
    expect(tokens?.token_type).toBe("Bearer");

    const oauthState = await client.getOAuthState();
    expect(oauthState?.protocol).toBe("ema");
    expect(oauthState?.authorized).toBe(true);
    expect(oauthState?.ema?.idpSession).toBe("logged_in");
  });

  it("reuses silent EMA on a second connect", async () => {
    client = createEmaClient();
    await client.connect();
    await client.disconnect();

    await client.connect();
    expect(client.getStatus()).toBe("connected");

    const oauthState = await client.getOAuthState();
    expect(oauthState?.protocol).toBe("ema");
    expect(oauthState?.authorized).toBe(true);
  });

  it("persists EMA resource tokens tagged enterpriseManaged in storage", async () => {
    client = createEmaClient();
    await client.connect();
    await flushStoreFileWrites(oauthTestStatePath);

    const raw = JSON.parse(await fs.readFile(oauthTestStatePath, "utf-8")) as {
      state: {
        servers: Record<
          string,
          { tokens?: { access_token?: string }; enterpriseManaged?: boolean }
        >;
      };
    };
    const entry = raw.state.servers[mcpUrl];
    expect(entry?.tokens?.access_token).toBeDefined();
    expect(entry?.enterpriseManaged).toBe(true);
  });
});
