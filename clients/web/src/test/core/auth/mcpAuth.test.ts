import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

const {
  sdkAuth,
  discoverOAuthServerInfo,
  startAuthorization,
  selectResourceURL,
  registerClient,
  isHttpsUrl,
} = vi.hoisted(() => ({
  sdkAuth: vi.fn(),
  discoverOAuthServerInfo: vi.fn(),
  startAuthorization: vi.fn(),
  selectResourceURL: vi.fn(),
  registerClient: vi.fn(),
  isHttpsUrl: vi.fn(),
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
    registerClient,
    isHttpsUrl,
  };
});

import { mcpAuth } from "@inspector/core/auth/mcpAuth.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

function makeProvider(
  overrides: Partial<OAuthClientProvider> = {},
): OAuthClientProvider {
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
    ...overrides,
  };
}

/**
 * Arrange the discovery + authorization mocks used by the
 * `forceReauthorization` (authorize-without-refresh) path.
 */
function stubForcePath(
  discovery: Partial<{
    authorizationServerUrl: string;
    authorizationServerMetadata: Record<string, unknown>;
    resourceMetadata: unknown;
  }> = {},
): void {
  discoverOAuthServerInfo.mockResolvedValue({
    authorizationServerUrl: "https://as.example.com",
    authorizationServerMetadata: { issuer: "https://as.example.com" },
    resourceMetadata: undefined,
    ...discovery,
  });
  selectResourceURL.mockResolvedValue(undefined);
  startAuthorization.mockResolvedValue({
    authorizationUrl: new URL("https://as.example.com/authorize"),
    codeVerifier: "cv",
  });
}

describe("mcpAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isHttpsUrl.mockReturnValue(true);
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

  it("rejects forceReauthorization combined with authorizationCode", async () => {
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
    expect(discoverOAuthServerInfo).not.toHaveBeenCalled();
  });

  it("uses discovery + startAuthorization when forceReauthorization is true", async () => {
    stubForcePath();
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

  it("persists discovery state and forwards the selected resource + state", async () => {
    stubForcePath({
      resourceMetadata: { resource: "https://mcp.example.com" },
    });
    selectResourceURL.mockResolvedValue(new URL("https://mcp.example.com/r"));
    const saveDiscoveryState = vi.fn().mockResolvedValue(undefined);
    const state = vi.fn().mockResolvedValue("state-123");
    const provider = makeProvider({ saveDiscoveryState, state });

    await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      resourceMetadataUrl: new URL("https://mcp.example.com/.well-known/x"),
      forceReauthorization: true,
    });

    expect(saveDiscoveryState).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationServerUrl: "https://as.example.com",
        resourceMetadataUrl: "https://mcp.example.com/.well-known/x",
      }),
    );
    expect(state).toHaveBeenCalled();
    expect(startAuthorization).toHaveBeenCalledWith(
      "https://as.example.com",
      expect.objectContaining({
        state: "state-123",
        resource: new URL("https://mcp.example.com/r"),
      }),
    );
  });

  it("derives scope from resourceMetadata.scopes_supported when no scope given", async () => {
    stubForcePath({
      resourceMetadata: { scopes_supported: ["mcp", "weather:read"] },
    });
    const provider = makeProvider();

    await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      forceReauthorization: true,
    });

    expect(startAuthorization).toHaveBeenCalledWith(
      "https://as.example.com",
      expect.objectContaining({ scope: "mcp weather:read" }),
    );
  });

  it("falls back to clientMetadata.scope when nothing else provides scope", async () => {
    stubForcePath();
    const provider = makeProvider({
      clientMetadata: {
        ...makeProvider().clientMetadata,
        scope: "fallback:scope",
      },
    });

    await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      forceReauthorization: true,
    });

    expect(startAuthorization).toHaveBeenCalledWith(
      "https://as.example.com",
      expect.objectContaining({ scope: "fallback:scope" }),
    );
  });

  it("dynamically registers a client when no client information exists", async () => {
    stubForcePath();
    registerClient.mockResolvedValue({ client_id: "registered" });
    const saveClientInformation = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({
      clientInformation: vi.fn().mockResolvedValue(undefined),
      saveClientInformation,
    });

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      scope: "mcp",
      forceReauthorization: true,
    });

    expect(result).toBe("REDIRECT");
    expect(registerClient).toHaveBeenCalledWith(
      "https://as.example.com",
      expect.objectContaining({ scope: "mcp" }),
    );
    expect(saveClientInformation).toHaveBeenCalledWith({
      client_id: "registered",
    });
  });

  it("uses a URL-based client id when the AS supports it", async () => {
    stubForcePath({
      authorizationServerMetadata: {
        issuer: "https://as.example.com",
        client_id_metadata_document_supported: true,
      },
    });
    isHttpsUrl.mockReturnValue(true);
    const saveClientInformation = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({
      clientInformation: vi.fn().mockResolvedValue(undefined),
      clientMetadataUrl: "https://app.example.com/client.json",
      saveClientInformation,
    });

    await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      forceReauthorization: true,
    });

    expect(registerClient).not.toHaveBeenCalled();
    expect(saveClientInformation).toHaveBeenCalledWith({
      client_id: "https://app.example.com/client.json",
    });
  });

  it("rejects a non-HTTPS clientMetadataUrl", async () => {
    stubForcePath();
    isHttpsUrl.mockReturnValue(false);
    const provider = makeProvider({
      clientInformation: vi.fn().mockResolvedValue(undefined),
      clientMetadataUrl: "http://insecure.example.com/client.json",
      saveClientInformation: vi.fn(),
    });

    await expect(
      mcpAuth(provider, {
        serverUrl: "https://mcp.example.com",
        forceReauthorization: true,
      }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
    expect(registerClient).not.toHaveBeenCalled();
  });

  it("requires saveClientInformation for dynamic registration", async () => {
    stubForcePath();
    const provider = makeProvider({
      clientInformation: vi.fn().mockResolvedValue(undefined),
      saveClientInformation: undefined,
    });

    await expect(
      mcpAuth(provider, {
        serverUrl: "https://mcp.example.com",
        forceReauthorization: true,
      }),
    ).rejects.toThrow(
      "OAuth client information must be saveable for dynamic registration",
    );
    expect(registerClient).not.toHaveBeenCalled();
  });

  it("requires a redirectUrl for the authorization_code flow", async () => {
    stubForcePath();
    const provider = makeProvider({ redirectUrl: undefined });

    await expect(
      mcpAuth(provider, {
        serverUrl: "https://mcp.example.com",
        forceReauthorization: true,
      }),
    ).rejects.toThrow("redirectUrl is required for authorization_code flow");
    expect(startAuthorization).not.toHaveBeenCalled();
  });
});
