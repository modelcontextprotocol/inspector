import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";

const { sdkAuth } = vi.hoisted(() => ({
  sdkAuth: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    auth: sdkAuth,
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

  it("forwards the authorization-code exchange (incl. iss) to SDK auth()", async () => {
    sdkAuth.mockResolvedValue("AUTHORIZED");
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      iss: "https://as.example.com",
      fetchFn: fetch,
    });

    expect(result).toBe("AUTHORIZED");
    expect(sdkAuth).toHaveBeenCalledWith(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      iss: "https://as.example.com",
      scope: undefined,
      resourceMetadataUrl: undefined,
      fetchFn: fetch,
      skipIssuerMetadataValidation: undefined,
      forceReauthorization: undefined,
    });
  });

  it("forwards forceReauthorization + skipIssuerMetadataValidation to SDK auth()", async () => {
    sdkAuth.mockResolvedValue("REDIRECT");
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      scope: "mcp weather:read",
      forceReauthorization: true,
      skipIssuerMetadataValidation: true,
    });

    expect(result).toBe("REDIRECT");
    expect(sdkAuth).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        scope: "mcp weather:read",
        forceReauthorization: true,
        skipIssuerMetadataValidation: true,
      }),
    );
  });

  it("rejects forceReauthorization combined with authorizationCode without calling SDK auth()", async () => {
    const provider = makeProvider();

    await expect(
      mcpAuth(provider, {
        serverUrl: "https://mcp.example.com",
        authorizationCode: "code",
        forceReauthorization: true,
      }),
    ).rejects.toThrow(
      "forceReauthorization cannot be combined with authorizationCode",
    );
    expect(sdkAuth).not.toHaveBeenCalled();
  });

  it("propagates the SDK auth() rejection", async () => {
    sdkAuth.mockRejectedValue(new Error("discovery failed"));
    const provider = makeProvider();

    await expect(
      mcpAuth(provider, { serverUrl: "https://mcp.example.com" }),
    ).rejects.toThrow("discovery failed");
  });
});
