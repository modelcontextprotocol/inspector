import { describe, it, expect, vi } from "vitest";
import type {
  OAuthClientInformation,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  parseOAuthTokenErrorResponse,
  postOAuthTokenRequest,
} from "@inspector/core/auth/ema/tokenEndpoint.js";
import { minimalOAuthAsMetadata } from "../../../integration/mcp/ema-mock-servers.js";

const TOKEN_URL = new URL("https://as.test/token");
const STEP = "EMA test step";

function metadataWithAuthMethods(methods: string[]): OAuthMetadata {
  return {
    ...minimalOAuthAsMetadata("https://as.test"),
    token_endpoint_auth_methods_supported: methods,
  } as OAuthMetadata;
}

describe("parseOAuthTokenErrorResponse", () => {
  it("returns a generic error when the body is not JSON", async () => {
    const response = new Response("totally not json", { status: 503 });
    const error = await parseOAuthTokenErrorResponse(response, STEP);
    expect(error.message).toBe(`${STEP}: token request failed (HTTP 503)`);
  });

  it("includes error and error_description from a structured body", async () => {
    const response = new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "the grant expired",
      }),
      { status: 400 },
    );
    const error = await parseOAuthTokenErrorResponse(response, STEP);
    expect(error.message).toBe(
      `${STEP}: error=invalid_grant: the grant expired`,
    );
  });

  it("includes only the error code when no description is present", async () => {
    const response = new Response(JSON.stringify({ error: "invalid_client" }), {
      status: 401,
    });
    const error = await parseOAuthTokenErrorResponse(response, STEP);
    expect(error.message).toBe(`${STEP}: error=invalid_client`);
  });

  it("falls back to a generic error when the JSON body has no error fields", async () => {
    const response = new Response(JSON.stringify({ unrelated: true }), {
      status: 500,
    });
    const error = await parseOAuthTokenErrorResponse(response, STEP);
    expect(error.message).toBe(`${STEP}: token request failed (HTTP 500)`);
  });

  it("falls back to a generic error when the JSON body is null", async () => {
    const response = new Response(JSON.stringify(null), { status: 502 });
    const error = await parseOAuthTokenErrorResponse(response, STEP);
    expect(error.message).toBe(`${STEP}: token request failed (HTTP 502)`);
  });
});

describe("postOAuthTokenRequest", () => {
  const clientInfo: OAuthClientInformation = {
    client_id: "client-abc",
    client_secret: "secret-xyz",
  } as OAuthClientInformation;

  it("uses HTTP Basic auth when the server supports client_secret_basic", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: URLSearchParams | undefined;
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = init?.body as URLSearchParams;
        return new Response(JSON.stringify({ ok: true }));
      },
    );

    const body = new URLSearchParams({ grant_type: "refresh_token" });
    await postOAuthTokenRequest(
      TOKEN_URL,
      body,
      metadataWithAuthMethods(["client_secret_basic"]),
      clientInfo,
      fetchFn,
    );

    const expected = `Basic ${btoa("client-abc:secret-xyz")}`;
    expect(capturedHeaders?.get("Authorization")).toBe(expected);
    // Credentials must NOT be in the body for basic auth.
    expect(capturedBody?.get("client_id")).toBeNull();
    expect(capturedBody?.get("client_secret")).toBeNull();
  });

  it("posts client credentials in the body for client_secret_post", async () => {
    let capturedBody: URLSearchParams | undefined;
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as URLSearchParams;
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }));
      },
    );

    const body = new URLSearchParams({ grant_type: "refresh_token" });
    await postOAuthTokenRequest(
      TOKEN_URL,
      body,
      metadataWithAuthMethods(["client_secret_post"]),
      clientInfo,
      fetchFn,
    );

    expect(capturedBody?.get("client_id")).toBe("client-abc");
    expect(capturedBody?.get("client_secret")).toBe("secret-xyz");
    expect(capturedHeaders?.get("Authorization")).toBeNull();
    expect(capturedHeaders?.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("falls back to public-client (client_id only) when no secret is present", async () => {
    let capturedBody: URLSearchParams | undefined;
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as URLSearchParams;
        return new Response(JSON.stringify({ ok: true }));
      },
    );

    const publicClient = {
      client_id: "public-client",
    } as OAuthClientInformation;
    const body = new URLSearchParams({ grant_type: "refresh_token" });
    await postOAuthTokenRequest(
      TOKEN_URL,
      body,
      metadataWithAuthMethods(["none"]),
      publicClient,
      fetchFn,
    );

    expect(capturedBody?.get("client_id")).toBe("public-client");
    expect(capturedBody?.get("client_secret")).toBeNull();
  });

  it("falls back to the global fetch when no fetchFn is provided", async () => {
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const body = new URLSearchParams({ grant_type: "refresh_token" });
    await postOAuthTokenRequest(
      TOKEN_URL,
      body,
      metadataWithAuthMethods(["client_secret_post"]),
      clientInfo,
    );

    expect(globalSpy).toHaveBeenCalledTimes(1);
    expect(globalSpy.mock.calls[0]?.[0]).toBe(TOKEN_URL);
    globalSpy.mockRestore();
  });

  it("defaults to an empty supported-methods list when metadata is undefined", async () => {
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }));
      },
    );

    const body = new URLSearchParams({ grant_type: "refresh_token" });
    await postOAuthTokenRequest(
      TOKEN_URL,
      body,
      undefined,
      clientInfo,
      fetchFn,
    );

    // With no advertised methods and a secret present, the SDK defaults to
    // client_secret_basic, so credentials land in the Authorization header.
    expect(capturedHeaders?.get("Authorization")).toBe(
      `Basic ${btoa("client-abc:secret-xyz")}`,
    );
  });
});
