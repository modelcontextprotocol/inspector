import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  completeIdpOidcAuthorization,
  discoverIdpMetadata,
  getValidIdToken,
  refreshIdpOidcSession,
  startIdpOidcAuthorization,
} from "@inspector/core/auth/ema/idpOidc.js";
import { minimalOAuthAsMetadata } from "../../../integration/mcp/ema-mock-servers.js";

const IDP_ISSUER = "https://idp.refresh.test";

function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

describe("idpOidc refresh", () => {
  const idpSessions: Record<
    string,
    { idToken?: string; refreshToken?: string; idTokenExpiresAt?: number }
  > = {};
  let storage: OAuthStorage;

  beforeEach(() => {
    Object.keys(idpSessions).forEach((k) => delete idpSessions[k]);
    storage = {
      getIdpSession: vi.fn(async (issuer: string) => idpSessions[issuer]),
      saveIdpSession: vi.fn(async (issuer: string, updates) => {
        idpSessions[issuer] = { ...idpSessions[issuer], ...updates };
      }),
      getServerMetadata: vi.fn(() => minimalOAuthAsMetadata(IDP_ISSUER)),
      clearIdpSession: vi.fn(),
    } as unknown as OAuthStorage;
  });

  const idp = {
    issuer: IDP_ISSUER,
    clientId: "idp-client",
    clientSecret: "idp-secret",
  };

  it("refreshIdpOidcSession redeems refresh_token and updates IdP session", async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    const refreshed = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    idpSessions[IDP_ISSUER] = {
      idToken: expired,
      refreshToken: "rt-abc",
    };

    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${IDP_ISSUER}/token`) {
          const body = new URLSearchParams(init?.body as string);
          expect(body.get("grant_type")).toBe("refresh_token");
          expect(body.get("refresh_token")).toBe("rt-abc");
          return new Response(
            JSON.stringify({
              id_token: refreshed,
              refresh_token: "rt-rotated",
              token_type: "Bearer",
            }),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const idToken = await refreshIdpOidcSession({
      idp,
      storage,
      fetchFn,
    });

    expect(idToken).toBe(refreshed);
    expect(idpSessions[IDP_ISSUER]?.idToken).toBe(refreshed);
    expect(idpSessions[IDP_ISSUER]?.refreshToken).toBe("rt-rotated");
  });

  it("getValidIdToken refreshes when ID Token is expired but refresh_token remains", async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    const refreshed = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    idpSessions[IDP_ISSUER] = {
      idToken: expired,
      refreshToken: "rt-abc",
    };

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${IDP_ISSUER}/token`) {
        return new Response(
          JSON.stringify({ id_token: refreshed, token_type: "Bearer" }),
        );
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });

    const idToken = await getValidIdToken({ idp, storage, fetchFn });
    expect(idToken).toBe(refreshed);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("getValidIdToken returns undefined when refresh fails", async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    idpSessions[IDP_ISSUER] = {
      idToken: expired,
      refreshToken: "rt-bad",
    };

    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
    );

    expect(await getValidIdToken({ idp, storage, fetchFn })).toBeUndefined();
  });

  it("getValidIdToken returns undefined when no session exists", async () => {
    expect(
      await getValidIdToken({ idp, storage, fetchFn: vi.fn() }),
    ).toBeUndefined();
  });

  it("getValidIdToken returns a still-valid ID Token without fetching", async () => {
    const valid = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    idpSessions[IDP_ISSUER] = { idToken: valid, refreshToken: "rt-abc" };
    const fetchFn = vi.fn();
    expect(await getValidIdToken({ idp, storage, fetchFn })).toBe(valid);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("getValidIdToken returns undefined when expired and no refresh token", async () => {
    const expired = jwtWithExp(Math.floor(Date.now() / 1000) - 60);
    idpSessions[IDP_ISSUER] = { idToken: expired };
    const fetchFn = vi.fn();
    expect(await getValidIdToken({ idp, storage, fetchFn })).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refreshIdpOidcSession throws when refresh token is absent", async () => {
    idpSessions[IDP_ISSUER] = {
      idToken: jwtWithExp(Math.floor(Date.now() / 1000) - 60),
    };
    await expect(
      refreshIdpOidcSession({ idp, storage, fetchFn: vi.fn() }),
    ).rejects.toThrow("IdP refresh token not available");
  });

  it("refreshIdpOidcSession surfaces token-endpoint error responses", async () => {
    idpSessions[IDP_ISSUER] = {
      idToken: jwtWithExp(Math.floor(Date.now() / 1000) - 60),
      refreshToken: "rt-bad",
    };
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "expired",
          }),
          { status: 400 },
        ),
    );
    await expect(
      refreshIdpOidcSession({ idp, storage, fetchFn }),
    ).rejects.toThrow(/EMA IdP refresh.*invalid_grant/);
  });

  it("refreshIdpOidcSession throws when refresh response omits an ID Token", async () => {
    idpSessions[IDP_ISSUER] = {
      idToken: jwtWithExp(Math.floor(Date.now() / 1000) - 60),
      refreshToken: "rt-abc",
    };
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ token_type: "Bearer" })),
    );
    await expect(
      refreshIdpOidcSession({ idp, storage, fetchFn }),
    ).rejects.toThrow("IdP refresh did not return an ID Token");
  });

  it("refreshIdpOidcSession discovers metadata when none is cached, and retains the old refresh_token", async () => {
    idpSessions[IDP_ISSUER] = {
      idToken: jwtWithExp(Math.floor(Date.now() / 1000) - 60),
      refreshToken: "rt-keep",
    };
    storage.getServerMetadata =
      vi.fn() as unknown as OAuthStorage["getServerMetadata"];
    const refreshed = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(JSON.stringify(minimalOAuthAsMetadata(IDP_ISSUER)));
      }
      if (url === `${IDP_ISSUER}/token`) {
        return new Response(
          JSON.stringify({ id_token: refreshed, token_type: "Bearer" }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const idToken = await refreshIdpOidcSession({ idp, storage, fetchFn });
    expect(idToken).toBe(refreshed);
    // No rotated refresh_token in the response -> the existing one is retained.
    expect(idpSessions[IDP_ISSUER]?.refreshToken).toBe("rt-keep");
  });

  // NOTE: idpOidc.ts:166-168 (`if (!metadata.token_endpoint) throw "IdP
  // metadata missing token_endpoint"`) is unreachable defensive code. The only
  // two metadata sources both guarantee token_endpoint: a cached entry is only
  // returned by resolveIdpMetadata when `cached?.token_endpoint` is truthy,
  // and discoverIdpMetadata runs the result through OAuthMetadataSchema.parse,
  // which requires token_endpoint (throwing a ZodError otherwise). So no input
  // reaches that guard with a missing token_endpoint — it is left uncovered.
});

describe("discoverIdpMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed OAuth metadata from OIDC discovery", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(JSON.stringify(minimalOAuthAsMetadata(IDP_ISSUER)));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const metadata = await discoverIdpMetadata(IDP_ISSUER, fetchFn);
    expect(metadata.token_endpoint).toBe(`${IDP_ISSUER}/token`);
    expect(metadata.issuer).toBe(IDP_ISSUER);
  });

  it("throws when discovery yields no metadata (all probes 404)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );
    await expect(discoverIdpMetadata(IDP_ISSUER, fetchFn)).rejects.toThrow(
      /Failed to discover OIDC metadata/,
    );
    errorSpy.mockRestore();
  });

  it("rejects non-http(s) issuer URLs", async () => {
    await expect(
      discoverIdpMetadata("ftp://idp.test", vi.fn()),
    ).rejects.toThrow();
  });
});

describe("startIdpOidcAuthorization", () => {
  let storage: OAuthStorage;
  const saved: Record<string, unknown> = {};

  beforeEach(() => {
    Object.keys(saved).forEach((k) => delete saved[k]);
    storage = {
      saveCodeVerifier: vi.fn(async (key: string, value: string) => {
        saved[`cv:${key}`] = value;
      }),
      savePreregisteredClientInformation: vi.fn(
        async (key: string, info: unknown) => {
          saved[`client:${key}`] = info;
        },
      ),
      saveServerMetadata: vi.fn(async (key: string, meta: unknown) => {
        saved[`meta:${key}`] = meta;
      }),
    } as unknown as OAuthStorage;
  });

  const idp = {
    issuer: `${IDP_ISSUER}/`,
    clientId: "idp-client",
    clientSecret: "idp-secret",
  };

  it("discovers metadata, builds an authorization URL, and persists PKCE state", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(JSON.stringify(minimalOAuthAsMetadata(IDP_ISSUER)));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { authorizationUrl } = await startIdpOidcAuthorization({
      idp,
      redirectUrl: "http://127.0.0.1:3000/oauth/callback",
      storage,
      fetchFn,
    });

    expect(authorizationUrl).toBeInstanceOf(URL);
    expect(authorizationUrl.searchParams.get("client_id")).toBe("idp-client");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "openid offline_access",
    );
    expect(authorizationUrl.searchParams.get("state")).toBeTruthy();

    // Issuer was normalized (trailing slash dropped) for the storage key.
    const key = `ema-idp:${IDP_ISSUER}`;
    expect(storage.saveCodeVerifier).toHaveBeenCalledWith(
      key,
      expect.any(String),
    );
    expect(storage.savePreregisteredClientInformation).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ client_id: "idp-client" }),
    );
    expect(storage.saveServerMetadata).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ token_endpoint: `${IDP_ISSUER}/token` }),
    );
  });
});

describe("completeIdpOidcAuthorization", () => {
  let storage: OAuthStorage;
  const idpSessions: Record<string, unknown> = {};
  const clearedVerifiers: string[] = [];

  function buildStorage(overrides: Partial<OAuthStorage> = {}): OAuthStorage {
    return {
      getServerMetadata: vi.fn(() => minimalOAuthAsMetadata(IDP_ISSUER)),
      getClientInformation: vi.fn(async () => ({
        client_id: "idp-client",
        client_secret: "idp-secret",
        token_endpoint_auth_method: "client_secret_post",
      })),
      getCodeVerifier: vi.fn(() => "verifier-123"),
      clearCodeVerifier: vi.fn((key: string) => {
        clearedVerifiers.push(key);
      }),
      saveIdpSession: vi.fn(async (issuer: string, updates: unknown) => {
        idpSessions[issuer] = updates;
      }),
      ...overrides,
    } as unknown as OAuthStorage;
  }

  const idp = {
    issuer: IDP_ISSUER,
    clientId: "idp-client",
    clientSecret: "idp-secret",
  };

  beforeEach(() => {
    Object.keys(idpSessions).forEach((k) => delete idpSessions[k]);
    clearedVerifiers.length = 0;
  });

  it("exchanges the authorization code and stores the IdP session", async () => {
    storage = buildStorage();
    const idToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${IDP_ISSUER}/token`) {
          const body = new URLSearchParams(init?.body as string);
          expect(body.get("grant_type")).toBe("authorization_code");
          expect(body.get("code")).toBe("auth-code-xyz");
          expect(body.get("code_verifier")).toBe("verifier-123");
          return new Response(
            JSON.stringify({
              id_token: idToken,
              refresh_token: "rt-new",
              access_token: "at-new",
              token_type: "Bearer",
            }),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const result = await completeIdpOidcAuthorization({
      idp,
      authorizationCode: "auth-code-xyz",
      redirectUrl: "http://127.0.0.1:3000/oauth/callback",
      storage,
      fetchFn,
    });

    expect(result.idToken).toBe(idToken);
    expect(result.refreshToken).toBe("rt-new");
    expect(result.idTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(clearedVerifiers).toContain(`ema-idp:${IDP_ISSUER}`);
    expect(idpSessions[IDP_ISSUER]).toMatchObject({
      idToken,
      refreshToken: "rt-new",
    });
  });

  it("throws when stored IdP metadata is missing", async () => {
    storage = buildStorage({
      getServerMetadata:
        vi.fn() as unknown as OAuthStorage["getServerMetadata"],
    });
    await expect(
      completeIdpOidcAuthorization({
        idp,
        authorizationCode: "code",
        redirectUrl: "http://127.0.0.1:3000/oauth/callback",
        storage,
        fetchFn: vi.fn(),
      }),
    ).rejects.toThrow("IdP OAuth metadata not found");
  });

  it("throws when client information is missing (both preregistered and dynamic)", async () => {
    storage = buildStorage({
      getClientInformation: vi.fn(async () => undefined),
    });
    await expect(
      completeIdpOidcAuthorization({
        idp,
        authorizationCode: "code",
        redirectUrl: "http://127.0.0.1:3000/oauth/callback",
        storage,
        fetchFn: vi.fn(),
      }),
    ).rejects.toThrow("IdP client information not found");
  });

  it("falls back to dynamic client information when preregistered is absent", async () => {
    let call = 0;
    storage = buildStorage({
      getClientInformation: vi.fn(async () => {
        call += 1;
        // First call (preregistered=true) -> undefined; second -> the client.
        return call === 1
          ? undefined
          : ({
              client_id: "idp-client",
              client_secret: "idp-secret",
              token_endpoint_auth_method: "client_secret_post",
            } as never);
      }),
    });
    const idToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id_token: idToken,
            access_token: "at-new",
            token_type: "Bearer",
          }),
        ),
    );
    const result = await completeIdpOidcAuthorization({
      idp,
      authorizationCode: "code",
      redirectUrl: "http://127.0.0.1:3000/oauth/callback",
      storage,
      fetchFn,
    });
    expect(result.idToken).toBe(idToken);
    expect(storage.getClientInformation).toHaveBeenCalledTimes(2);
  });

  it("throws when the PKCE verifier is missing", async () => {
    storage = buildStorage({ getCodeVerifier: vi.fn(() => undefined) });
    await expect(
      completeIdpOidcAuthorization({
        idp,
        authorizationCode: "code",
        redirectUrl: "http://127.0.0.1:3000/oauth/callback",
        storage,
        fetchFn: vi.fn(),
      }),
    ).rejects.toThrow("IdP PKCE verifier not found");
  });

  it("throws when the token response omits an ID Token", async () => {
    storage = buildStorage();
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "at", token_type: "Bearer" }),
        ),
    );
    await expect(
      completeIdpOidcAuthorization({
        idp,
        authorizationCode: "code",
        redirectUrl: "http://127.0.0.1:3000/oauth/callback",
        storage,
        fetchFn,
      }),
    ).rejects.toThrow("IdP token response did not include an ID Token");
  });
});
