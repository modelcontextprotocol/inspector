/**
 * RFC 8414 authorization-server metadata served at the OpenID Connect
 * well-known path, end to end against a real OAuth test server (#2172).
 *
 * The unit tests prove the wrapper substitutes the right document. This file
 * proves the two halves only a real server can: that the SDK genuinely rejects
 * a conforming plain-OAuth document found at `openid-configuration`, and that
 * the wrapper recovers discovery against the same server without adding a
 * field the server never published.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import {
  TestServerHttp,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  waitForOAuthWellKnown,
} from "@modelcontextprotocol/inspector-test-server";
import {
  COMPAT_SOURCE_HEADER,
  withRfc8414OidcCompat,
} from "@inspector/core/auth/oidcDiscoveryCompat.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";

const OIDC_PATH = "/.well-known/openid-configuration";

/** The three fields OpenID Connect Discovery requires and RFC 8414 does not. */
const OIDC_ONLY_FIELDS = [
  "jwks_uri",
  "subject_types_supported",
  "id_token_signing_alg_values_supported",
] as const;

describe("RFC 8414 metadata at the OIDC well-known path (#2172)", () => {
  let mcpServer: TestServerHttp | null = null;
  let serverUrl = "";

  beforeAll(async () => {
    mcpServer = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        // Metadata routes are served either way; leaving auth unrequired lets
        // the transport-wiring test below actually connect.
        requireAuth: false,
        asMetadataPath: OIDC_PATH,
      }),
    });
    const port = await mcpServer.start();
    serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl, { metadataPath: OIDC_PATH });
  });

  afterAll(async () => {
    await mcpServer?.stop();
    mcpServer = null;
  });

  it("serves plain RFC 8414 metadata only from the OIDC path", async () => {
    const oidc = await fetch(`${serverUrl}${OIDC_PATH}`);
    expect(oidc.status).toBe(200);
    const metadata = (await oidc.json()) as Record<string, unknown>;
    expect(metadata.issuer).toBe(serverUrl);
    for (const field of OIDC_ONLY_FIELDS) {
      expect(metadata).not.toHaveProperty(field);
    }

    const rfc8414 = await fetch(
      `${serverUrl}/.well-known/oauth-authorization-server`,
    );
    expect(rfc8414.status).toBe(404);
  });

  it("is rejected by unwrapped SDK discovery", async () => {
    // The upstream defect this module exists for
    // (modelcontextprotocol/typescript-sdk#2733). If this ever starts
    // resolving, the SDK has been fixed and `oidcDiscoveryCompat` can go.
    await expect(
      discoverAuthorizationServerMetadata(serverUrl),
    ).rejects.toThrow(/jwks_uri/);
  });

  it("resolves through the compat wrapper without fabricating a field", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const metadata = await discoverAuthorizationServerMetadata(serverUrl, {
        fetchFn: withRfc8414OidcCompat(fetch),
      });

      expect(metadata?.issuer).toBe(serverUrl);
      expect(metadata?.authorization_endpoint).toBe(
        `${serverUrl}/oauth/authorize`,
      );
      expect(metadata?.token_endpoint).toBe(`${serverUrl}/oauth/token`);
      for (const field of OIDC_ONLY_FIELDS) {
        expect(metadata).not.toHaveProperty(field);
      }
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`${serverUrl}${OIDC_PATH}`),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("hands the transport a fetch that carries the shim", async () => {
    // The SDK also runs discovery from *inside* the transport, which receives
    // `InspectorClient`'s base fetch directly — so a reconnect with an existing
    // auth provider must not bypass the shim (Copilot). Capturing the fetch the
    // transport was handed and driving it against this server is what proves
    // the wiring, without depending on the SDK to trigger that leg.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let transportFetch: typeof fetch | undefined;
    const capturingTransport: typeof createTransportNode = (
      config,
      options,
    ) => {
      transportFetch = options?.fetchFn;
      return createTransportNode(config, options);
    };
    const client = new InspectorClient(
      { type: "streamable-http", url: `${serverUrl}/mcp` },
      { environment: { transport: capturingTransport } },
    );
    try {
      await client.connect();
      expect(transportFetch).toBeDefined();

      const response = await transportFetch!(
        `${serverUrl}/.well-known/oauth-authorization-server`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get(COMPAT_SOURCE_HEADER)).toBe(
        `${serverUrl}${OIDC_PATH}`,
      );
      await expect(response.json()).resolves.toMatchObject({
        issuer: serverUrl,
      });
    } finally {
      await client.disconnect();
      warn.mockRestore();
    }
  });
});
