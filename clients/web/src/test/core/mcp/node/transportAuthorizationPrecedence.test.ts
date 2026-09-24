/**
 * Pins which `Authorization` value reaches the wire when a server has both a
 * custom `Authorization` header (settings.headers → `requestInit.headers`) and
 * an OAuth provider. The Custom Headers hint in `ServerSettingsForm` states
 * this order to users, and it is decided by the SDK's `_commonHeaders()`, not
 * by us: 2.0 let the custom header win, 2.1.0 lets the OAuth token win
 * (typescript-sdk#2475, adopted in #2486). A future SDK that flips it again
 * turns this test red, which is the prompt to rewrite the hint with it.
 */
import { describe, it, expect, vi } from "vitest";
import type {
  OAuthClientProvider,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { headersToServerSettings } from "@inspector/core/mcp/node/servers.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const CUSTOM = "Bearer custom-static-key";
const OAUTH_TOKEN = "oauth-access-token";

function provider(tokens: OAuthTokens | undefined): OAuthClientProvider {
  return {
    get redirectUrl() {
      return "http://127.0.0.1/oauth/callback";
    },
    get clientMetadata() {
      return { redirect_uris: ["http://127.0.0.1/oauth/callback"] };
    },
    clientInformation: () => ({ client_id: "test-client" }),
    tokens: () => tokens,
    saveTokens: () => {},
    redirectToAuthorization: () => {},
    saveCodeVerifier: () => {},
    codeVerifier: () => "verifier",
  };
}

/**
 * Send one request through a transport built the way `InspectorClient` builds
 * it, and return the `Authorization` header the underlying fetch received.
 */
async function sentAuthorization(
  config: MCPServerConfig,
  tokens: OAuthTokens | undefined,
): Promise<string | null> {
  const fetchFn = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const { transport } = createTransportNode(config, {
    fetchFn,
    authProvider: provider(tokens),
    settings: headersToServerSettings({ Authorization: CUSTOM }),
  });
  await transport.start();
  await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });
  await transport.close();
  expect(fetchFn).toHaveBeenCalled();
  return new Headers(fetchFn.mock.calls[0]![1]?.headers).get("authorization");
}

const HTTP: MCPServerConfig = {
  type: "streamable-http",
  url: "http://127.0.0.1:9/mcp",
};

describe("custom Authorization header vs OAuth token (streamable-http)", () => {
  it("sends the OAuth token in place of the custom header once one exists", async () => {
    expect(
      await sentAuthorization(HTTP, {
        access_token: OAUTH_TOKEN,
        token_type: "Bearer",
      }),
    ).toBe(`Bearer ${OAUTH_TOKEN}`);
  });

  it("sends the custom header while OAuth has no token", async () => {
    expect(await sentAuthorization(HTTP, undefined)).toBe(CUSTOM);
  });
});
