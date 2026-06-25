import { describe, it, expect, vi } from "vitest";
import {
  exchangeIdJag,
  redeemIdJagForAccessToken,
} from "@inspector/core/auth/ema/wire.js";
import {
  GRANT_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_ID_JAG,
  TOKEN_TYPE_ID_TOKEN,
} from "@inspector/core/auth/ema/constants.js";
import {
  EMA_MOCK_IDP_CLIENT_ID,
  EMA_MOCK_IDP_CLIENT_SECRET,
  EMA_MOCK_RESOURCE_CLIENT_ID,
  EMA_MOCK_RESOURCE_CLIENT_SECRET,
  minimalOAuthAsMetadata,
} from "../../../integration/mcp/ema-mock-servers.js";

const IDP_ISSUER = "https://mock-idp.test";
const AS_ISSUER = "https://mock-as.test";
const ID_TOKEN = "header.idpayload.sig";
const ID_JAG = "mock-id-jag-token";
const ACCESS_TOKEN = "mock-resource-access-token";

function idpMetadata() {
  return minimalOAuthAsMetadata(IDP_ISSUER);
}

function asMetadata() {
  return {
    ...minimalOAuthAsMetadata(AS_ISSUER),
    jwks_uri: `${AS_ISSUER}/jwks`,
  };
}

describe("ema wire", () => {
  describe("exchangeIdJag", () => {
    it("posts RFC 8693 token exchange and returns ID-JAG", async () => {
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/.well-known/oauth-authorization-server")) {
            return new Response(JSON.stringify(idpMetadata()));
          }
          if (url === `${IDP_ISSUER}/token`) {
            const body = new URLSearchParams(init?.body as string);
            expect(body.get("grant_type")).toBe(GRANT_TYPE_TOKEN_EXCHANGE);
            expect(body.get("subject_token")).toBe(ID_TOKEN);
            expect(body.get("subject_token_type")).toBe(TOKEN_TYPE_ID_TOKEN);
            expect(body.get("requested_token_type")).toBe(TOKEN_TYPE_ID_JAG);
            expect(body.get("audience")).toBe(AS_ISSUER);
            expect(body.get("client_id")).toBe(EMA_MOCK_IDP_CLIENT_ID);
            expect(body.get("client_secret")).toBe(EMA_MOCK_IDP_CLIENT_SECRET);
            return new Response(
              JSON.stringify({
                access_token: ID_JAG,
                issued_token_type: TOKEN_TYPE_ID_JAG,
              }),
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      );

      const idJag = await exchangeIdJag({
        idp: {
          issuer: IDP_ISSUER,
          clientId: EMA_MOCK_IDP_CLIENT_ID,
          clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
        },
        idToken: ID_TOKEN,
        audience: AS_ISSUER,
        fetchFn,
      });

      expect(idJag).toBe(ID_JAG);
    });

    it("throws when IdP token exchange fails", async () => {
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-authorization-server")) {
          return new Response(JSON.stringify(idpMetadata()));
        }
        if (url === `${IDP_ISSUER}/token`) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          fetchFn,
        }),
      ).rejects.toThrow(/EMA leg 2/);
    });
  });

  describe("redeemIdJagForAccessToken", () => {
    it("posts JWT bearer grant and returns OAuth tokens", async () => {
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/.well-known/oauth-authorization-server")) {
            return new Response(JSON.stringify(asMetadata()));
          }
          if (url === `${AS_ISSUER}/token`) {
            const body = new URLSearchParams(init?.body as string);
            expect(body.get("grant_type")).toBe(GRANT_TYPE_JWT_BEARER);
            expect(body.get("assertion")).toBe(ID_JAG);
            expect(body.get("client_id")).toBe(EMA_MOCK_RESOURCE_CLIENT_ID);
            expect(body.get("client_secret")).toBe(
              EMA_MOCK_RESOURCE_CLIENT_SECRET,
            );
            return new Response(
              JSON.stringify({
                access_token: ACCESS_TOKEN,
                token_type: "Bearer",
                expires_in: 3600,
              }),
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      );

      const tokens = await redeemIdJagForAccessToken({
        resourceAsUrl: new URL(AS_ISSUER),
        idJag: ID_JAG,
        resourceClientId: EMA_MOCK_RESOURCE_CLIENT_ID,
        resourceClientSecret: EMA_MOCK_RESOURCE_CLIENT_SECRET,
        scope: "mcp",
        fetchFn,
      });

      expect(tokens.access_token).toBe(ACCESS_TOKEN);
      expect(tokens.token_type).toBe("Bearer");
    });
  });
});
