import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

const {
  sdkAuth,
  discoverOAuthServerInfo,
  startAuthorization,
  selectResourceURL,
} = vi.hoisted(() => ({
  sdkAuth: vi.fn(),
  discoverOAuthServerInfo: vi.fn(),
  startAuthorization: vi.fn(),
  selectResourceURL: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@modelcontextprotocol/sdk/client/auth.js")
    >();
  return {
    ...actual,
    auth: sdkAuth,
    discoverOAuthServerInfo,
    selectResourceURL,
    startAuthorization,
  };
});

import { mcpAuth } from "@inspector/core/auth/mcpAuth.js";

function makeProvider(): OAuthClientProvider {
  return {
    redirectUrl: "http://localhost/callback",
    clientMetadata: {
      redirect_uris: ["http://localhost/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "test",
      client_uri: "https://example.com",
      scope: "",
    },
    clientInformation: vi.fn().mockResolvedValue({ client_id: "cid" }),
    tokens: vi.fn(),
    saveTokens: vi.fn(),
    redirectToAuthorization: vi.fn(),
    saveCodeVerifier: vi.fn(),
    codeVerifier: vi.fn().mockReturnValue("verifier"),
  };
}

describe("mcpAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to SDK auth() when forceReauthorization is not set", async () => {
    sdkAuth.mockResolvedValue("AUTHORIZED");
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      fetchFn: fetch,
    });

    expect(result).toBe("AUTHORIZED");
    expect(sdkAuth).toHaveBeenCalledWith(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      scope: undefined,
      resourceMetadataUrl: undefined,
      fetchFn: fetch,
    });
    expect(discoverOAuthServerInfo).not.toHaveBeenCalled();
  });

  it("uses discovery + startAuthorization when forceReauthorization is true", async () => {
    discoverOAuthServerInfo.mockResolvedValue({
      authorizationServerUrl: "https://as.example.com",
      authorizationServerMetadata: { issuer: "https://as.example.com" },
      resourceMetadata: undefined,
    });
    selectResourceURL.mockResolvedValue(undefined);
    startAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://as.example.com/authorize"),
      codeVerifier: "cv",
    });
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      scope: "mcp weather:read",
      forceReauthorization: true,
      fetchFn: fetch,
    });

    expect(result).toBe("REDIRECT");
    expect(sdkAuth).not.toHaveBeenCalled();
    expect(startAuthorization).toHaveBeenCalled();
    expect(provider.saveCodeVerifier).toHaveBeenCalledWith("cv");
    expect(provider.redirectToAuthorization).toHaveBeenCalled();
  });
});
