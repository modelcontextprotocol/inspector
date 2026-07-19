import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exchangeIdJag,
  redeemIdJagForAccessToken,
} from "@inspector/core/auth/ema/wire.js";
import { GRANT_TYPE_JWT_BEARER } from "@inspector/core/auth/ema/constants.js";
import {
  EMA_MOCK_IDP_CLIENT_ID,
  EMA_MOCK_IDP_CLIENT_SECRET,
  EMA_MOCK_RESOURCE_CLIENT_ID,
  EMA_MOCK_RESOURCE_CLIENT_SECRET,
  minimalOAuthAsMetadata,
} from "../../../integration/mcp/ema-mock-servers.js";

const { mockDiscoverAndRequestJwtAuthGrant } = vi.hoisted(() => ({
  mockDiscoverAndRequestJwtAuthGrant: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    discoverAndRequestJwtAuthGrant: (
      ...args: Parameters<typeof actual.discoverAndRequestJwtAuthGrant>
    ) => mockDiscoverAndRequestJwtAuthGrant(...args),
  };
});

const IDP_ISSUER = "https://mock-idp.test";
const AS_ISSUER = "https://mock-as.test";
const MCP_RESOURCE = "https://mcp.test/resource";
const ID_TOKEN = "header.idpayload.sig";
const ID_JAG = "mock-id-jag-token";
const ACCESS_TOKEN = "mock-resource-access-token";

function asMetadata() {
  return {
    ...minimalOAuthAsMetadata(AS_ISSUER),
    jwks_uri: `${AS_ISSUER}/jwks`,
  };
}

describe("ema wire", () => {
  beforeEach(() => {
    mockDiscoverAndRequestJwtAuthGrant.mockReset();
  });

  describe("exchangeIdJag", () => {
    it("delegates to the SDK ID-JAG helper and returns the grant", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockResolvedValueOnce({
        jwtAuthGrant: ID_JAG,
        authorizationServerUrl: IDP_ISSUER,
      });

      const idJag = await exchangeIdJag({
        idp: {
          issuer: IDP_ISSUER,
          clientId: EMA_MOCK_IDP_CLIENT_ID,
          clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
        },
        idToken: ID_TOKEN,
        audience: AS_ISSUER,
        resource: MCP_RESOURCE,
        scope: "mcp",
      });

      expect(idJag).toBe(ID_JAG);
      expect(mockDiscoverAndRequestJwtAuthGrant).toHaveBeenCalledWith({
        idpUrl: IDP_ISSUER,
        audience: AS_ISSUER,
        resource: MCP_RESOURCE,
        idToken: ID_TOKEN,
        clientId: EMA_MOCK_IDP_CLIENT_ID,
        clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
        scope: "mcp",
        fetchFn: undefined,
      });
    });

    it("throws when IdP metadata is missing a token_endpoint", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockRejectedValueOnce(
        new Error("Failed to discover token endpoint"),
      );

      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          resource: MCP_RESOURCE,
        }),
      ).rejects.toThrow(/IdP metadata missing token_endpoint/);
    });

    it("sets resource and scope params and throws when no ID-JAG is returned", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockRejectedValueOnce(
        new Error("Invalid token exchange response"),
      );

      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          resource: MCP_RESOURCE,
          scope: "mcp profile",
        }),
      ).rejects.toThrow(/did not return an ID-JAG/);

      expect(mockDiscoverAndRequestJwtAuthGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: MCP_RESOURCE,
          scope: "mcp profile",
        }),
      );
    });

    it("throws when IdP token exchange fails", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockRejectedValueOnce(
        new Error("invalid_grant"),
      );

      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          resource: MCP_RESOURCE,
        }),
      ).rejects.toThrow(/EMA leg 2/);
    });

    it("rejects an empty resource identifier before calling the SDK", async () => {
      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          resource: "   ",
        }),
      ).rejects.toThrow(/EMA leg 2 requires a resource identifier/);
      expect(mockDiscoverAndRequestJwtAuthGrant).not.toHaveBeenCalled();
    });

    it("maps non-Error SDK failures through the generic EMA leg 2 wrapper", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockRejectedValueOnce("boom");

      await expect(
        exchangeIdJag({
          idp: {
            issuer: IDP_ISSUER,
            clientId: EMA_MOCK_IDP_CLIENT_ID,
            clientSecret: EMA_MOCK_IDP_CLIENT_SECRET,
          },
          idToken: ID_TOKEN,
          audience: AS_ISSUER,
          resource: MCP_RESOURCE,
        }),
      ).rejects.toThrow(/EMA leg 2 \(IdP token exchange for ID-JAG\): boom/);
    });

    it("throws when the SDK returns success without a jwtAuthGrant", async () => {
      mockDiscoverAndRequestJwtAuthGrant.mockResolvedValueOnce({
        jwtAuthGrant: "",
        authorizationServerUrl: IDP_ISSUER,
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
          resource: MCP_RESOURCE,
        }),
      ).rejects.toThrow(/did not return an ID-JAG/);
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

    it("sets resource and scope params and uses public-client auth when no secret", async () => {
      const fetchFn = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/.well-known/oauth-authorization-server")) {
            return new Response(JSON.stringify(asMetadata()));
          }
          if (url === `${AS_ISSUER}/token`) {
            const body = new URLSearchParams(init?.body as string);
            expect(body.get("scope")).toBe("mcp");
            expect(body.get("resource")).toBe("https://mcp.test/resource");
            expect(body.get("client_id")).toBe(EMA_MOCK_RESOURCE_CLIENT_ID);
            expect(body.get("client_secret")).toBeNull();
            return new Response(
              JSON.stringify({
                access_token: ACCESS_TOKEN,
                token_type: "Bearer",
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
        resource: "https://mcp.test/resource",
        scope: "mcp",
        fetchFn,
      });

      expect(tokens.access_token).toBe(ACCESS_TOKEN);
    });

    it("throws when the resource AS JWT bearer grant fails", async () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-authorization-server")) {
          return new Response(JSON.stringify(asMetadata()));
        }
        if (url === `${AS_ISSUER}/token`) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      await expect(
        redeemIdJagForAccessToken({
          resourceAsUrl: new URL(AS_ISSUER),
          idJag: ID_JAG,
          resourceClientId: EMA_MOCK_RESOURCE_CLIENT_ID,
          resourceClientSecret: EMA_MOCK_RESOURCE_CLIENT_SECRET,
          fetchFn,
        }),
      ).rejects.toThrow(/EMA leg 3/);
      errorSpy.mockRestore();
    });
  });
});
