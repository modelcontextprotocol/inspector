import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
} from "@inspector/core/auth/ema/idpSession.js";
import { discoverIdpMetadata } from "@inspector/core/auth/ema/idpOidc.js";
import type { OAuthMetadata } from "@modelcontextprotocol/client";

vi.mock("@inspector/core/auth/ema/idpOidc.js", () => ({
  discoverIdpMetadata: vi.fn(),
}));

/**
 * Minimal valid RFC 8414 metadata plus extras. `end_session_endpoint` is an
 * OIDC-layer field outside the typed shape, so it rides in via spread (the
 * SDK parses with a loose object, so real discovery responses carry it the
 * same way).
 */
function idpMetadata(extra: Record<string, unknown> = {}): OAuthMetadata {
  return {
    issuer: "https://idp.test",
    authorization_endpoint: "https://idp.test/authorize",
    token_endpoint: "https://idp.test/token",
    response_types_supported: ["code"],
    ...extra,
  };
}

function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

describe("idpSession", () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    vi.mocked(discoverIdpMetadata).mockReset();
    storage = {
      load: vi.fn().mockResolvedValue(undefined),
      getIdpSession: vi.fn(),
      saveIdpSession: vi.fn(),
      clearIdpSession: vi.fn(),
      clear: vi.fn(),
      clearEnterpriseManagedResourceServers: vi.fn(),
      takeRevocationSnapshot: vi.fn().mockResolvedValue({ byIssuer: {} }),
    } as unknown as OAuthStorage;
  });

  it("normalizeIdpIssuer strips trailing slash", () => {
    expect(normalizeIdpIssuer("https://idp.test/")).toBe("https://idp.test");
  });

  it("getEmaIdpLoginState returns none when no session", async () => {
    vi.mocked(storage.getIdpSession).mockResolvedValue(undefined);
    expect(await getEmaIdpLoginState(storage, "https://idp.test")).toBe("none");
  });

  it("getEmaIdpLoginState returns none when issuer normalizes to empty", async () => {
    expect(await getEmaIdpLoginState(storage, "")).toBe("none");
    expect(storage.getIdpSession).not.toHaveBeenCalled();
  });

  it("getEmaIdpLoginState returns logged_in for valid id token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: jwtWithExp(exp),
    });
    expect(await getEmaIdpLoginState(storage, "https://idp.test/")).toBe(
      "logged_in",
    );
    expect(storage.getIdpSession).toHaveBeenCalledWith("https://idp.test");
  });

  it("getEmaIdpLoginState returns expired for expired id token without refresh", async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: jwtWithExp(exp),
    });
    expect(await getEmaIdpLoginState(storage, "https://idp.test")).toBe(
      "expired",
    );
  });

  it("getEmaIdpLoginState returns logged_in when id token expired but refresh_token remains", async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: jwtWithExp(exp),
      refreshToken: "rt-1",
    });
    expect(await getEmaIdpLoginState(storage, "https://idp.test")).toBe(
      "logged_in",
    );
  });

  it("clearEmaIdpSession clears idp session, leg-1 key, and tagged resource servers", async () => {
    const result = await clearEmaIdpSession(storage, "https://idp.test/");
    expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
    expect(storage.clear).toHaveBeenCalledWith("ema-idp:https://idp.test");
    expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
    // Without buildEndSessionUrl there is no session read and no discovery.
    expect(result).toEqual({});
    expect(storage.getIdpSession).not.toHaveBeenCalled();
    expect(discoverIdpMetadata).not.toHaveBeenCalled();
  });

  it("clearEmaIdpSession no-ops when issuer normalizes to empty", async () => {
    await clearEmaIdpSession(storage, "");
    expect(storage.clearIdpSession).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(
      storage.clearEnterpriseManagedResourceServers,
    ).not.toHaveBeenCalled();
  });

  describe("clearEmaIdpSession buildEndSessionUrl", () => {
    const OPTS = { buildEndSessionUrl: true };

    it("returns the end-session URL with id_token_hint", async () => {
      vi.mocked(storage.getIdpSession).mockResolvedValue({
        idToken: "a.b.c",
      });
      vi.mocked(discoverIdpMetadata).mockResolvedValue(
        idpMetadata({ end_session_endpoint: "https://idp.test/session/end" }),
      );
      const result = await clearEmaIdpSession(storage, "https://idp.test", {
        ...OPTS,
        fetchFn: fetch,
      });
      expect(result.endSessionUrl).toBe(
        "https://idp.test/session/end?id_token_hint=a.b.c",
      );
      // The clear still happened in full.
      expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
      expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
    });

    it("returns no URL when no IdP session (and skips discovery)", async () => {
      vi.mocked(storage.getIdpSession).mockResolvedValue(undefined);
      const result = await clearEmaIdpSession(
        storage,
        "https://idp.test",
        OPTS,
      );
      expect(result).toEqual({});
      expect(discoverIdpMetadata).not.toHaveBeenCalled();
      expect(storage.clearIdpSession).toHaveBeenCalled();
    });

    it("returns no URL when discovery fails (clear already happened)", async () => {
      vi.mocked(storage.getIdpSession).mockResolvedValue({ idToken: "a.b.c" });
      vi.mocked(discoverIdpMetadata).mockRejectedValue(new Error("offline"));
      const result = await clearEmaIdpSession(
        storage,
        "https://idp.test",
        OPTS,
      );
      expect(result).toEqual({});
      expect(storage.clearIdpSession).toHaveBeenCalled();
    });

    it.each([
      ["absent", {}],
      ["not a string", { end_session_endpoint: 42 }],
      ["not a URL", { end_session_endpoint: "not a url" }],
      ["non-http scheme", { end_session_endpoint: "javascript:alert(1)" }],
    ])(
      "returns no URL when end_session_endpoint is %s",
      async (_label, metadata) => {
        vi.mocked(storage.getIdpSession).mockResolvedValue({
          idToken: "a.b.c",
        });
        vi.mocked(discoverIdpMetadata).mockResolvedValue(idpMetadata(metadata));
        const result = await clearEmaIdpSession(
          storage,
          "https://idp.test",
          OPTS,
        );
        expect(result).toEqual({});
      },
    );
  });
});
