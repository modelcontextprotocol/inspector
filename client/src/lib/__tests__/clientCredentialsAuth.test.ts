import {
  buildClientCredentialsRequest,
  exchangeClientCredentials,
} from "../clientCredentialsAuth";

describe("buildClientCredentialsRequest", () => {
  it("uses HTTP Basic auth by default and form-encodes the body", () => {
    const { headers, body } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-client",
      clientSecret: "s3cr3t",
    });

    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.has("client_id")).toBe(false);
    expect(body.has("client_secret")).toBe(false);

    expect(headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(headers.Accept).toBe("application/json");
    // base64("my-client:s3cr3t") = "bXktY2xpZW50OnMzY3IzdA=="
    expect(headers.Authorization).toBe("Basic bXktY2xpZW50OnMzY3IzdA==");
  });

  it("includes the optional scope when provided (trimmed)", () => {
    const { body } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      scope: "  read write  ",
    });

    expect(body.get("scope")).toBe("read write");
  });

  it("omits scope when blank or whitespace", () => {
    const { body } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      scope: "   ",
    });

    expect(body.has("scope")).toBe(false);
  });

  it("includes optional RFC 8707 resource when provided", () => {
    const { body } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      resource: "https://mcp.example.com/api",
    });

    expect(body.get("resource")).toBe("https://mcp.example.com/api");
  });

  it("sends client credentials in the body when authMethod=body", () => {
    const { headers, body } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-client",
      clientSecret: "s3cr3t",
      authMethod: "body",
    });

    expect(headers.Authorization).toBeUndefined();
    expect(body.get("client_id")).toBe("my-client");
    expect(body.get("client_secret")).toBe("s3cr3t");
  });

  it("URL-encodes special characters in basic credentials", () => {
    const { headers } = buildClientCredentialsRequest({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "id with space",
      clientSecret: "p:w@rd",
    });

    // encodeURIComponent("id with space") = "id%20with%20space"
    // encodeURIComponent("p:w@rd") = "p%3Aw%40rd"
    // base64("id%20with%20space:p%3Aw%40rd") = "aWQlMjB3aXRoJTIwc3BhY2U6cCUzQXclNDByZA=="
    expect(headers.Authorization).toBe(
      "Basic aWQlMjB3aXRoJTIwc3BhY2U6cCUzQXclNDByZA==",
    );
  });
});

describe("exchangeClientCredentials", () => {
  const baseInput = {
    tokenEndpoint: "https://auth.example.com/token",
    clientId: "my-client",
    clientSecret: "s3cr3t",
  };

  it("POSTs to the token endpoint and returns parsed tokens on success", async () => {
    const fetchFn = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "tkn",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read write",
        }),
        {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const tokens = await exchangeClientCredentials(
      { ...baseInput, scope: "read write" },
      fetchFn,
    );

    expect(tokens.access_token).toBe("tkn");
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe("read write");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://auth.example.com/token");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    const sentBody = init.body as URLSearchParams;
    expect(sentBody.get("grant_type")).toBe("client_credentials");
    expect(sentBody.get("scope")).toBe("read write");
  });

  it("throws with the OAuth error payload on a non-2xx response", async () => {
    const fetchFn = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "secret rejected",
        }),
        {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await expect(
      exchangeClientCredentials(baseInput, fetchFn),
    ).rejects.toThrow(/invalid_client.*secret rejected/);
  });

  it("falls back to status line when error body is not JSON", async () => {
    const fetchFn = jest.fn(async () => {
      return new Response("oops", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }) as unknown as typeof fetch;

    await expect(
      exchangeClientCredentials(baseInput, fetchFn),
    ).rejects.toThrow(/500/);
  });
});
