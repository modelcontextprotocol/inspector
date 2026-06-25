import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
} from "@inspector/core/auth/ema/idpSession.js";

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
      getIdpSession: vi.fn(),
      saveIdpSession: vi.fn(),
      clearIdpSession: vi.fn(),
      clear: vi.fn(),
      clearEnterpriseManagedResourceServers: vi.fn(),
    } as unknown as OAuthStorage;
  });

  it("normalizeIdpIssuer strips trailing slash", () => {
    expect(normalizeIdpIssuer("https://idp.test/")).toBe("https://idp.test");
  });

  it("getEmaIdpLoginState returns none when no session", async () => {
    vi.mocked(storage.getIdpSession).mockResolvedValue(undefined);
    expect(await getEmaIdpLoginState(storage, "https://idp.test")).toBe("none");
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

  it("clearEmaIdpSession clears idp session, leg-1 key, and tagged resource servers", () => {
    clearEmaIdpSession(storage, "https://idp.test/");
    expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
    expect(storage.clear).toHaveBeenCalledWith("ema-idp:https://idp.test");
    expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
  });
});
