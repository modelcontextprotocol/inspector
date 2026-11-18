/**
 * #3018: a transport's configured headers go to the MCP server's own origin
 * and to no other — including on the OAuth requests the SDK makes itself from
 * inside the transport, which inherit everything left in `requestInit`.
 */
import { describe, it, expect, vi } from "vitest";
import type {
  OAuthClientProvider,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { createOriginScopedHeadersFetch } from "@inspector/core/mcp/node/originScopedHeadersFetch.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { headersToServerSettings } from "@inspector/core/mcp/node/servers.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const MCP_ORIGIN = "https://mcp.test";
const AS_ORIGIN = "https://auth.other.test";

describe("createOriginScopedHeadersFetch", () => {
  const respond = () => Promise.resolve(new Response("{}"));
  // Lower-cased by hand: happy-dom's `Headers` iterates names as written.
  const sentHeaders = (inner: ReturnType<typeof vi.fn<typeof fetch>>) =>
    Object.fromEntries(
      [...new Headers(inner.mock.calls.at(-1)?.[1]?.headers)].map(
        ([name, value]) => [name.toLowerCase(), value],
      ),
    );

  it("returns the fetch it was given when there is nothing to add", () => {
    const inner = vi.fn<typeof fetch>(respond);
    expect(createOriginScopedHeadersFetch(inner, MCP_ORIGIN, undefined)).toBe(
      inner,
    );
    expect(createOriginScopedHeadersFetch(inner, "null", { "X-A": "1" })).toBe(
      inner,
    );
  });

  it("adds the headers underneath a same-origin request's own", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, {
      "X-API-Key": "mcp-secret",
      Authorization: "Bearer custom",
      Accept: "text/plain",
    });

    await scoped(`${MCP_ORIGIN}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer oauth", accept: "application/json" },
    });

    expect(inner.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(sentHeaders(inner)).toEqual({
      "x-api-key": "mcp-secret",
      authorization: "Bearer oauth",
      accept: "application/json",
    });
  });

  it("reads a URL, and a Request's own headers when init has none", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, {
      "X-API-Key": "mcp-secret",
      "X-Env": "default",
    });

    await scoped(new URL(`${MCP_ORIGIN}/mcp`));
    expect(sentHeaders(inner)).toEqual({
      "x-api-key": "mcp-secret",
      "x-env": "default",
    });

    await scoped(
      new Request(`${MCP_ORIGIN}/mcp`, { headers: { "X-Env": "staging" } }),
    );
    expect(sentHeaders(inner)).toEqual({
      "x-api-key": "mcp-secret",
      "x-env": "staging",
    });
  });

  it("passes a request to any other origin through untouched", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, {
      "X-API-Key": "mcp-secret",
    });
    const init = { method: "POST", headers: { accept: "application/json" } };

    await scoped(`${AS_ORIGIN}/token`, init);
    expect(inner).toHaveBeenLastCalledWith(`${AS_ORIGIN}/token`, init);

    // Same host, another port or scheme: a different origin.
    await scoped("https://mcp.test:8443/token", init);
    expect(inner).toHaveBeenLastCalledWith("https://mcp.test:8443/token", init);

    // Not an absolute URL: left for the underlying fetch to reject.
    await scoped("/relative", init);
    expect(inner).toHaveBeenLastCalledWith("/relative", init);
  });
});

function provider(): OAuthClientProvider {
  let tokens: OAuthTokens = {
    access_token: "stale",
    token_type: "Bearer",
    refresh_token: "refresh-1",
  };
  return {
    get redirectUrl() {
      return "http://127.0.0.1/oauth/callback";
    },
    get clientMetadata() {
      return { redirect_uris: ["http://127.0.0.1/oauth/callback"] };
    },
    clientInformation: () => ({ client_id: "test-client" }),
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next;
    },
    redirectToAuthorization: () => {},
    saveCodeVerifier: () => {},
    codeVerifier: () => "verifier",
  };
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * An MCP server on one origin whose protected-resource metadata names an
 * authorization server on another. The MCP endpoint answers 401 until it is
 * sent the token the authorization server's refresh grant returns, so one
 * request drives the SDK's whole transport-internal refresh.
 */
function fakeNetwork() {
  const seen: { method: string; url: string; headers: Headers }[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    seen.push({ method, url, headers });
    const { origin, pathname } = new URL(url);
    if (origin === AS_ORIGIN) {
      return pathname === "/token"
        ? json({
            access_token: "fresh",
            token_type: "Bearer",
            refresh_token: "refresh-2",
          })
        : json({
            issuer: AS_ORIGIN,
            authorization_endpoint: `${AS_ORIGIN}/authorize`,
            token_endpoint: `${AS_ORIGIN}/token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          });
    }
    if (pathname.startsWith("/.well-known/")) {
      return json({
        resource: `${MCP_ORIGIN}${pathname.endsWith("/sse") ? "/sse" : "/mcp"}`,
        authorization_servers: [AS_ORIGIN],
      });
    }
    if (method === "GET") {
      return new Response("event: endpoint\ndata: /messages\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (headers.get("authorization") !== "Bearer fresh") {
      return new Response("", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${MCP_ORIGIN}/.well-known/oauth-protected-resource${pathname === "/messages" ? "/sse" : "/mcp"}"`,
        },
      });
    }
    return json({ jsonrpc: "2.0", id: 1, result: {} });
  });
  return { fetchFn, seen };
}

const TRANSPORTS: { name: string; config: MCPServerConfig }[] = [
  {
    name: "streamable-http",
    config: { type: "streamable-http", url: `${MCP_ORIGIN}/mcp` },
  },
  { name: "sse", config: { type: "sse", url: `${MCP_ORIGIN}/sse` } },
];

describe.each(TRANSPORTS)(
  "configured headers on the SDK's own OAuth requests ($name)",
  ({ config }) => {
    it("reach the server's origin and not a cross-origin authorization server", async () => {
      // The SDK warns that this bare provider stores no issuer stamp.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { fetchFn, seen } = fakeNetwork();
      const { transport } = createTransportNode(config, {
        fetchFn,
        authProvider: provider(),
        settings: headersToServerSettings({
          "X-API-Key": "mcp-secret",
          Authorization: "Bearer custom",
        }),
      });
      await transport.start();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });
      await transport.close();
      warn.mockRestore();

      const sameOrigin = seen.filter(
        ({ url }) => new URL(url).origin === MCP_ORIGIN,
      );
      const crossOrigin = seen.filter(
        ({ url }) => new URL(url).origin === AS_ORIGIN,
      );
      // Discovery and the refresh grant both went to the other origin…
      expect(crossOrigin.map(({ url }) => new URL(url).pathname)).toEqual(
        expect.arrayContaining(["/token"]),
      );
      expect(crossOrigin.length).toBeGreaterThan(1);
      // …and carried neither configured header.
      for (const { headers } of crossOrigin) {
        expect(headers.get("x-api-key")).toBeNull();
        expect(headers.get("authorization")).toBeNull();
      }
      // Every request to the server's own origin still carries them, with the
      // OAuth token in place of the custom `Authorization` on MCP requests.
      for (const { headers } of sameOrigin) {
        expect(headers.get("x-api-key")).toBe("mcp-secret");
      }
      const mcpPosts = sameOrigin.filter(({ method }) => method === "POST");
      expect(
        mcpPosts.map(({ headers }) => headers.get("authorization")),
      ).toEqual(["Bearer stale", "Bearer fresh"]);
    });
  },
);
