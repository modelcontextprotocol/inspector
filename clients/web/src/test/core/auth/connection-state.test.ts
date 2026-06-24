import { describe, it, expect, vi } from "vitest";
import {
  buildOAuthConnectionState,
  isServerOAuthConfigured,
  protocolFromOAuthConfig,
} from "@inspector/core/auth/connection-state.js";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";

const SERVER_URL = "https://mcp.example.com/mcp";

function createStorage(
  overrides: Partial<{
    tokens: Awaited<ReturnType<OAuthStorage["getTokens"]>>;
    preregistered: Awaited<ReturnType<OAuthStorage["getClientInformation"]>>;
    dynamic: Awaited<ReturnType<OAuthStorage["getClientInformation"]>>;
    scope: string | undefined;
    serverMetadata: ReturnType<OAuthStorage["getServerMetadata"]>;
    idpSession: Awaited<ReturnType<OAuthStorage["getIdpSession"]>>;
    idpMetadata: ReturnType<OAuthStorage["getServerMetadata"]>;
  }> = {},
): OAuthStorage {
  return {
    getTokens: vi.fn().mockResolvedValue(overrides.tokens),
    getClientInformation: vi.fn(async (_url, isPreregistered) =>
      isPreregistered ? overrides.preregistered : overrides.dynamic,
    ),
    getScope: vi.fn().mockReturnValue(overrides.scope),
    getServerMetadata: vi.fn((url: string) => {
      if (url.startsWith("ema-idp:")) {
        return overrides.idpMetadata ?? null;
      }
      return overrides.serverMetadata ?? null;
    }),
    getIdpSession: vi.fn().mockResolvedValue(overrides.idpSession),
    saveClientInformation: vi.fn(),
    savePreregisteredClientInformation: vi.fn(),
    saveTokens: vi.fn(),
    saveScope: vi.fn(),
    saveCodeVerifier: vi.fn(),
    saveServerMetadata: vi.fn(),
    saveIdpSession: vi.fn(),
    clear: vi.fn(),
    clearClientInformation: vi.fn(),
    clearTokens: vi.fn(),
    clearCodeVerifier: vi.fn(),
    clearScope: vi.fn(),
    clearServerMetadata: vi.fn(),
    clearIdpSession: vi.fn(),
    clearEnterpriseManagedResourceServers: vi.fn(),
    getCodeVerifier: vi.fn(),
  };
}

describe("isServerOAuthConfigured", () => {
  it("returns true when enterpriseManaged is set", () => {
    expect(isServerOAuthConfigured({ enterpriseManaged: true })).toBe(true);
  });

  it("returns false when all oauth fields are empty", () => {
    expect(isServerOAuthConfigured({})).toBe(false);
  });
});

describe("protocolFromOAuthConfig", () => {
  it("maps enterpriseManaged to ema", () => {
    expect(protocolFromOAuthConfig({ enterpriseManaged: true })).toBe("ema");
  });
});

describe("buildOAuthConnectionState", () => {
  it("returns authorized standard state from storage tokens", async () => {
    const storage = createStorage({
      tokens: { access_token: "opaque-token", token_type: "Bearer" },
      preregistered: { client_id: "cfg-client" },
      scope: "mcp",
      serverMetadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        response_types_supported: ["code"],
      },
    });

    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      configuredScope: "mcp",
      storage,
    });

    expect(state.authorized).toBe(true);
    expect(state.protocol).toBe("standard");
    expect(state.client).toEqual({
      source: "preregistered",
      clientId: "cfg-client",
      hasClientSecret: false,
    });
    expect(state.grantedScope).toBe("mcp");
    expect(state.authorizationServerMetadata?.authorization_endpoint).toBe(
      "https://auth.example.com/authorize",
    );
  });

  it("returns unauthorized when tokens are missing", async () => {
    const storage = createStorage();
    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      configuredScope: "mcp",
      storage,
    });
    expect(state.authorized).toBe(false);
    expect(state.tokens).toBeUndefined();
    expect(state.configuredScope).toBe("mcp");
  });

  it("prefers usable in-memory flow tokens over storage", async () => {
    const storage = createStorage({
      tokens: { access_token: "stored", token_type: "Bearer" },
    });
    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      storage,
      flowState: {
        oauthTokens: { access_token: "flow", token_type: "Bearer" },
      } as never,
    });
    expect(state.tokens?.access_token).toBe("flow");
    expect(state.authorized).toBe(true);
  });

  it("includes EMA idp session summary without raw id token", async () => {
    const storage = createStorage({
      tokens: { access_token: "resource-token", token_type: "Bearer" },
      idpSession: {
        idToken: "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.",
        refreshToken: "rt",
      },
      idpMetadata: {
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        response_types_supported: ["code"],
      },
    });

    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "ema",
      storage,
      enterpriseManagedAuth: {
        idp: {
          issuer: "https://idp.example.com",
          clientId: "idp-client",
          clientSecret: "secret",
        },
      },
    });

    expect(state.protocol).toBe("ema");
    expect(state.enterpriseManaged).toBe(true);
    expect(state.ema).toEqual({
      idpIssuer: "https://idp.example.com",
      idpClientId: "idp-client",
      idpSession: "logged_in",
      idpMetadata: expect.objectContaining({
        issuer: "https://idp.example.com",
      }),
    });
    expect(state.ema).not.toHaveProperty("idToken");
  });
});
