import { describe, it, expect, vi } from "vitest";
import {
  buildOAuthConnectionState,
  hasPersistedOAuthServerState,
  isAccessTokenProvablyUnexpired,
  isAccessTokenUsable,
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
    registrationKind: Awaited<
      ReturnType<OAuthStorage["getClientRegistrationKind"]>
    >;
    scope: string | undefined;
    serverMetadata: Awaited<ReturnType<OAuthStorage["getServerMetadata"]>>;
    idpSession: Awaited<ReturnType<OAuthStorage["getIdpSession"]>>;
    idpMetadata: Awaited<ReturnType<OAuthStorage["getServerMetadata"]>>;
  }> = {},
): OAuthStorage {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getTokens: vi.fn().mockResolvedValue(overrides.tokens),
    getClientInformation: vi.fn(async (_url, isPreregistered) =>
      isPreregistered ? overrides.preregistered : overrides.dynamic,
    ),
    getScope: vi.fn().mockResolvedValue(overrides.scope),
    getServerMetadata: vi.fn(async (url: string) => {
      if (url.startsWith("ema-idp:")) {
        return overrides.idpMetadata ?? null;
      }
      return overrides.serverMetadata ?? null;
    }),
    getIdpSession: vi.fn().mockResolvedValue(overrides.idpSession),
    getClientRegistrationKind: vi
      .fn()
      .mockResolvedValue(overrides.registrationKind),
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
    takeRevocationSnapshot: vi.fn().mockResolvedValue({ byIssuer: {} }),
    getCodeVerifier: vi.fn(),
    getDiscoveryState: vi.fn().mockResolvedValue(undefined),
    saveDiscoveryState: vi.fn(),
    clearDiscoveryState: vi.fn(),
  };
}

describe("isServerOAuthConfigured", () => {
  it("returns true when enterpriseManaged is set", () => {
    expect(isServerOAuthConfigured({ enterpriseManaged: true })).toBe(true);
  });

  it("returns false when all oauth fields are empty", () => {
    expect(isServerOAuthConfigured({})).toBe(false);
  });

  it("returns true when clientMetadataUrl is set", () => {
    expect(
      isServerOAuthConfigured({
        clientMetadataUrl: "https://example.com/oauth/client.json",
      }),
    ).toBe(true);
  });
});

describe("protocolFromOAuthConfig", () => {
  it("maps enterpriseManaged to ema", () => {
    expect(protocolFromOAuthConfig({ enterpriseManaged: true })).toBe("ema");
  });
});

describe("hasPersistedOAuthServerState", () => {
  it("returns true when dynamic client information is stored", async () => {
    const storage = createStorage({
      dynamic: { client_id: "https://example.com/cimd.json" },
    });
    await expect(
      hasPersistedOAuthServerState(storage, SERVER_URL),
    ).resolves.toBe(true);
  });

  it("returns false when storage is empty", async () => {
    const storage = createStorage();
    await expect(
      hasPersistedOAuthServerState(storage, SERVER_URL),
    ).resolves.toBe(false);
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
      registrationKind: "static",
      clientId: "cfg-client",
      hasClientSecret: false,
    });
    expect(state.grantedScope).toBe("mcp");
    expect(state.authorizationServerMetadata?.authorization_endpoint).toBe(
      "https://auth.example.com/authorize",
    );
  });

  it("returns dcr registration kind for dynamic client slot", async () => {
    const storage = createStorage({
      dynamic: { client_id: "dcr-uuid" },
      registrationKind: "dcr",
    });
    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      storage,
    });
    expect(state.client).toEqual({
      registrationKind: "dcr",
      clientId: "dcr-uuid",
      hasClientSecret: false,
    });
  });

  it("returns cimd registration kind for dynamic client slot", async () => {
    const storage = createStorage({
      dynamic: { client_id: "https://example.com/cimd.json" },
      registrationKind: "cimd",
    });
    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      storage,
    });
    expect(state.client).toEqual({
      registrationKind: "cimd",
      clientId: "https://example.com/cimd.json",
      hasClientSecret: false,
    });
  });

  it("prefers static registration when preregistered and dynamic slots coexist", async () => {
    const storage = createStorage({
      preregistered: { client_id: "static-id" },
      dynamic: { client_id: "https://example.com/cimd.json" },
      registrationKind: "cimd",
    });
    const state = await buildOAuthConnectionState({
      serverUrl: SERVER_URL,
      protocol: "standard",
      storage,
    });
    expect(state.client?.registrationKind).toBe("static");
    expect(state.client?.clientId).toBe("static-id");
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

/** Minimal unsigned JWT carrying only `exp` (epoch seconds). */
function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("isAccessTokenProvablyUnexpired", () => {
  it("is true for a JWT whose exp is in the future", () => {
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: jwtWithExp(nowSec() + 3600),
        token_type: "Bearer",
      }),
    ).toBe(true);
  });

  it("is false for a JWT whose exp has passed", () => {
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: jwtWithExp(nowSec() - 60),
        token_type: "Bearer",
      }),
    ).toBe(false);
  });

  it("is false inside the 60s expiry skew window", () => {
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: jwtWithExp(nowSec() + 30),
        token_type: "Bearer",
      }),
    ).toBe(false);
  });

  it("is false for an opaque token, where isAccessTokenUsable is true", () => {
    // The #2051 regression: no local expiry evidence must not read as "valid".
    const tokens = { access_token: "opaque-tok", token_type: "Bearer" };
    expect(isAccessTokenProvablyUnexpired(tokens)).toBe(false);
    expect(isAccessTokenUsable(tokens)).toBe(true);
  });

  it("is false for a JWT carrying no exp claim", () => {
    const payload = btoa(JSON.stringify({ sub: "user" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: `header.${payload}.sig`,
        token_type: "Bearer",
      }),
    ).toBe(false);
  });

  it("is false for a two-segment token whose payload decodes to an exp", () => {
    // jwtExpiresAtMs only requires two dot-separated segments, so a structured
    // opaque token carrying a decodable `{"exp":...}` would otherwise read as
    // proof of validity. isJwtFormat is what rejects it.
    const payload = btoa(JSON.stringify({ exp: nowSec() + 3600 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: `opaque.${payload}`,
        token_type: "Bearer",
      }),
    ).toBe(false);
  });

  it("is false for a four-segment token carrying a decodable exp", () => {
    const payload = btoa(JSON.stringify({ exp: nowSec() + 3600 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: `header.${payload}.sig.extra`,
        token_type: "Bearer",
      }),
    ).toBe(false);
  });

  it("is false when there is no access token", () => {
    expect(isAccessTokenProvablyUnexpired(undefined)).toBe(false);
    expect(
      isAccessTokenProvablyUnexpired({
        access_token: "",
        token_type: "Bearer",
      }),
    ).toBe(false);
  });
});
