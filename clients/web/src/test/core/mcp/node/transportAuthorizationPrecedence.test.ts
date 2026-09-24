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
 * The SSE endpoint event: the GET's stream must name the POST URL before
 * `start()` resolves.
 */
function sseStream(): Response {
  return new Response("event: endpoint\ndata: /messages\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResult(): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Start a transport built the way `InspectorClient` builds it, send one
 * request, and return `METHOD authorization` for every request the underlying
 * fetch received — for SSE that is the EventSource GET as well as the POST,
 * which build their headers separately.
 */
async function sentAuthorizations(
  config: MCPServerConfig,
  tokens: OAuthTokens | undefined,
): Promise<string[]> {
  const fetchFn = vi.fn<typeof fetch>(async (_url, init) =>
    (init?.method ?? "GET") === "GET" ? sseStream() : jsonResult(),
  );
  const { transport } = createTransportNode(config, {
    fetchFn,
    authProvider: provider(tokens),
    settings: headersToServerSettings({ Authorization: CUSTOM }),
  });
  await transport.start();
  await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });
  await transport.close();
  return fetchFn.mock.calls.map(
    ([, init]) =>
      `${init?.method ?? "GET"} ${new Headers(init?.headers).get("authorization")}`,
  );
}

const TRANSPORTS: {
  name: string;
  config: MCPServerConfig;
  methods: string[];
}[] = [
  {
    name: "streamable-http",
    config: { type: "streamable-http", url: "http://127.0.0.1:9/mcp" },
    methods: ["POST"],
  },
  {
    name: "sse",
    config: { type: "sse", url: "http://127.0.0.1:9/sse" },
    methods: ["GET", "POST"],
  },
];

describe.each(TRANSPORTS)(
  "custom Authorization header vs OAuth token ($name)",
  ({ config, methods }) => {
    it("sends the OAuth token in place of the custom header once one exists", async () => {
      expect(
        await sentAuthorizations(config, {
          access_token: OAUTH_TOKEN,
          token_type: "Bearer",
        }),
      ).toEqual(methods.map((m) => `${m} Bearer ${OAUTH_TOKEN}`));
    });

    it("sends the custom header while OAuth has no token", async () => {
      expect(await sentAuthorizations(config, undefined)).toEqual(
        methods.map((m) => `${m} ${CUSTOM}`),
      );
    });
  },
);
