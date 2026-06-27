import { describe, it, expect } from "vitest";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
import { oauthDetailsFromConnectionState } from "./oauthDetailsFromConnectionState";

describe("oauthDetailsFromConnectionState", () => {
  it("maps authorized standard connection state", () => {
    const state: OAuthConnectionState = {
      authorized: true,
      protocol: "standard",
      serverUrl: "https://mcp.example.com/mcp",
      grantedScope: "read write",
      tokens: { access_token: "tok", token_type: "Bearer" },
      client: {
        registrationKind: "static",
        clientId: "client-1",
        hasClientSecret: true,
      },
      authorizationServerMetadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        response_types_supported: ["code"],
      },
    };

    expect(oauthDetailsFromConnectionState(state)).toEqual({
      protocol: "standard",
      authorized: true,
      clientId: "client-1",
      clientRegistrationKind: "static",
      authUrl: "https://auth.example.com/authorize",
      scopes: ["read", "write"],
      accessToken: "tok",
    });
  });

  it("includes EMA idp session when present", () => {
    const state: OAuthConnectionState = {
      authorized: false,
      protocol: "ema",
      serverUrl: "https://mcp.example.com/mcp",
      ema: {
        idpIssuer: "https://idp.example.com",
        idpClientId: "idp-client",
        idpSession: "logged_in",
      },
    };

    expect(oauthDetailsFromConnectionState(state)).toEqual({
      protocol: "ema",
      authorized: false,
      idpSession: "logged_in",
    });
  });
});
