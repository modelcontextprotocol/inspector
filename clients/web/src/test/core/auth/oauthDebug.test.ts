import { describe, it, expect, vi } from "vitest";
import {
  classifyOAuthRequest,
  describeAuthorizationUrl,
  describeResponseJson,
  OAUTH_DEBUG_PREFIX,
  redactFormParams,
  redactJson,
  redactUrl,
  REDACTED,
  withOAuthDebugTrace,
} from "@inspector/core/auth/oauthDebug.js";

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "content-type": "application/json" },
  });
}

/** Run one request through the trace and return the lines it wrote. */
async function trace(
  response: Response | Error,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ lines: string[]; result: Response | unknown }> {
  const lines: string[] = [];
  const base = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const traced = withOAuthDebugTrace(base, (line) => lines.push(line));
  let result: Response | unknown;
  try {
    result = await traced(input, init);
  } catch (error) {
    result = error;
  }
  return { lines, result };
}

describe("classifyOAuthRequest", () => {
  it("names discovery from the well-known path", () => {
    expect(
      classifyOAuthRequest(
        "https://rs.example/.well-known/oauth-protected-resource/mcp",
        "GET",
        undefined,
      ),
    ).toBe("protected-resource metadata");
    expect(
      classifyOAuthRequest(
        "https://as.example/.well-known/oauth-authorization-server",
        "GET",
        undefined,
      ),
    ).toBe("authorization-server metadata");
    expect(
      classifyOAuthRequest(
        "https://as.example/.well-known/openid-configuration",
        "GET",
        undefined,
      ),
    ).toBe("authorization-server metadata");
  });

  it("names a POST by what it carries", () => {
    const url = "https://as.example/endpoint";
    expect(
      classifyOAuthRequest(
        url,
        "POST",
        new URLSearchParams({ grant_type: "authorization_code" }),
      ),
    ).toBe("token request");
    expect(
      classifyOAuthRequest(url, "POST", "token=abc&token_type_hint=x"),
    ).toBe("token revocation");
    expect(
      classifyOAuthRequest(
        url,
        "POST",
        JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"] }),
      ),
    ).toBe("client registration");
    expect(
      classifyOAuthRequest(url, "POST", JSON.stringify({ client_name: "x" })),
    ).toBe("client registration");
  });

  it("falls back to a generic request", () => {
    expect(classifyOAuthRequest("not a url", "GET", undefined)).toBe("request");
    expect(
      classifyOAuthRequest("https://as.example/x", "POST", "{not json"),
    ).toBe("request");
    expect(
      classifyOAuthRequest("https://as.example/x", "POST", JSON.stringify([1])),
    ).toBe("request");
    expect(
      classifyOAuthRequest(
        "https://as.example/x",
        "POST",
        JSON.stringify({ other: 1 }),
      ),
    ).toBe("request");
    expect(classifyOAuthRequest("https://as.example/x", "POST", 42)).toBe(
      "request",
    );
    expect(classifyOAuthRequest("https://as.example/x", "PUT", "a=b")).toBe(
      "request",
    );
  });
});

describe("redaction", () => {
  it("redacts only sensitive query parameters", () => {
    expect(redactUrl("https://x.example/cb?code=abc&state=s1")).toBe(
      `https://x.example/cb?code=${encodeURIComponent(REDACTED)}&state=s1`,
    );
    expect(redactUrl("https://x.example/a?scope=read")).toBe(
      "https://x.example/a?scope=read",
    );
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("redacts sensitive form fields and keeps the rest", () => {
    expect(
      redactFormParams(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "c",
          code_verifier: "v",
          client_id: "id",
        }),
      ),
    ).toBe(
      `grant_type=authorization_code code=${REDACTED} code_verifier=${REDACTED} client_id=id`,
    );
  });

  it("redacts sensitive JSON keys at any depth", () => {
    expect(
      redactJson({
        access_token: "a",
        nested: { client_secret: "s", ok: 1 },
        list: [{ refresh_token: "r" }, "plain"],
        scope: "read",
      }),
    ).toEqual({
      access_token: REDACTED,
      nested: { client_secret: REDACTED, ok: 1 },
      list: [{ refresh_token: REDACTED }, "plain"],
      scope: "read",
    });
    expect(redactJson("x")).toBe("x");
  });
});

describe("describeResponseJson", () => {
  it("picks the routing fields of metadata documents", () => {
    expect(
      describeResponseJson("protected-resource metadata", 200, {
        resource: "https://rs.example/mcp",
        authorization_servers: ["https://as.example"],
        bearer_methods_supported: ["header"],
      }),
    ).toBe(
      JSON.stringify({
        resource: "https://rs.example/mcp",
        authorization_servers: ["https://as.example"],
      }),
    );
    expect(
      describeResponseJson("authorization-server metadata", 200, {
        issuer: "https://as.example",
        token_endpoint: "https://as.example/token",
        response_types_supported: ["code"],
      }),
    ).toBe(
      JSON.stringify({
        issuer: "https://as.example",
        token_endpoint: "https://as.example/token",
      }),
    );
  });

  it("shows registration and token responses whole, redacted", () => {
    expect(
      describeResponseJson("client registration", 201, {
        client_id: "id",
        client_secret: "s",
      }),
    ).toBe(JSON.stringify({ client_id: "id", client_secret: REDACTED }));
    expect(
      describeResponseJson("token request", 200, {
        access_token: "a",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    ).toBe(
      JSON.stringify({
        access_token: REDACTED,
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
  });

  it("shows the OAuth error of a failed response", () => {
    expect(
      describeResponseJson("token request", 400, {
        error: "invalid_grant",
        error_description: "expired",
        access_token: "never-shown",
      }),
    ).toBe(
      JSON.stringify({ error: "invalid_grant", error_description: "expired" }),
    );
    expect(describeResponseJson("token request", 500, { other: 1 })).toBe("");
  });

  it("says nothing for other steps or non-object bodies", () => {
    expect(describeResponseJson("request", 200, { a: 1 })).toBe("");
    expect(describeResponseJson("token revocation", 200, { a: 1 })).toBe("");
    expect(describeResponseJson("token request", 200, [1])).toBe("");
    expect(describeResponseJson("token request", 200, undefined)).toBe("");
  });
});

describe("URL values in trace summaries", () => {
  const leaky = "https://as.example/token?client_secret=SECRET&x=1";
  const redacted = redactUrl(leaky);

  it("redacts credentials embedded in metadata, error and registration URLs", () => {
    expect(redacted).not.toContain("SECRET");
    const asMeta = describeResponseJson("authorization-server metadata", 200, {
      issuer: "https://as.example",
      token_endpoint: leaky,
    });
    const prm = describeResponseJson("protected-resource metadata", 200, {
      authorization_servers: [leaky],
    });
    const error = describeResponseJson("token request", 400, {
      error: "invalid_client",
      error_uri: leaky,
    });
    const registration = describeResponseJson("client registration", 201, {
      client_id: "id",
      redirect_uris: [leaky],
      nested: { uri: leaky },
      count: 1,
    });
    for (const summary of [asMeta, prm, error, registration]) {
      expect(summary).not.toContain("SECRET");
      expect(summary).toContain(JSON.stringify(redacted).slice(1, -1));
    }
  });

  it("redacts credentials embedded in request body URLs", async () => {
    const { lines: form } = await trace(
      jsonResponse({}),
      "https://as.example/token",
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          redirect_uri: leaky,
        }),
      },
    );
    const { lines: json } = await trace(
      jsonResponse({}),
      "https://as.example/register",
      { method: "POST", body: JSON.stringify({ redirect_uris: [leaky] }) },
    );
    expect(form[0]).not.toContain("SECRET");
    expect(json[0]).not.toContain("SECRET");
  });
});

describe("withOAuthDebugTrace", () => {
  it("traces a token request and its response, redacting credentials", async () => {
    const { lines, result } = await trace(
      jsonResponse(
        { access_token: "SECRET-AT", token_type: "Bearer" },
        { statusText: "OK" },
      ),
      "https://as.example/token",
      {
        method: "POST",
        headers: { Authorization: "Basic Y2xpZW50OnNlY3JldA==" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "SECRET-CODE",
          client_id: "id",
        }),
      },
    );
    expect(lines).toEqual([
      `${OAUTH_DEBUG_PREFIX} token request: POST https://as.example/token grant_type=authorization_code code=${REDACTED} client_id=id (Authorization: Basic ${REDACTED})\n`,
      `${OAUTH_DEBUG_PREFIX}   -> 200 OK ${JSON.stringify({ access_token: REDACTED, token_type: "Bearer" })}\n`,
    ]);
    expect(lines.join("")).not.toMatch(/SECRET|Y2xpZW50/);
    // The caller still gets an unread body.
    expect(await (result as Response).json()).toEqual({
      access_token: "SECRET-AT",
      token_type: "Bearer",
    });
  });

  it("traces a JSON registration body", async () => {
    const { lines } = await trace(
      jsonResponse({ client_id: "id" }, { status: 201 }),
      new URL("https://as.example/register"),
      {
        method: "post",
        body: JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"] }),
      },
    );
    expect(lines[0]).toBe(
      `${OAUTH_DEBUG_PREFIX} client registration: POST https://as.example/register ${JSON.stringify({ redirect_uris: ["http://127.0.0.1/cb"] })}\n`,
    );
    expect(lines[1]).toBe(
      `${OAUTH_DEBUG_PREFIX}   -> 201 ${JSON.stringify({ client_id: "id" })}\n`,
    );
  });

  it("traces a Request input and a non-JSON response", async () => {
    const { lines } = await trace(
      new Response("<html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
      new Request(
        "https://rs.example/.well-known/oauth-protected-resource/mcp",
        { method: "GET" },
      ),
    );
    expect(lines).toEqual([
      `${OAUTH_DEBUG_PREFIX} protected-resource metadata: GET https://rs.example/.well-known/oauth-protected-resource/mcp\n`,
      `${OAUTH_DEBUG_PREFIX}   -> 404\n`,
    ]);
  });

  it("omits an unparseable JSON body and an unknown JSON request body", async () => {
    const { lines } = await trace(
      new Response("{oops", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      "https://as.example/x",
      { method: "POST", body: JSON.stringify({ other: 1 }) },
    );
    expect(lines).toEqual([
      `${OAUTH_DEBUG_PREFIX} request: POST https://as.example/x\n`,
      `${OAUTH_DEBUG_PREFIX}   -> 200\n`,
    ]);
  });

  it("traces a response with no content type", async () => {
    const { lines } = await trace(
      new Response(null, { status: 204 }),
      "https://as.example/x",
    );
    expect(lines[1]).toBe(`${OAUTH_DEBUG_PREFIX}   -> 204\n`);
  });

  it("traces a failed request and rethrows the error unchanged", async () => {
    const error = new Error("Refused to fetch");
    const { lines, result } = await trace(error, "https://169.254.169.254/x");
    expect(result).toBe(error);
    expect(lines[1]).toBe(
      `${OAUTH_DEBUG_PREFIX}   -> failed: Refused to fetch\n`,
    );
  });

  it("stringifies a non-Error rejection", async () => {
    const lines: string[] = [];
    const traced = withOAuthDebugTrace(
      () => Promise.reject("plain string"),
      (line) => lines.push(line),
    );
    await expect(traced("https://as.example/x")).rejects.toBe("plain string");
    expect(lines[1]).toBe(`${OAUTH_DEBUG_PREFIX}   -> failed: plain string\n`);
  });
});

describe("describeAuthorizationUrl", () => {
  it("prints the authorize URL as one trace line", () => {
    expect(
      describeAuthorizationUrl(
        new URL("https://as.example/authorize?client_id=id&state=s"),
      ),
    ).toBe(
      `${OAUTH_DEBUG_PREFIX} authorization: open https://as.example/authorize?client_id=id&state=s\n`,
    );
  });
});
