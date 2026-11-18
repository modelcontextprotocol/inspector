import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";

const { sdkAuth } = vi.hoisted(() => ({
  sdkAuth: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    auth: sdkAuth,
  };
});

import { IssuerMismatchError } from "@modelcontextprotocol/client";
import {
  ISSUER_METADATA_MISMATCH_HINT,
  mcpAuth,
} from "@inspector/core/auth/mcpAuth.js";

function makeProvider(): OAuthClientProvider {
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
  };
}

describe("mcpAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the authorization-code exchange (incl. iss) to SDK auth()", async () => {
    sdkAuth.mockResolvedValue("AUTHORIZED");
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      iss: "https://as.example.com",
      fetchFn: fetch,
    });

    expect(result).toBe("AUTHORIZED");
    expect(sdkAuth).toHaveBeenCalledWith(provider, {
      serverUrl: "https://mcp.example.com",
      authorizationCode: "code",
      iss: "https://as.example.com",
      scope: undefined,
      resourceMetadataUrl: undefined,
      fetchFn: fetch,
      skipIssuerMetadataValidation: undefined,
      forceReauthorization: undefined,
    });
  });

  it("forwards forceReauthorization + skipIssuerMetadataValidation to SDK auth()", async () => {
    sdkAuth.mockResolvedValue("REDIRECT");
    const provider = makeProvider();

    const result = await mcpAuth(provider, {
      serverUrl: "https://mcp.example.com",
      scope: "mcp weather:read",
      forceReauthorization: true,
      skipIssuerMetadataValidation: true,
    });

    expect(result).toBe("REDIRECT");
    expect(sdkAuth).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({
        scope: "mcp weather:read",
        forceReauthorization: true,
        skipIssuerMetadataValidation: true,
      }),
    );
  });

  it("rejects forceReauthorization combined with authorizationCode without calling SDK auth()", async () => {
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
  });

  it("propagates the SDK auth() rejection", async () => {
    sdkAuth.mockRejectedValue(new Error("discovery failed"));
    const provider = makeProvider();

    await expect(
      mcpAuth(provider, { serverUrl: "https://mcp.example.com" }),
    ).rejects.toThrow("discovery failed");
  });

  // #2983 — Entra's multi-tenant metadata names a template issuer, and the
  // SDK's error alone leaves the user with no way forward.
  describe("metadata issuer mismatch hint", () => {
    const EXPECTED = "https://login.microsoftonline.com/organizations/v2.0";
    const RECEIVED = "https://login.microsoftonline.com/{tenantid}/v2.0";

    it("names the per-server setting and keeps the SDK error as the cause", async () => {
      const original = new IssuerMismatchError("metadata", EXPECTED, RECEIVED);
      sdkAuth.mockRejectedValue(original);

      const err: unknown = await mcpAuth(makeProvider(), {
        serverUrl: "https://mcp.example.com",
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      const thrown = err as Error;
      expect(thrown.message).toBe(
        `${original.message}. ${ISSUER_METADATA_MISMATCH_HINT}`,
      );
      expect(thrown.message).toContain("Skip issuer metadata validation");
      expect(thrown.message).toContain("oauth.skipIssuerMetadataValidation");
      expect(thrown.message).toContain("weakens a security check");
      expect(thrown.cause).toBe(original);
    });

    it("recognizes the error by name across a serialization boundary", async () => {
      const serialized = Object.assign(new Error("Issuer mismatch"), {
        name: "IssuerMismatchError",
        kind: "metadata",
      });
      sdkAuth.mockRejectedValue(serialized);

      await expect(
        mcpAuth(makeProvider(), { serverUrl: "https://mcp.example.com" }),
      ).rejects.toThrow(ISSUER_METADATA_MISMATCH_HINT);
    });

    it("adds no hint to an authorization-response (RFC 9207) mismatch", async () => {
      // The setting does not relax this check, so suggesting it would be wrong
      // — and this mismatch is the mix-up signal.
      const original = new IssuerMismatchError(
        "authorization_response",
        EXPECTED,
        "https://evil.example.com",
      );
      sdkAuth.mockRejectedValue(original);

      await expect(
        mcpAuth(makeProvider(), {
          serverUrl: "https://mcp.example.com",
          authorizationCode: "code",
        }),
      ).rejects.toBe(original);
    });

    it("passes a non-Error rejection through untouched", async () => {
      sdkAuth.mockRejectedValue("boom");

      await expect(
        mcpAuth(makeProvider(), { serverUrl: "https://mcp.example.com" }),
      ).rejects.toBe("boom");
    });
  });
});
