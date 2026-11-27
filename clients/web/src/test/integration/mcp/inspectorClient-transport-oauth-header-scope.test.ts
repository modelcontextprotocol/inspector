/**
 * #3018, end to end through `InspectorClient` as the Node clients build it: a
 * connection with stored tokens and no OAuth-specific options leaves the 401
 * to the SDK, which refreshes from inside the transport. The server's custom
 * headers must not follow that refresh to an authorization server on another
 * origin.
 */
import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import { ConsoleNavigation } from "@inspector/core/auth/providers.js";

const MCP_ORIGIN = "https://mcp.test";
const MCP_URL = `${MCP_ORIGIN}/mcp`;
const AS_ORIGIN = "https://auth.other.test";

const statePathFor = (dedicated: boolean) =>
  path.join(
    os.tmpdir(),
    `mcp-oauth-${process.pid}-transport-oauth-header-scope-${dedicated}.json`,
  );

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fakeNetwork() {
  const seen: { url: string; headers: Headers }[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, headers });
    const u = new URL(url);
    if (u.origin === MCP_ORIGIN && u.pathname === "/mcp") {
      if (headers.get("authorization") !== "Bearer fresh") {
        return new Response("", {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }
      if ((init?.method ?? "GET") !== "POST") {
        return new Response("", { status: 405 });
      }
      const message = JSON.parse(String(init?.body)) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) return new Response("", { status: 202 });
      return json({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: {},
                serverInfo: { name: "fake", version: "1.0.0" },
              }
            : {},
      });
    }
    if (u.origin === MCP_ORIGIN && u.pathname.includes("protected-resource")) {
      return json({ resource: MCP_URL, authorization_servers: [AS_ORIGIN] });
    }
    if (u.origin === AS_ORIGIN && u.pathname.includes(".well-known")) {
      return json({
        issuer: AS_ORIGIN,
        authorization_endpoint: `${AS_ORIGIN}/authorize`,
        token_endpoint: `${AS_ORIGIN}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (u.origin === AS_ORIGIN && u.pathname === "/token") {
      return json({
        access_token: "fresh",
        token_type: "Bearer",
        refresh_token: "refresh-2",
      });
    }
    return new Response("", { status: 404 });
  });
  return { fetchFn, seen };
}

describe("custom headers on the SDK's transport-internal OAuth refresh", () => {
  it.each([
    ["the shared base fetch", false],
    ["the environment's oauthFetch", true],
  ])("stay on the server's origin, through %s", async (_name, dedicated) => {
    // The SDK warns that the seeded tokens carry no issuer stamp.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const statePath = statePathFor(dedicated);
    await fs.rm(statePath, { force: true });
    const storage = new NodeOAuthStorage(statePath);
    await storage.saveClientInformation(
      MCP_URL,
      { client_id: "dcr-client" },
      { registrationKind: "dcr" },
    );
    await storage.saveTokens(MCP_URL, {
      access_token: "stale",
      token_type: "Bearer",
      refresh_token: "refresh-1",
    });
    const { fetchFn, seen } = fakeNetwork();
    const client = new InspectorClient(
      { type: "streamable-http", url: MCP_URL },
      {
        environment: {
          transport: createTransportNode,
          fetch: fetchFn,
          ...(dedicated && { oauthFetch: fetchFn }),
          oauth: {
            storage,
            navigation: new ConsoleNavigation(),
            redirectUrlProvider: {
              getRedirectUrl: () => "http://127.0.0.1:6276/oauth/callback",
            },
          },
        },
        serverSettings: {
          headers: [{ key: "X-API-Key", value: "mcp-secret" }],
          metadata: {},
          env: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 0,
          roots: [],
        },
      },
    );
    try {
      await client.connect();
    } finally {
      await client.disconnect().catch(() => {});
      await fs.rm(statePath, { force: true });
      warn.mockRestore();
    }
    const crossOrigin = seen.filter(
      ({ url }) => new URL(url).origin === AS_ORIGIN,
    );
    // Discovery and the refresh grant went to the other origin, without it…
    expect(crossOrigin.map(({ url }) => new URL(url).pathname)).toContain(
      "/token",
    );
    expect(crossOrigin.map(({ headers }) => headers.get("x-api-key"))).toEqual(
      crossOrigin.map(() => null),
    );
    // …and every request to the server's own origin still carries it.
    const sameOrigin = seen.filter(
      ({ url }) => new URL(url).origin === MCP_ORIGIN,
    );
    expect(sameOrigin.map(({ headers }) => headers.get("x-api-key"))).toEqual(
      sameOrigin.map(() => "mcp-secret"),
    );
  });
});
