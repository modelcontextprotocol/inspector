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
import { completeOAuthAuthorization } from "../helpers/oauth-client-fixtures.js";
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
    await clearAllOAuthClientState();
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
      servers: Record<
        string,
        { tokens?: { access_token?: string }; enterpriseManaged?: boolean }
      >;
    };
    const entry = raw.servers[mcpUrl];
    expect(entry?.tokens?.access_token).toBeDefined();
    expect(entry?.enterpriseManaged).toBe(true);
  });

  describe("interactive leg 1 (no cached IdP session)", () => {
    // The suite-wide beforeEach seeds an IdP session so the silent path (legs
    // 2–3) runs. These tests clear it first so EMA falls through to the
    // interactive authorization-code login against the mock IdP — the exact path
    // that regressed in #1688 (a dropped RFC 9207 `iss`), which had no e2e
    // coverage before #1693.
    beforeEach(async () => {
      await storage.clearIdpSession(mockIdp.baseUrl);
      await flushStoreFileWrites(oauthTestStatePath);
    });

    it("drives leg 1 end to end: authorize → callback(iss) → id_token → resource token", async () => {
      client = createEmaClient();

      // No cached IdP session → EMA starts interactive leg 1 and returns the IdP
      // authorization URL instead of silently connecting.
      const authUrl = await client.authenticate();
      if (!authUrl) throw new Error("Expected IdP authorization URL for leg 1");
      expect(authUrl.href.startsWith(mockIdp.baseUrl)).toBe(true);
      expect(authUrl.pathname).toBe("/authorize");

      // The mock IdP auto-approves and redirects back with code + RFC 9207 iss.
      const { code, iss } = await completeOAuthAuthorization(authUrl);
      expect(iss).toBe(mockIdp.baseUrl);

      // Leg 1 code exchange (mints the ID Token) → legs 2–3 (resource token).
      await client.completeOAuthFlow(code, iss);
      await client.connect();

      expect(client.getStatus()).toBe("connected");

      const tokens = await client.getOAuthTokens();
      expect(tokens?.access_token).toBeDefined();
      expect(tokens?.token_type).toBe("Bearer");

      const oauthState = await client.getOAuthState();
      expect(oauthState?.protocol).toBe("ema");
      expect(oauthState?.authorized).toBe(true);
      expect(oauthState?.ema?.idpSession).toBe("logged_in");

      // Leg 1 side effect: the exchanged ID Token is now cached as the IdP session.
      const session = await storage.getIdpSession(mockIdp.baseUrl);
      expect(session?.idToken).toBeDefined();
    });

    it("rejects the leg 1 exchange when the callback iss is missing (RFC 9207)", async () => {
      client = createEmaClient();

      const authUrl = await client.authenticate();
      if (!authUrl) throw new Error("Expected IdP authorization URL for leg 1");
      const { code } = await completeOAuthAuthorization(authUrl);

      // The mock IdP metadata advertises
      // `authorization_response_iss_parameter_supported`, so the SDK must reject
      // a code exchange that forwards no `iss`. This is the guard that a dropped
      // `iss` (the #1688 regression) would trip.
      await expect(client.completeOAuthFlow(code)).rejects.toThrow(
        /Issuer mismatch|issuer/i,
      );
      expect(await client.getOAuthTokens()).toBeUndefined();
    });
  });
});
