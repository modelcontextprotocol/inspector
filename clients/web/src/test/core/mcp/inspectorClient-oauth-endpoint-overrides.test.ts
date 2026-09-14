import { describe, it, expect } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { CreateTransportOptions } from "@inspector/core/mcp/types.js";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

/**
 * #1906 — the per-server authorization/token endpoint overrides are applied by
 * wrapping the client's base fetch, so the authorization-server metadata
 * document carries the overridden endpoints wherever the SDK discovers it —
 * including the discovery the transport runs on its own (the 401/refresh path),
 * which is handed this same fetch.
 *
 * The assertion goes through the fetch the client actually hands the transport,
 * rather than through a private field, so it fails if the wiring is removed.
 */

class InertTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(): Promise<void> {
    throw new Error("not connected");
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

/**
 * The real browser storage plus inert navigation/redirect stubs — enough for the
 * OAuth manager to exist (which is what installs the override wrapper) without
 * any stored tokens, so `connect()` still builds a transport with no auth
 * provider attached.
 */
function oauthEnvironment() {
  return {
    storage: new BrowserOAuthStorage(),
    navigation: { navigateToAuthorization: () => {} },
    redirectUrlProvider: { getRedirectUrl: () => "http://localhost/callback" },
  };
}

const METADATA = {
  issuer: "https://as.example.com",
  authorization_endpoint: "https://as.example.com/authorize",
  token_endpoint: "https://as.example.com/token",
};

/**
 * Build a client, drive `connect()` far enough to create the transport, and
 * return the `fetchFn` the transport was given.
 */
async function transportFetchFor(
  oauth: Record<string, string> | undefined,
): Promise<typeof fetch | undefined> {
  let captured: CreateTransportOptions | undefined;
  const baseFetch: typeof fetch = async () =>
    new Response(JSON.stringify(METADATA), {
      headers: { "content-type": "application/json" },
    });

  const client = new InspectorClient(
    { type: "streamable-http", url: "https://mcp.example/mcp" },
    {
      environment: {
        fetch: baseFetch,
        oauth: oauthEnvironment(),
        transport: (_config, options) => {
          captured = options;
          return { transport: new InertTransport() };
        },
      },
      ...(oauth && { oauth }),
    },
  );

  await client.connect().catch(() => undefined);
  return captured?.fetchFn;
}

describe("InspectorClient OAuth endpoint overrides (#1906)", () => {
  it("rewrites the discovered metadata endpoints for the transport's fetch", async () => {
    const fetchFn = await transportFetchFor({
      authorizationUrl: "https://staging.example.com/authorize",
      tokenUrl: "https://staging.example.com/token",
    });
    expect(fetchFn).toBeDefined();

    const response = await fetchFn!(
      "https://as.example.com/.well-known/oauth-authorization-server",
    );
    await expect(response.json()).resolves.toEqual({
      issuer: "https://as.example.com",
      authorization_endpoint: "https://staging.example.com/authorize",
      token_endpoint: "https://staging.example.com/token",
    });
  });

  it("leaves the metadata untouched when no override is configured", async () => {
    const fetchFn = await transportFetchFor(undefined);
    expect(fetchFn).toBeDefined();

    const response = await fetchFn!(
      "https://as.example.com/.well-known/oauth-authorization-server",
    );
    await expect(response.json()).resolves.toEqual(METADATA);
  });

  it("picks up an override applied after construction via setOAuthConfig", async () => {
    let captured: CreateTransportOptions | undefined;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          fetch: async () =>
            new Response(JSON.stringify(METADATA), {
              headers: { "content-type": "application/json" },
            }),
          oauth: oauthEnvironment(),
          transport: (_config, options) => {
            captured = options;
            return { transport: new InertTransport() };
          },
        },
        oauth: { clientId: "cid" },
      },
    );
    await client.connect().catch(() => undefined);

    client.setOAuthConfig({ tokenUrl: "https://staging.example.com/token" });
    const response = await captured!.fetchFn!(
      "https://as.example.com/.well-known/oauth-authorization-server",
    );
    await expect(response.json()).resolves.toMatchObject({
      token_endpoint: "https://staging.example.com/token",
    });
  });
});
