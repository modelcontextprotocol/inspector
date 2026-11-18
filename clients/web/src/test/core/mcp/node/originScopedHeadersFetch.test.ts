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
  const CONFIGURED = {
    "X-API-Key": "mcp-secret",
    Authorization: "Bearer custom",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Lower-cased by hand: happy-dom's `Headers` iterates names as written.
  const sentHeaders = (inner: ReturnType<typeof vi.fn<typeof fetch>>) =>
    Object.fromEntries(
      [...new Headers(inner.mock.calls.at(-1)?.[1]?.headers)].map(
        ([name, value]) => [name.toLowerCase(), value],
      ),
    );

  it("returns the fetch it was given when no headers are configured", () => {
    const inner = vi.fn<typeof fetch>(respond);
    expect(createOriginScopedHeadersFetch(inner, MCP_ORIGIN, undefined)).toBe(
      inner,
    );
  });

  it("passes a request to the server's origin through untouched", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(
      inner,
      MCP_ORIGIN,
      CONFIGURED,
    );
    const init = { method: "POST", headers: { ...CONFIGURED } };

    await scoped(`${MCP_ORIGIN}/mcp`, init);
    expect(inner).toHaveBeenLastCalledWith(`${MCP_ORIGIN}/mcp`, init);

    // Not an absolute URL: left for the underlying fetch to reject.
    await scoped("/relative", init);
    expect(inner).toHaveBeenLastCalledWith("/relative", init);
  });

  it("takes the configured headers off a request to another origin", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(
      inner,
      MCP_ORIGIN,
      CONFIGURED,
    );

    // As the SDK merges them: configured first, the request's own on top.
    await scoped(`${AS_ORIGIN}/token`, {
      method: "POST",
      headers: { ...CONFIGURED, "MCP-Protocol-Version": "2025-11-25" },
    });

    expect(inner.mock.calls[0]?.[1]?.method).toBe("POST");
    // Negotiation and framing stay; the rest is gone.
    expect(sentHeaders(inner)).toEqual({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "mcp-protocol-version": "2025-11-25",
    });

    // Same host, another port: a different origin.
    await scoped(new URL("https://mcp.test:8443/token"), {
      headers: { ...CONFIGURED },
    });
    expect(sentHeaders(inner)["x-api-key"]).toBeUndefined();
  });

  it("keeps a header the request set for itself", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(
      inner,
      MCP_ORIGIN,
      CONFIGURED,
    );

    // The same key: the request's value replaced the configured one.
    await scoped(`${AS_ORIGIN}/token`, {
      headers: { ...CONFIGURED, Authorization: "Basic client-auth" },
    });
    expect(sentHeaders(inner).authorization).toBe("Basic client-auth");
    expect(sentHeaders(inner)["x-api-key"]).toBeUndefined();

    // The same name in another case: both keys survive the SDK's merge, and
    // only the configured one is removed.
    await scoped(`${AS_ORIGIN}/token`, {
      headers: { ...CONFIGURED, authorization: "Basic client-auth" },
    });
    expect(sentHeaders(inner).authorization).toBe("Basic client-auth");
  });

  it("removes a name configured under two spellings", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const twice = {
      Authorization: "Bearer A",
      authorization: "Bearer B",
    };
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, twice);

    // The request overwrote one spelling; the other still holds its value.
    await scoped(`${AS_ORIGIN}/token`, {
      headers: { ...twice, authorization: "Basic client-auth" },
    });
    expect(sentHeaders(inner)).toEqual({ authorization: "Basic client-auth" });

    // Neither overwritten, and already joined by `Headers`.
    await scoped(`${AS_ORIGIN}/token`, { headers: { ...twice } });
    expect(sentHeaders(inner)).toEqual({});
    await scoped(`${AS_ORIGIN}/token`, {
      headers: new Headers([["authorization", "Bearer A, Bearer B"]]),
    });
    expect(sentHeaders(inner)).toEqual({});
  });

  it("resolves a repeated tuple to its last value, as the SDK does", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const tuples: [string, string][] = [
      ["X-API-Key", "first"],
      ["X-API-Key", "mcp-secret"],
    ];
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, tuples);

    await scoped(`${AS_ORIGIN}/token`, {
      headers: { "X-API-Key": "mcp-secret", "X-Other": "kept" },
    });
    expect(sentHeaders(inner)).toEqual({ "x-other": "kept" });
  });

  it("reads a Request's own headers, and leaves an unaffected request alone", async () => {
    const inner = vi.fn<typeof fetch>(respond);
    const scoped = createOriginScopedHeadersFetch(inner, MCP_ORIGIN, {
      "X-API-Key": "mcp-secret",
    });

    await scoped(
      new Request(`${AS_ORIGIN}/token`, {
        headers: { "X-API-Key": "mcp-secret", "X-Other": "kept" },
      }),
    );
    expect(sentHeaders(inner)).toEqual({ "x-other": "kept" });

    const init = { headers: { "X-Other": "kept" } };
    await scoped(`${AS_ORIGIN}/token`, init);
    expect(inner).toHaveBeenLastCalledWith(`${AS_ORIGIN}/token`, init);

    // No headers at all.
    await scoped(`${AS_ORIGIN}/token`);
    expect(inner).toHaveBeenLastCalledWith(`${AS_ORIGIN}/token`, undefined);
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
          Accept: "application/vnd.example+json",
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
      // The MCP requests are the SDK's own build of `requestInit.headers`:
      // on streamable HTTP it unions a configured `Accept` with its own.
      const mcpPosts = sameOrigin.filter(({ method }) => method === "POST");
      if (config.type === "streamable-http") {
        expect(mcpPosts[0]?.headers.get("accept")).toBe(
          "application/vnd.example+json, application/json, text/event-stream",
        );
      }
      expect(
        mcpPosts.map(({ headers }) => headers.get("authorization")),
      ).toEqual(["Bearer stale", "Bearer fresh"]);
    });
  },
);
