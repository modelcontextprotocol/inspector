import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  mintEmaResourceTokens,
  trySilentEmaAuth,
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
  idpSessions: Record<string, { idToken?: string }> = {},
  savedTokens: Record<string, unknown> = {},
): OAuthStorage {
  return {
    getIdpSession: vi.fn(async (issuer: string) => idpSessions[issuer]),
    saveIdpSession: vi.fn(async (issuer: string, updates) => {
      idpSessions[issuer] = { ...idpSessions[issuer], ...updates };
    }),
    clearIdpSession: vi.fn(),
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
  const idpSessions: Record<string, { idToken?: string }> = {};

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

    const ok = await trySilentEmaAuth({
      ...baseConfig(storage),
      fetchFn: mockEmaFetch(idToken),
    });

    expect(ok).toBe(true);
    expect(storage.saveTokens).toHaveBeenCalledWith(
      SERVER_URL,
      expect.objectContaining({ access_token: "resource-access-token" }),
      { enterpriseManaged: true },
    );
  });

  it("trySilentEmaAuth returns false when IdP session is absent", async () => {
    expect(await trySilentEmaAuth(baseConfig(storage))).toBe(false);
  });
});
