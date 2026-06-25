import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  getValidIdToken,
  refreshIdpOidcSession,
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
});
