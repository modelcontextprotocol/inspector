import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
} from "@inspector/core/auth/ema/idpSession.js";
import type { OAuthMetadata } from "@modelcontextprotocol/client";

/**
 * Minimal valid RFC 8414 metadata plus extras. `end_session_endpoint` is an
 * OIDC-layer field outside the typed shape, so it rides in via spread (the
 * SDK parses discovery responses with a loose object, so the metadata cached
 * at login carries it the same way).
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
    storage = {
      load: vi.fn().mockResolvedValue(undefined),
      getIdpSession: vi.fn().mockResolvedValue(undefined),
      saveIdpSession: vi.fn(),
      clearIdpSession: vi.fn(),
      clear: vi.fn(),
      clearEnterpriseManagedResourceServers: vi.fn(),
      getServerMetadata: vi.fn().mockResolvedValue(null),
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
    // No session and no cached metadata: nothing to build a URL from.
    expect(result).toEqual({});
  });

  it("clearEmaIdpSession no-ops when issuer normalizes to empty", async () => {
    await clearEmaIdpSession(storage, "");
    expect(storage.clearIdpSession).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(
      storage.clearEnterpriseManagedResourceServers,
    ).not.toHaveBeenCalled();
  });

  describe("clearEmaIdpSession end-session URL", () => {
    it("returns the end-session URL with id_token_hint from cached metadata", async () => {
      vi.mocked(storage.getIdpSession).mockResolvedValue({
        idToken: "a.b.c",
      });
      vi.mocked(storage.getServerMetadata).mockResolvedValue(
        idpMetadata({ end_session_endpoint: "https://idp.test/session/end" }),
      );
      const result = await clearEmaIdpSession(storage, "https://idp.test");
      expect(result.endSessionUrl).toBe(
        "https://idp.test/session/end?id_token_hint=a.b.c",
      );
      // The reads hit the leg-1 cache key, and the clear still happened in full.
      expect(storage.getServerMetadata).toHaveBeenCalledWith(
        "ema-idp:https://idp.test",
      );
      expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
      expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
    });

    it("returns no URL when there is no IdP session", async () => {
      vi.mocked(storage.getServerMetadata).mockResolvedValue(
        idpMetadata({ end_session_endpoint: "https://idp.test/session/end" }),
      );
      const result = await clearEmaIdpSession(storage, "https://idp.test");
      expect(result).toEqual({});
      expect(storage.clearIdpSession).toHaveBeenCalled();
    });

    it("returns no URL when no metadata is cached (clear still happens)", async () => {
      vi.mocked(storage.getIdpSession).mockResolvedValue({ idToken: "a.b.c" });
      const result = await clearEmaIdpSession(storage, "https://idp.test");
      expect(result).toEqual({});
      expect(storage.clearIdpSession).toHaveBeenCalled();
    });

    it.each([
      ["absent", {}],
      ["not a string", { end_session_endpoint: 42 }],
      ["not a URL", { end_session_endpoint: "not a url" }],
      ["non-http scheme", { end_session_endpoint: "javascript:alert(1)" }],
      // The URL carries the ID token, so plain http is rejected for any
      // non-loopback host — never offer a cleartext logout URL.
      [
        "plain http on a non-loopback host",
        { end_session_endpoint: "http://idp.test/session/end" },
      ],
    ])(
      "returns no URL when end_session_endpoint is %s",
      async (_label, metadata) => {
        vi.mocked(storage.getIdpSession).mockResolvedValue({
          idToken: "a.b.c",
        });
        vi.mocked(storage.getServerMetadata).mockResolvedValue(
          idpMetadata(metadata),
        );
        const result = await clearEmaIdpSession(storage, "https://idp.test");
        expect(result).toEqual({});
      },
    );

    it.each(["localhost", "127.0.0.1", "[::1]"])(
      "allows plain http when the host is loopback (%s)",
      async (host) => {
        vi.mocked(storage.getIdpSession).mockResolvedValue({
          idToken: "a.b.c",
        });
        vi.mocked(storage.getServerMetadata).mockResolvedValue(
          idpMetadata({
            end_session_endpoint: `http://${host}:8800/session/end`,
          }),
        );
        const result = await clearEmaIdpSession(storage, "https://idp.test");
        expect(result.endSessionUrl).toBe(
          `http://${host}:8800/session/end?id_token_hint=a.b.c`,
        );
      },
    );
  });
});
