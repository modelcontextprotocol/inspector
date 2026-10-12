import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDiscoveryUrls,
  discoverAuthorizationServerMetadata,
  startAuthorization,
} from "@modelcontextprotocol/client";
import {
  applyOAuthEndpointOverrides,
  authorizationServerForFinalCandidate,
  SYNTHESIZED_METADATA_HEADER,
  synthesizeAuthorizationServerMetadata,
  isAuthorizationServerMetadata,
  normalizeOAuthEndpointOverrides,
  oauthEndpointUrlError,
  withOAuthEndpointOverrides,
} from "@inspector/core/auth/endpointOverrides.js";
import {
  COMPAT_SOURCE_HEADER,
  withRfc8414OidcCompat,
} from "@inspector/core/auth/oidcDiscoveryCompat.js";

const METADATA = {
  issuer: "https://as.example.com",
  authorization_endpoint: "https://as.example.com/authorize",
  token_endpoint: "https://as.example.com/token",
  response_types_supported: ["code"],
};

const AS_METADATA_URL =
  "https://as.example.com/.well-known/oauth-authorization-server";
const STAGING_AUTHORIZE = "https://staging.example.com/authorize";
const STAGING_TOKEN = "https://staging.example.com/token";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** A `fetch` that always resolves to the same prepared response. */
function passThrough(response: Response): typeof fetch {
  return async () => response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("oauthEndpointUrlError", () => {
  it("accepts a blank value as 'no override'", () => {
    expect(oauthEndpointUrlError("")).toBeUndefined();
    expect(oauthEndpointUrlError("   ")).toBeUndefined();
  });

  it("accepts absolute http and https URLs", () => {
    expect(oauthEndpointUrlError(STAGING_AUTHORIZE)).toBeUndefined();
    expect(
      oauthEndpointUrlError("http://localhost:9000/token"),
    ).toBeUndefined();
  });

  it("rejects a relative path", () => {
    expect(oauthEndpointUrlError("/authorize")).toMatch(/not an absolute URL/);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(oauthEndpointUrlError("ftp://example.com/authorize")).toMatch(
      /not an http\(s\) URL/,
    );
  });

  // `new URL` accepts these, but Fetch rejects a request URL carrying them —
  // so without this check the value passes validation and fails mid-flow.
  it("rejects embedded credentials", () => {
    expect(
      oauthEndpointUrlError("https://user:pass@as.example.com/token"),
    ).toMatch(/username or password/);
    expect(oauthEndpointUrlError("https://user@as.example.com/token")).toMatch(
      /username or password/,
    );
  });
});

describe("normalizeOAuthEndpointOverrides", () => {
  it("returns undefined when nothing is configured", () => {
    expect(normalizeOAuthEndpointOverrides(undefined)).toBeUndefined();
    expect(normalizeOAuthEndpointOverrides({})).toBeUndefined();
    expect(
      normalizeOAuthEndpointOverrides({ authorizationUrl: "  " }),
    ).toBeUndefined();
  });

  it("trims and keeps each configured endpoint independently", () => {
    expect(
      normalizeOAuthEndpointOverrides({
        authorizationUrl: `  ${STAGING_AUTHORIZE} `,
      }),
    ).toEqual({ authorizationUrl: STAGING_AUTHORIZE });
    expect(
      normalizeOAuthEndpointOverrides({ tokenUrl: STAGING_TOKEN }),
    ).toEqual({ tokenUrl: STAGING_TOKEN });
  });

  it("drops a malformed value with a warning, keeping the valid sibling", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      normalizeOAuthEndpointOverrides({
        authorizationUrl: "not a url",
        tokenUrl: STAGING_TOKEN,
      }),
    ).toEqual({ tokenUrl: STAGING_TOKEN });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring `authorizationUrl`"),
    );
  });

  it("drops a URL with embedded credentials", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      normalizeOAuthEndpointOverrides({
        tokenUrl: "https://user:pass@as.example.com/token",
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("username or password"),
    );
  });

  it("returns undefined when every configured value is malformed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      normalizeOAuthEndpointOverrides({
        authorizationUrl: "ftp://example.com/a",
        tokenUrl: "also not a url",
      }),
    ).toBeUndefined();
  });
});

describe("isAuthorizationServerMetadata", () => {
  it("accepts a document with an issuer and at least one endpoint", () => {
    expect(isAuthorizationServerMetadata(METADATA)).toBe(true);
    expect(
      isAuthorizationServerMetadata({
        issuer: "https://as.example.com",
        token_endpoint: "https://as.example.com/token",
      }),
    ).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(isAuthorizationServerMetadata(null)).toBe(false);
    expect(isAuthorizationServerMetadata("nope")).toBe(false);
    expect(isAuthorizationServerMetadata([METADATA])).toBe(false);
  });

  it("rejects protected-resource metadata, which has no issuer", () => {
    expect(
      isAuthorizationServerMetadata({
        resource: "https://mcp.example.com",
        authorization_servers: ["https://as.example.com"],
      }),
    ).toBe(false);
  });

  it("rejects a document with an issuer but neither endpoint", () => {
    expect(
      isAuthorizationServerMetadata({ issuer: "https://as.example.com" }),
    ).toBe(false);
  });
});

describe("applyOAuthEndpointOverrides", () => {
  it("replaces only the configured endpoints and copies the rest", () => {
    const patched = applyOAuthEndpointOverrides(METADATA, {
      tokenUrl: STAGING_TOKEN,
    });
    expect(patched).toEqual({
      ...METADATA,
      token_endpoint: STAGING_TOKEN,
    });
    expect(METADATA.token_endpoint).toBe("https://as.example.com/token");
  });

  it("supplies an endpoint the document never advertised", () => {
    const patched = applyOAuthEndpointOverrides(
      { issuer: "https://as.example.com" },
      { authorizationUrl: STAGING_AUTHORIZE, tokenUrl: STAGING_TOKEN },
    );
    expect(patched).toEqual({
      issuer: "https://as.example.com",
      authorization_endpoint: STAGING_AUTHORIZE,
      token_endpoint: STAGING_TOKEN,
    });
  });
});

describe("withOAuthEndpointOverrides", () => {
  it("rewrites the endpoints of a metadata response", async () => {
    const base: typeof fetch = async () => jsonResponse(METADATA);
    const wrapped = withOAuthEndpointOverrides(base, () => ({
      authorizationUrl: STAGING_AUTHORIZE,
      tokenUrl: STAGING_TOKEN,
    }));

    const response = await wrapped(AS_METADATA_URL);
    await expect(response.json()).resolves.toEqual({
      ...METADATA,
      authorization_endpoint: STAGING_AUTHORIZE,
      token_endpoint: STAGING_TOKEN,
    });
    expect(response.status).toBe(200);
  });

  it("re-reads the overrides on every call, so a settings edit takes effect", async () => {
    const base: typeof fetch = async () => jsonResponse(METADATA);
    // Held in a box rather than a `let`: the resolver closes over it before the
    // first assignment, which is what the lazy read exists to support.
    const config: { overrides?: { tokenUrl?: string } } = {};
    const wrapped = withOAuthEndpointOverrides(base, () => config.overrides);

    const before = await wrapped(AS_METADATA_URL);
    await expect(before.json()).resolves.toMatchObject({
      token_endpoint: METADATA.token_endpoint,
    });

    config.overrides = { tokenUrl: STAGING_TOKEN };
    const after = await wrapped(AS_METADATA_URL);
    await expect(after.json()).resolves.toMatchObject({
      token_endpoint: STAGING_TOKEN,
    });
  });

  // The gate that keeps this wrapper off the hot path: an ordinary JSON-RPC
  // response is not even cloned, let alone parsed. Regression test for PR #2037.
  it("ignores a response to a request that is not metadata discovery", async () => {
    const original = jsonResponse(METADATA);
    const clone = vi.spyOn(original, "clone");
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));

    await expect(wrapped("https://mcp.example.com/mcp")).resolves.toBe(
      original,
    );
    expect(clone).not.toHaveBeenCalled();
  });

  it("recognizes discovery through every request-input form", async () => {
    const wrapped = withOAuthEndpointOverrides(
      // A fresh response per call: each patched one consumes its own clone.
      async () => jsonResponse(METADATA),
      () => ({ tokenUrl: STAGING_TOKEN }),
    );
    const oidcUrl = "https://as.example.com/.well-known/openid-configuration";
    for (const input of [
      AS_METADATA_URL,
      new URL(oidcUrl),
      new Request(`${AS_METADATA_URL}/tenant-a`),
    ]) {
      const response = await wrapped(input);
      await expect(response.json()).resolves.toMatchObject({
        token_endpoint: STAGING_TOKEN,
      });
    }
  });

  it("warns once about a malformed override, not on every request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base: typeof fetch = async () => jsonResponse(METADATA);
    const wrapped = withOAuthEndpointOverrides(base, () => ({
      tokenUrl: "not a url",
    }));

    await wrapped(AS_METADATA_URL);
    await wrapped(AS_METADATA_URL);
    await wrapped(AS_METADATA_URL);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes the response through untouched when nothing is configured", async () => {
    const original = jsonResponse(METADATA);
    const wrapped = withOAuthEndpointOverrides(
      passThrough(original),
      () => undefined,
    );
    await expect(wrapped(AS_METADATA_URL)).resolves.toBe(original);
  });

  it("leaves an error response alone", async () => {
    const original = jsonResponse(METADATA, { status: 404 });
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    await expect(wrapped(AS_METADATA_URL)).resolves.toBe(original);
  });

  it("leaves a non-JSON response alone", async () => {
    const original = new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    });
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    await expect(wrapped(AS_METADATA_URL)).resolves.toBe(original);
  });

  // Everything that is not a metadata document comes back as the caller's own
  // Response — identity, not an equivalent copy — so native properties a
  // synthesized Response cannot carry (`url`, `redirected`, `type`) survive.
  it("returns the original response for a JSON body that is not metadata", async () => {
    const original = jsonResponse({ access_token: "abc" });
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    const response = await wrapped(AS_METADATA_URL);
    expect(response).toBe(original);
    await expect(response.json()).resolves.toEqual({ access_token: "abc" });
  });

  it("returns the original response when the body is not valid JSON", async () => {
    const original = jsonResponse("not json at all");
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    const response = await wrapped(AS_METADATA_URL);
    expect(response).toBe(original);
    await expect(response.text()).resolves.toBe("not json at all");
  });

  // `application/x-ndjson` satisfies a naive `includes("json")` test, and the
  // streamable-HTTP transport serves its long-lived server-push channel that way
  // (see `isLongLivedStreamResponse`). Awaiting `.json()` on a clone of an
  // unbounded stream never resolves, so the MCP connection would hang for as
  // long as an override was configured. Regression test for PR #2037 review.
  it("does not read an unbounded NDJSON stream", async () => {
    // A body that never closes: if the wrapper reads it, this test times out.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"}\n'));
        // Deliberately never closed.
      },
    });
    const original = new Response(stream, {
      headers: { "content-type": "application/x-ndjson" },
    });
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    await expect(wrapped("https://mcp.example.com/mcp")).resolves.toBe(
      original,
    );
    await original.body?.cancel();
  });

  it("ignores content-type parameters when deciding a body is JSON", async () => {
    const wrapped = withOAuthEndpointOverrides(
      passThrough(
        new Response(JSON.stringify(METADATA), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
      () => ({ tokenUrl: STAGING_TOKEN }),
    );
    const response = await wrapped(AS_METADATA_URL);
    await expect(response.json()).resolves.toMatchObject({
      token_endpoint: STAGING_TOKEN,
    });
  });

  // Fetch forbids a body on 204/205, so rebuilding one would throw. A JSON
  // content-type on an empty response is unusual but legal, and it must not
  // take down an unrelated transport request.
  it("passes a body-less 204 through untouched", async () => {
    const original = new Response(null, {
      status: 204,
      headers: { "content-type": "application/json" },
    });
    const wrapped = withOAuthEndpointOverrides(passThrough(original), () => ({
      tokenUrl: STAGING_TOKEN,
    }));
    await expect(wrapped(AS_METADATA_URL)).resolves.toBe(original);
  });

  it("drops the stale content-length and content-encoding of a rewritten body", async () => {
    const body = JSON.stringify(METADATA);
    const wrapped = withOAuthEndpointOverrides(
      passThrough(
        new Response(body, {
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
            "content-encoding": "gzip",
          },
        }),
      ),
      () => ({ tokenUrl: STAGING_TOKEN }),
    );
    const response = await wrapped(AS_METADATA_URL);
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

// #2562: an authorization server that publishes no metadata at all. The SDK
// would fall back to `/authorize` and `/token` on its origin, so without a
// synthesized document the overrides had nothing to patch and were ignored.
describe("authorizationServerForFinalCandidate", () => {
  // The "last candidate" rule is a hand-written reading of the SDK's
  // `buildDiscoveryUrls`; pinning it against the SDK's own export keeps the two
  // from drifting if the SDK changes its candidate list.
  it.each([
    "https://gateway.example.com",
    "https://gateway.example.com/",
    "https://gateway.example.com/tenant",
    "https://gateway.example.com/tenant/",
  ])("identifies only the SDK's last candidate for %s", (asUrl) => {
    const candidates = buildDiscoveryUrls(asUrl).map((c) => c.url.href);
    const matched = candidates.map(authorizationServerForFinalCandidate);
    expect(matched.slice(0, -1)).toEqual(
      candidates.slice(0, -1).map(() => undefined),
    );
    expect(matched.at(-1)).toBe(asUrl.replace(/\/$/, ""));
  });

  it("rejects a URL that will not parse", () => {
    expect(authorizationServerForFinalCandidate("not a url")).toBeUndefined();
  });
});

describe("synthesizeAuthorizationServerMetadata", () => {
  it("uses the overrides and keeps the SDK's fallbacks for the rest", () => {
    expect(
      synthesizeAuthorizationServerMetadata("https://gateway.example.com/t", {
        authorizationUrl: STAGING_AUTHORIZE,
      }),
    ).toEqual({
      issuer: "https://gateway.example.com/t",
      authorization_endpoint: STAGING_AUTHORIZE,
      token_endpoint: "https://gateway.example.com/token",
      registration_endpoint: "https://gateway.example.com/register",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("uses the token override with the authorize fallback", () => {
    expect(
      synthesizeAuthorizationServerMetadata("https://gateway.example.com", {
        tokenUrl: STAGING_TOKEN,
      }),
    ).toMatchObject({
      authorization_endpoint: "https://gateway.example.com/authorize",
      token_endpoint: STAGING_TOKEN,
    });
  });
});

describe("withOAuthEndpointOverrides with no published metadata (#2562)", () => {
  const FINAL_CANDIDATE =
    "https://gateway.example.com/.well-known/openid-configuration";
  const OVERRIDES = {
    authorizationUrl: STAGING_AUTHORIZE,
    tokenUrl: STAGING_TOKEN,
  };

  function silenceWarn() {
    return vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it("answers a failed final candidate with a synthesized document", async () => {
    const warn = silenceWarn();
    const wrapped = withOAuthEndpointOverrides(
      passThrough(new Response("nope", { status: 404 })),
      () => OVERRIDES,
    );
    const response = await wrapped(FINAL_CANDIDATE);
    expect(response.status).toBe(200);
    expect(response.headers.get(SYNTHESIZED_METADATA_HEADER)).toBe(
      "endpoint-overrides",
    );
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://gateway.example.com",
      authorization_endpoint: STAGING_AUTHORIZE,
      token_endpoint: STAGING_TOKEN,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("treats a 502 like a 404, as the SDK does", async () => {
    silenceWarn();
    const wrapped = withOAuthEndpointOverrides(
      passThrough(new Response("bad gateway", { status: 502 })),
      () => OVERRIDES,
    );
    await expect(wrapped(FINAL_CANDIDATE)).resolves.toHaveProperty(
      "status",
      200,
    );
  });

  it("leaves a 500 alone — the SDK surfaces it as an outage", async () => {
    const original = new Response("boom", { status: 500 });
    const wrapped = withOAuthEndpointOverrides(
      passThrough(original),
      () => OVERRIDES,
    );
    await expect(wrapped(FINAL_CANDIDATE)).resolves.toBe(original);
  });

  it("does not synthesize on an earlier candidate", async () => {
    const original = new Response("nope", { status: 404 });
    const wrapped = withOAuthEndpointOverrides(
      passThrough(original),
      () => OVERRIDES,
    );
    // Root RFC 8414 candidate: the OIDC candidate after it may still answer.
    await expect(wrapped(AS_METADATA_URL)).resolves.toBe(original);
  });

  it("does not synthesize for a non-GET request", async () => {
    const original = new Response("nope", { status: 404 });
    const wrapped = withOAuthEndpointOverrides(
      passThrough(original),
      () => OVERRIDES,
    );
    await expect(
      wrapped(new Request(FINAL_CANDIDATE, { method: "POST" })),
    ).resolves.toBe(original);
    await expect(wrapped(FINAL_CANDIDATE, { method: "post" })).resolves.toBe(
      original,
    );
  });

  it("recognizes a GET Request object", async () => {
    silenceWarn();
    const wrapped = withOAuthEndpointOverrides(
      passThrough(new Response("nope", { status: 404 })),
      () => OVERRIDES,
    );
    await expect(wrapped(new Request(FINAL_CANDIDATE))).resolves.toHaveProperty(
      "status",
      200,
    );
  });

  it("does nothing when no override is configured", async () => {
    const original = new Response("nope", { status: 404 });
    const wrapped = withOAuthEndpointOverrides(
      passThrough(original),
      () => undefined,
    );
    await expect(wrapped(FINAL_CANDIDATE)).resolves.toBe(original);
  });

  // The compat wrapper hands the synthesized document to discovery, but must
  // not attribute it to the server or warn that the server returned it.
  it("passes through the compat wrapper as synthesized, not as the server's", async () => {
    const warn = silenceWarn();
    const fetchFn = withRfc8414OidcCompat(
      withOAuthEndpointOverrides(
        async () => new Response("nope", { status: 404 }),
        () => OVERRIDES,
      ),
    );
    const response = await fetchFn(AS_METADATA_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get(SYNTHESIZED_METADATA_HEADER)).toBe(
      "endpoint-overrides",
    );
    expect(response.headers.get(COMPAT_SOURCE_HEADER)).toBeNull();
    // Only the overrides wrapper's own warning — not the compat one.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain(
      "publishes no authorization server metadata",
    );
  });

  // The issue's reproduction, through the SDK's own discovery and
  // authorization-URL construction: a server with no metadata anywhere, and
  // the compat wrapper outermost exactly as `InspectorClient` composes it.
  it.each(["https://gateway.example.com/", "https://gateway.example.com/api"])(
    "sends the SDK's authorization request to the override for %s",
    async (asUrl) => {
      silenceWarn();
      const fetchFn = withRfc8414OidcCompat(
        withOAuthEndpointOverrides(
          async () => new Response("nope", { status: 404 }),
          () => OVERRIDES,
        ),
      );
      const metadata = await discoverAuthorizationServerMetadata(asUrl, {
        fetchFn,
      });
      expect(metadata?.token_endpoint).toBe(STAGING_TOKEN);
      const { authorizationUrl } = await startAuthorization(asUrl, {
        metadata,
        clientInformation: { client_id: "client-123" },
        redirectUrl: "http://127.0.0.1:6274/oauth/callback",
        scope: "api://app/scope",
      });
      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        STAGING_AUTHORIZE,
      );
      expect(authorizationUrl.searchParams.get("client_id")).toBe("client-123");
    },
  );
});
