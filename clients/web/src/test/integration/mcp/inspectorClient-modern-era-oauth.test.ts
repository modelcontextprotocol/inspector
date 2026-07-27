/**
 * Live coverage of an OAuth-protected connect on the probing eras (#1805).
 *
 * A modern (2026-07-28) server behind `requireAuth` answers the SDK's
 * `server/discover` negotiation probe with 401 — the probe runs before anything
 * else, so it, not `initialize`, is where authorization first surfaces. The
 * probe's classifier reports the failure as `SdkError(ERA_NEGOTIATION_FAILED)`
 * with the real error moved to `data.cause`, which used to bury the auth signal
 * and leave `connect()` rejecting with a dead-end "Version negotiation probe
 * failed" instead of starting the authorization flow (the same server authorized
 * fine on `protocolEra: "legacy"`).
 *
 * Complements `inspectorClient-modern-era.test.ts` (modern era, no auth) and
 * `inspectorClient-oauth-direct-mid-session-e2e.test.ts` (auth, legacy era).
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
} from "@modelcontextprotocol/inspector-test-server";
import {
  AuthRecoveryRequiredError,
  isConnectAuthRecoveryError,
} from "@inspector/core/auth/challenge.js";
import {
  eraToVersionNegotiation,
  MODERN_PROTOCOL_VERSION,
} from "@inspector/core/mcp/types.js";
import {
  createOAuthClientConfig,
  completeOAuthAuthorization,
} from "../helpers/oauth-client-fixtures.js";
import { ConsoleNavigation } from "@inspector/core/auth/providers.js";
import type { InspectorClientOptions } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const oauthTestStatePath = join(
  tmpdir(),
  `mcp-oauth-${process.pid}-modern-era-oauth.json`,
);

const testRedirectUrl = "http://localhost:3000/oauth/callback";
const staticClientId = "test-modern-era-oauth";
const staticClientSecret = "test-secret-modern-era-oauth";

describe("OAuth connect on the probing eras (#1805)", () => {
  let mcpServer: TestServerHttp | null = null;
  let client: InspectorClient | null = null;

  beforeEach(() => {
    clearOAuthTestData();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect().catch(() => {});
      client = null;
    }
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

  /** Modern-era MCP server that requires a Bearer token on /mcp. */
  async function startProtectedModernServer(): Promise<string> {
    const started = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      // Modern (2026-07-28) serving: the bearer middleware guards this leg too,
      // so the negotiation probe itself is answered 401.
      modern: {},
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
    });
    const port = await started.start();
    mcpServer = started;
    const serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);
    return serverUrl;
  }

  function createClient(
    serverUrl: string,
    era: "auto" | "modern",
  ): InspectorClient {
    const oauthConfig = {
      ...createOAuthClientConfig({
        mode: "static",
        clientId: staticClientId,
        clientSecret: staticClientSecret,
        redirectUrl: testRedirectUrl,
      }),
      storage: new NodeOAuthStorage(oauthTestStatePath),
    };

    const clientConfig: InspectorClientOptions = {
      environment: {
        transport: createTransportNode,
        oauth: {
          storage: oauthConfig.storage,
          navigation: new ConsoleNavigation(),
          redirectUrlProvider: oauthConfig.redirectUrlProvider,
        },
      },
      // The CLI/TUI shape (see core/client/runner.ts).
      directAuthRecovery: true,
      versionNegotiation: eraToVersionNegotiation(era),
      oauth: {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        clientMetadataUrl: oauthConfig.clientMetadataUrl,
        scope: oauthConfig.scope,
      },
    };

    const created = new InspectorClient(
      { type: "streamable-http", url: `${serverUrl}/mcp` } as MCPServerConfig,
      clientConfig,
    );
    client = created;
    return created;
  }

  for (const era of ["auto", "modern"] as const) {
    it(`surfaces a recoverable auth error (not a negotiation failure) on the "${era}" era with no stored tokens`, async () => {
      const serverUrl = await startProtectedModernServer();
      const connecting = createClient(serverUrl, era).connect();

      // Recoverable: the caller can drive the OAuth redirect from this error.
      // Before the fix the probe's wrapper reached here instead, so every
      // client fell through to a generic "failed to connect" report.
      await expect(connecting).rejects.toBeInstanceOf(
        AuthRecoveryRequiredError,
      );
      const error = await connecting.catch((err: unknown) => err);
      expect(isConnectAuthRecoveryError(error)).toBe(true);
      expect((error as Error).message).not.toMatch(/version negotiation/i);
      expect(
        (error as AuthRecoveryRequiredError).authorizationUrl,
      ).toBeInstanceOf(URL);
    }, 30_000);

    it(`connects on the "${era}" era once authorization completes`, async () => {
      const serverUrl = await startProtectedModernServer();
      const authorizing = createClient(serverUrl, era);

      const authUrl = await authorizing.authenticate();
      if (!authUrl) throw new Error("Expected an authorization URL");
      const { code, iss } = await completeOAuthAuthorization(authUrl);
      await authorizing.completeOAuthFlow(code, iss);
      await authorizing.connect();

      // With a token the probe is answered, so the modern era is reached — the
      // outcome the negotiation failure was masking.
      expect(authorizing.getProtocolEra()).toBe("modern");
      expect(authorizing.getProtocolVersion()).toBe(MODERN_PROTOCOL_VERSION);
      expect((await authorizing.listTools()).tools.length).toBeGreaterThan(0);
    }, 30_000);
  }
});
