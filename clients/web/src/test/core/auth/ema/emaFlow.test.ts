import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  mintEmaResourceTokens,
  trySilentEmaAuth,
  startEmaIdpAuthorization,
  completeEmaIdpAuthorizationAndMint,
  refreshEmaResourceTokens,
  type EmaFlowConfig,
} from "@inspector/core/auth/ema/emaFlow.js";
import type { EmaResourceContext } from "@inspector/core/auth/ema/resourceContext.js";
import {
  GRANT_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_ID_JAG,
} from "@inspector/core/auth/ema/constants.js";
import {
  EMA_MOCK_IDP_CLIENT_ID,
  EMA_MOCK_IDP_CLIENT_SECRET,
  EMA_MOCK_RESOURCE_CLIENT_ID,
  EMA_MOCK_RESOURCE_CLIENT_SECRET,
  minimalOAuthAsMetadata,
} from "../../../integration/mcp/ema-mock-servers.js";

const IDP_ISSUER = "https://idp.ema.test";
const AS_ISSUER = "https://as.ema.test";
const MCP_RESOURCE = "http://127.0.0.1:9999/";
const SERVER_URL = "http://127.0.0.1:9999/mcp";

function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

function createMemoryStorage(
  idpSessions: Record<string, { idToken?: string; refreshToken?: string }> = {},
  savedTokens: Record<string, unknown> = {},
): OAuthStorage {
  const metadataByKey: Record<string, unknown> = {};
  const clientInfoByKey: Record<string, unknown> = {};
  const codeVerifierByKey: Record<string, string> = {};
  return {
    load: vi.fn().mockResolvedValue(undefined),
    getIdpSession: vi.fn(async (issuer: string) => idpSessions[issuer]),
    saveIdpSession: vi.fn(async (issuer: string, updates) => {
      idpSessions[issuer] = { ...idpSessions[issuer], ...updates };
    }),
    clearIdpSession: vi.fn(),
    getServerMetadata: vi.fn((key: string) => metadataByKey[key]),
    saveServerMetadata: vi.fn((key: string, metadata: unknown) => {
      metadataByKey[key] = metadata;
    }),
    getClientInformation: vi.fn((key: string) => clientInfoByKey[key]),
    savePreregisteredClientInformation: vi.fn((key: string, info: unknown) => {
      clientInfoByKey[key] = info;
    }),
    getCodeVerifier: vi.fn((key: string) => codeVerifierByKey[key]),
    saveCodeVerifier: vi.fn((key: string, verifier: string) => {
      codeVerifierByKey[key] = verifier;
    }),
    clearCodeVerifier: vi.fn((key: string) => {
      delete codeVerifierByKey[key];
    }),
    getTokens: vi.fn(async (url: string) => savedTokens[url] as never),
    saveTokens: vi.fn(async (url: string, tokens) => {
      savedTokens[url] = tokens;
    }),
    clear: vi.fn(),
    clearEnterpriseManagedResourceServers: vi.fn(),
  } as unknown as OAuthStorage;
}

function baseConfig(storage: OAuthStorage): EmaFlowConfig {
  return {
    serverUrl: SERVER_URL,
    idp: {
      issuer: IDP_ISSUER,
      clientId: EMA_MOCK_IDP_CLIENT_ID,
      clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
    },
    resourceClientId: EMA_MOCK_RESOURCE_CLIENT_ID,
    resourceClientSecret: EMA_MOCK_RESOURCE_CLIENT_SECRET,
    scope: "mcp",
    redirectUrl: "http://127.0.0.1:3000/oauth/callback",
    storage,
  };
}

function resourceContext(): EmaResourceContext {
  return {
    resourceMetadata: {
      resource: MCP_RESOURCE,
      authorization_servers: [AS_ISSUER],
      scopes_supported: ["mcp"],
    },
    resourceAsUrl: new URL(AS_ISSUER),
    resourceUrl: new URL(MCP_RESOURCE),
    scope: "mcp",
  };
}

function mockEmaFetch(idToken: string) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/.well-known/oauth-protected-resource")) {
      return new Response(
        JSON.stringify({
          resource: MCP_RESOURCE,
          authorization_servers: [AS_ISSUER],
          scopes_supported: ["mcp"],
        }),
      );
    }
    if (
      url.includes("/.well-known/oauth-authorization-server") &&
      url.startsWith(IDP_ISSUER)
    ) {
      return new Response(JSON.stringify(minimalOAuthAsMetadata(IDP_ISSUER)));
    }
    if (url === `${IDP_ISSUER}/token`) {
      const body = new URLSearchParams(init?.body as string);
      if (body.get("grant_type") === "refresh_token") {
        const refreshed = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
        return new Response(
          JSON.stringify({ id_token: refreshed, token_type: "Bearer" }),
        );
      }
      if (body.get("grant_type") === "authorization_code") {
        return new Response(
          JSON.stringify({
            access_token: "idp-access",
            id_token: idToken,
            refresh_token: "idp-refresh",
            token_type: "Bearer",
          }),
        );
      }
      expect(body.get("grant_type")).toBe(GRANT_TYPE_TOKEN_EXCHANGE);
      expect(body.get("subject_token")).toBe(idToken);
      return new Response(
        JSON.stringify({
          access_token: "id-jag-from-mock",
          issued_token_type: TOKEN_TYPE_ID_JAG,
        }),
      );
    }
    if (
      url.includes("/.well-known/oauth-authorization-server") &&
      url.startsWith(AS_ISSUER)
    ) {
      return new Response(JSON.stringify(minimalOAuthAsMetadata(AS_ISSUER)));
    }
    if (url === `${AS_ISSUER}/token`) {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe(GRANT_TYPE_JWT_BEARER);
      return new Response(
        JSON.stringify({
          access_token: "resource-access-token",
          token_type: "Bearer",
        }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("emaFlow", () => {
  let storage: OAuthStorage;
  const idpSessions: Record<
    string,
    { idToken?: string; refreshToken?: string }
  > = {};

  beforeEach(() => {
    Object.keys(idpSessions).forEach((k) => delete idpSessions[k]);
    storage = createMemoryStorage(idpSessions);
  });

  it("mintEmaResourceTokens runs legs 2–3 when IdP session is valid", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    const tokens = await mintEmaResourceTokens(
      { ...baseConfig(storage), fetchFn: mockEmaFetch(idToken) },
      resourceContext(),
    );

    expect(tokens.access_token).toBe("resource-access-token");
  });

  it("mintEmaResourceTokens throws when IdP session is missing", async () => {
    await expect(
      mintEmaResourceTokens(baseConfig(storage), resourceContext()),
    ).rejects.toThrow("Valid IdP ID Token required for EMA token mint");
  });

  it("mintEmaResourceTokens throws when resource client secret is missing", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    idpSessions[IDP_ISSUER] = { idToken: jwtWithExp(exp) };

    await expect(
      mintEmaResourceTokens(
        {
          ...baseConfig(storage),
          resourceClientSecret: "",
          fetchFn: mockEmaFetch(jwtWithExp(exp)),
        },
        resourceContext(),
      ),
    ).rejects.toThrow(/resource authorization server client secret/);
  });

  it("trySilentEmaAuth saves tagged tokens when mint succeeds", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    const result = await trySilentEmaAuth({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(result).toEqual({ status: "success" });
    expect(storage.saveTokens).toHaveBeenCalledWith(
      SERVER_URL,
      expect.objectContaining({ access_token: "resource-access-token" }),
      { enterpriseManaged: true },
    );
  });

  it("trySilentEmaAuth returns no_idp_session when IdP session is absent", async () => {
    expect(await trySilentEmaAuth(baseConfig(storage))).toEqual({
      status: "no_idp_session",
    });
  });

  it("trySilentEmaAuth returns mint_failed when IdP session is valid but mint fails", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    const result = await trySilentEmaAuth({
      ...baseConfig(storage),
      resourceClientSecret: "",
      fetchFn: mockEmaFetch(idToken),
    });

    expect(result.status).toBe("mint_failed");
    if (result.status === "mint_failed") {
      expect(result.error.message).toMatch(
        /EMA legs 2–3 \(resource token mint\)/,
      );
      expect(result.error.message).toMatch(
        /resource authorization server client secret/,
      );
    }
    expect(storage.saveTokens).not.toHaveBeenCalled();
  });

  it("mintEmaResourceTokens refreshes expired ID Token via refresh_token", async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    const refreshed = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    idpSessions[IDP_ISSUER] = {
      idToken: expired,
      refreshToken: "rt-1",
    };

    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.includes("/.well-known/oauth-authorization-server") &&
          url.startsWith(IDP_ISSUER)
        ) {
          return new Response(
            JSON.stringify(minimalOAuthAsMetadata(IDP_ISSUER)),
          );
        }
        if (url === `${IDP_ISSUER}/token`) {
          const body = new URLSearchParams(init?.body as string);
          if (body.get("grant_type") === "refresh_token") {
            return new Response(
              JSON.stringify({ id_token: refreshed, token_type: "Bearer" }),
            );
          }
          expect(body.get("grant_type")).toBe(GRANT_TYPE_TOKEN_EXCHANGE);
          expect(body.get("subject_token")).toBe(refreshed);
          return new Response(
            JSON.stringify({
              access_token: "id-jag-from-mock",
              issued_token_type: TOKEN_TYPE_ID_JAG,
            }),
          );
        }
        if (
          url.includes("/.well-known/oauth-authorization-server") &&
          url.startsWith(AS_ISSUER)
        ) {
          return new Response(
            JSON.stringify(minimalOAuthAsMetadata(AS_ISSUER)),
          );
        }
        if (url === `${AS_ISSUER}/token`) {
          return new Response(
            JSON.stringify({
              access_token: "resource-access-token",
              token_type: "Bearer",
            }),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const tokens = await mintEmaResourceTokens(
      { ...baseConfig(storage), fetchFn },
      resourceContext(),
    );

    expect(tokens.access_token).toBe("resource-access-token");
    expect(idpSessions[IDP_ISSUER]?.idToken).toBe(refreshed);
  });

  it("mintEmaResourceTokens throws when resourceClientId is missing", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    await expect(
      mintEmaResourceTokens(
        {
          ...baseConfig(storage),
          resourceClientId: undefined,
          fetchFn: mockEmaFetch(idToken),
        },
        resourceContext(),
      ),
    ).rejects.toThrow(/resource authorization server clientId/);
  });

  it("mintEmaResourceTokens discovers resource context when none is passed", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    const tokens = await mintEmaResourceTokens({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(tokens.access_token).toBe("resource-access-token");
  });

  it("startEmaIdpAuthorization returns the IdP authorization URL", async () => {
    const idToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const url = await startEmaIdpAuthorization({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(url).toBeInstanceOf(URL);
    expect(url.href).toContain(`${IDP_ISSUER}/authorize`);
    expect(storage.saveCodeVerifier).toHaveBeenCalled();
  });

  it("completeEmaIdpAuthorizationAndMint exchanges code, mints, and saves tokens", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    const fetchFn = mockEmaFetch(idToken);
    const config = { ...baseConfig(storage), fetchFn };

    // Seed code verifier / client info / metadata for the callback exchange.
    await startEmaIdpAuthorization(config);

    const tokens = await completeEmaIdpAuthorizationAndMint(
      config,
      "auth-code",
    );

    expect(tokens.access_token).toBe("resource-access-token");
    expect(storage.saveTokens).toHaveBeenCalledWith(
      SERVER_URL,
      expect.objectContaining({ access_token: "resource-access-token" }),
      { enterpriseManaged: true },
    );
  });

  it("completeEmaIdpAuthorizationAndMint wraps leg 1 errors", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // No startEmaIdpAuthorization → no metadata seeded → leg 1 fails.
    await expect(
      completeEmaIdpAuthorizationAndMint(baseConfig(storage), "auth-code"),
    ).rejects.toThrow(/EMA leg 1 \(IdP authorization code exchange\)/);
    errorSpy.mockRestore();
  });

  it("completeEmaIdpAuthorizationAndMint wraps mint failures from legs 2–3", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    const fetchFn = mockEmaFetch(idToken);
    const config = {
      ...baseConfig(storage),
      resourceClientSecret: "",
      fetchFn,
    };

    await startEmaIdpAuthorization(config);

    await expect(
      completeEmaIdpAuthorizationAndMint(config, "auth-code"),
    ).rejects.toThrow(/EMA legs 2–3 \(resource token mint\)/);
  });

  it("refreshEmaResourceTokens re-runs legs 2–3 and saves tagged tokens", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    const tokens = await refreshEmaResourceTokens({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(tokens?.access_token).toBe("resource-access-token");
    expect(storage.saveTokens).toHaveBeenCalledWith(
      SERVER_URL,
      expect.objectContaining({ access_token: "resource-access-token" }),
      { enterpriseManaged: true },
    );
  });

  it("refreshEmaResourceTokens returns undefined without an IdP session", async () => {
    expect(await refreshEmaResourceTokens(baseConfig(storage))).toBeUndefined();
  });

  it("trySilentEmaAuth wraps non-Error mint failures (String(err) branch)", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    idpSessions[IDP_ISSUER] = { idToken };

    // Mint itself succeeds; saveTokens throws a non-Error string so the
    // try/catch wraps it via wrapEmaMintError's String(err) branch.
    vi.mocked(storage.saveTokens).mockImplementation(() => {
      throw "boom-non-error";
    });

    const result = await trySilentEmaAuth({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(result.status).toBe("mint_failed");
    if (result.status === "mint_failed") {
      expect(result.error.message).toBe(
        "EMA legs 2–3 (resource token mint): boom-non-error",
      );
    }
  });

  it("completeEmaIdpAuthorizationAndMint wraps non-Error leg-1 failures (String(err) branch)", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = jwtWithExp(exp);
    const fetchFn = mockEmaFetch(idToken);
    const config = { ...baseConfig(storage), fetchFn };

    // Seed metadata/verifier so leg 1 would otherwise succeed, then make
    // saveIdpSession (called at the end of leg 1) throw a non-Error so the
    // leg-1 catch takes its String(err) branch.
    await startEmaIdpAuthorization(config);
    vi.mocked(storage.saveIdpSession).mockImplementation(() => {
      throw "leg1-non-error";
    });

    await expect(
      completeEmaIdpAuthorizationAndMint(config, "auth-code"),
    ).rejects.toThrow(
      "EMA leg 1 (IdP authorization code exchange): leg1-non-error",
    );
  });
});
