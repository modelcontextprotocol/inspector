import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyOAuthEndpointOverrides,
  isAuthorizationServerMetadata,
  normalizeOAuthEndpointOverrides,
  oauthEndpointUrlError,
  withOAuthEndpointOverrides,
} from "@inspector/core/auth/endpointOverrides.js";

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
