/**
 * RFC 9728 `resource_metadata` end-to-end, against a real OAuth test server
 * whose protected-resource metadata document lives at a non-default path and
 * whose well-known locations deliberately 404 (#2071).
 *
 * The unit tests prove the URL is parsed and handed to `mcpAuth()`. This file
 * proves the two halves that only a real server can: that the challenge the
 * server actually emits parses into `AuthChallenge.resourceMetadataUrl`, and
 * that SDK discovery genuinely cannot find the document without it — so the
 * plumbing is load-bearing rather than merely present.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import {
  TestServerHttp,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  isOriginRelativePath,
  loadConfig,
  resolveConfig,
  waitForOAuthWellKnown,
} from "@modelcontextprotocol/inspector-test-server";
import {
  challengeResourceMetadataUrl,
  parseAuthChallengeFromResponse,
} from "@inspector/core/auth/challenge.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  ConsoleNavigation,
  type RedirectUrlProvider,
} from "@inspector/core/auth/providers.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";

const METADATA_PATH = "/custom/protected-resource";
const STATIC_CLIENT_ID = "test-2071-resource-metadata";
const STATIC_CLIENT_SECRET = "test-2071-secret";
const REDIRECT_URL = "http://localhost:3000/oauth/callback";
/** Fixed, since this one is asserted against a server of its own. */
const METADATA_URL_LITERAL = "http://127.0.0.1:3001/custom/protected-resource";

describe("OAuth challenge resource_metadata (RFC 9728)", () => {
  let mcpServer: TestServerHttp | null = null;
  let serverUrl = "";
  let storageDir = "";

  beforeAll(async () => {
    mcpServer = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        resourceMetadataPath: METADATA_PATH,
        // Static rather than DCR: this suite is about *where the metadata
        // document is found*, so registration should not be a second thing
        // that can fail.
        staticClients: [
          {
            clientId: STATIC_CLIENT_ID,
            clientSecret: STATIC_CLIENT_SECRET,
            redirectUris: [REDIRECT_URL],
          },
        ],
      }),
    });
    const port = await mcpServer.start();
    serverUrl = `http://localhost:${port}`;
    storageDir = mkdtempSync(join(tmpdir(), "mcp-inspector-2071-"));
    await waitForOAuthWellKnown(serverUrl);
  });

  afterAll(async () => {
    await mcpServer?.stop();
    mcpServer = null;
    if (storageDir) {
      rmSync(storageDir, { recursive: true, force: true });
      storageDir = "";
    }
  });

  it("advertises the non-default metadata URL on the 401 challenge", async () => {
    const response = await fetch(`${serverUrl}/mcp`, { method: "POST" });

    expect(response.status).toBe(401);
    const challenge = parseAuthChallengeFromResponse(response);
    expect(challenge?.resourceMetadataUrl).toBe(`${serverUrl}${METADATA_PATH}`);
    expect(challengeResourceMetadataUrl(challenge!)?.href).toBe(
      `${serverUrl}${METADATA_PATH}`,
    );
  });

  it("serves the metadata document only from the advertised path", async () => {
    const advertised = await fetch(`${serverUrl}${METADATA_PATH}`);
    expect(advertised.status).toBe(200);
    await expect(advertised.json()).resolves.toMatchObject({
      authorization_servers: [serverUrl],
    });

    const wellKnown = await fetch(
      `${serverUrl}/.well-known/oauth-protected-resource`,
    );
    expect(wellKnown.status).toBe(404);
  });

  it("SDK discovery resolves with the advertised URL and fails without it", async () => {
    await expect(
      discoverOAuthProtectedResourceMetadata(serverUrl, {
        resourceMetadataUrl: new URL(`${serverUrl}${METADATA_PATH}`),
      }),
    ).resolves.toMatchObject({ authorization_servers: [serverUrl] });

    // The pre-fix behavior: discovery derived from the MCP server URL alone.
    await expect(
      discoverOAuthProtectedResourceMetadata(serverUrl),
    ).rejects.toThrow();
  });

  it("drives first-time legacy authorization off the advertised URL (#2071)", async () => {
    // The gap the challenge-driven plumbing alone does not close: with no
    // stored token in the default legacy era, `InspectorClient` builds the
    // transport with no `authProvider` and no challenge interception, so the
    // 401 reaches the client as the SDK's headerless `UnauthorizedError` and
    // the CLI/TUI runner calls `authenticate()` with nothing in hand. The
    // observed-challenge path is what carries the URL across that gap.
    const requested: string[] = [];
    const spyFetch: typeof fetch = async (input, init) => {
      requested.push(input instanceof Request ? input.url : String(input));
      return fetch(input, init);
    };

    const redirectUrlProvider: RedirectUrlProvider = {
      getRedirectUrl: () => REDIRECT_URL,
    };

    const client = new InspectorClient(
      { type: "streamable-http", url: `${serverUrl}/mcp` },
      {
        environment: {
          transport: createTransportNode,
          fetch: spyFetch,
          oauth: {
            // A fresh path per run. SDK `auth()` persists its discovery
            // state — the advertised metadata URL included — so a reused file
            // would let a watch-mode rerun satisfy discovery from the cache
            // and pass even with the observer plumbing removed (Copilot).
            storage: new NodeOAuthStorage(join(storageDir, "oauth.json")),
            navigation: new ConsoleNavigation(),
            redirectUrlProvider,
          },
        },
        oauth: {
          clientId: STATIC_CLIENT_ID,
          clientSecret: STATIC_CLIENT_SECRET,
          scope: "mcp",
        },
      },
    );

    await expect(client.connect()).rejects.toThrow();

    // Reaching an authorization URL at all means discovery resolved — which it
    // can only have done through the advertised path, since the well-known one
    // 404s on this server.
    const authUrl = await client.authenticate();
    expect(authUrl?.href).toContain("/oauth/authorize");

    expect(requested).toContain(`${serverUrl}${METADATA_PATH}`);
    expect(
      requested.filter((url) =>
        url.includes("/.well-known/oauth-protected-resource"),
      ),
    ).toEqual([]);

    await client.disconnect();
  });

  it("observes the SSE challenge through a caller-supplied eventSourceInit.fetch", async () => {
    // That explicit fetch is deliberately not proxy- or intercept-wrapped, so
    // it used to bypass the observer entirely and a first-time legacy SSE
    // authorization lost the advertised URL the same way (Copilot).
    const sseServer = createServer((_req, res) => {
      res.writeHead(401, {
        "WWW-Authenticate": `Bearer resource_metadata="${METADATA_URL_LITERAL}"`,
      });
      res.end();
    });
    await new Promise<void>((resolve) => sseServer.listen(0, resolve));
    const address = sseServer.address();
    /* v8 ignore next 3 -- listen(0) on a TCP socket always yields an AddressInfo */
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }

    const explicitFetch = vi.fn<typeof fetch>((input, init) =>
      fetch(input, init),
    );
    const observed: AuthChallenge[] = [];

    try {
      const { transport } = createTransportNode(
        {
          type: "sse",
          url: `http://127.0.0.1:${address.port}/sse`,
          eventSourceInit: { fetch: explicitFetch },
        },
        {
          onAuthChallengeObserved: (challenge) => observed.push(challenge),
        },
      );

      await expect(transport.start()).rejects.toThrow();
      await transport.close().catch(() => {});
    } finally {
      await new Promise<void>((resolve) => sseServer.close(() => resolve()));
    }

    expect(explicitFetch).toHaveBeenCalled();
    expect(observed).toContainEqual(
      expect.objectContaining({ resourceMetadataUrl: METADATA_URL_LITERAL }),
    );
  });

  it("keeps the showcase config valid and carrying the custom path", () => {
    const configPath = fileURLToPath(
      new URL(
        "../../../../../../test-servers/configs/oauth-custom-resource-metadata-http.json",
        import.meta.url,
      ),
    );

    // loadConfig validates as it parses, so this is the regression test for
    // the checked-in showcase config as much as for the new field.
    expect(resolveConfig(loadConfig(configPath)).oauth).toMatchObject({
      enabled: true,
      resourceMetadataPath: METADATA_PATH,
    });
  });

  it.each([
    ["/custom/protected-resource", true],
    ["/a", true],
    // Both re-point the origin when resolved against the request base while
    // Express still registers the route locally, so the server would advertise
    // a document it does not serve (Copilot).
    ["//other-host/doc", false],
    ["/\\other-host/doc", false],
    ["https://other-host/doc", false],
    ["custom/protected-resource", false],
    ["/has a space", false],
    // `href` preserves both, so these pass an origin+href comparison — but
    // Express matches on the path alone and a fragment never reaches the
    // server, so the advertised URL could not resolve to the route.
    ["/doc?version=1", false],
    ["/doc#section", false],
    ["", false],
  ])("origin-relative path check: %j -> %s", (value, expected) => {
    expect(isOriginRelativePath(value)).toBe(expected);
  });
});
