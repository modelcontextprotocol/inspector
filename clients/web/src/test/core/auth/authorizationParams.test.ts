import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RESERVED_AUTHORIZATION_PARAMS,
  applyAuthorizationParams,
  authorizationParamKeyError,
  isReservedAuthorizationParam,
} from "@inspector/core/auth/authorizationParams.js";

const AUTHORIZE_URL =
  "https://as.example.com/authorize?client_id=abc&response_type=code&state=xyz";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isReservedAuthorizationParam", () => {
  it.each(RESERVED_AUTHORIZATION_PARAMS)("reserves %s", (key) => {
    expect(isReservedAuthorizationParam(key)).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isReservedAuthorizationParam("  Client_ID ")).toBe(true);
  });

  it("allows a provider-specific parameter", () => {
    expect(isReservedAuthorizationParam("kc_idp_hint")).toBe(false);
  });
});

describe("authorizationParamKeyError", () => {
  it("returns no error for a blank key (a half-edited row)", () => {
    expect(authorizationParamKeyError("")).toBeUndefined();
    expect(authorizationParamKeyError("   ")).toBeUndefined();
  });

  it("returns no error for an allowed key", () => {
    expect(authorizationParamKeyError("login_hint")).toBeUndefined();
  });

  it("names the offending key for a reserved one", () => {
    expect(authorizationParamKeyError(" state ")).toBe(
      '"state" is set by the authorization flow and cannot be overridden.',
    );
  });
});

describe("applyAuthorizationParams", () => {
  it("returns the same URL instance when no params are configured", () => {
    const url = new URL(AUTHORIZE_URL);
    expect(applyAuthorizationParams(url, undefined)).toBe(url);
  });

  it("returns the same URL instance when the params object is empty", () => {
    const url = new URL(AUTHORIZE_URL);
    expect(applyAuthorizationParams(url, {})).toBe(url);
  });

  it("appends custom params without mutating the input URL", () => {
    const url = new URL(AUTHORIZE_URL);
    const merged = applyAuthorizationParams(url, {
      kc_idp_hint: "corp-idp",
      login_hint: "user@example.com",
    });

    expect(merged).not.toBe(url);
    expect(url.searchParams.get("kc_idp_hint")).toBeNull();
    expect(merged.searchParams.get("kc_idp_hint")).toBe("corp-idp");
    expect(merged.searchParams.get("login_hint")).toBe("user@example.com");
    // The SDK-built parameters survive untouched.
    expect(merged.searchParams.get("client_id")).toBe("abc");
    expect(merged.searchParams.get("state")).toBe("xyz");
  });

  it("trims the key and preserves the value verbatim", () => {
    const merged = applyAuthorizationParams(new URL(AUTHORIZE_URL), {
      "  prompt  ": " login ",
    });
    expect(merged.searchParams.get("prompt")).toBe(" login ");
  });

  it("skips blank keys", () => {
    const url = new URL(AUTHORIZE_URL);
    const merged = applyAuthorizationParams(url, { "   ": "nope" });
    expect(merged).toBe(url);
  });

  it("drops a reserved key with a warning rather than overriding it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const merged = applyAuthorizationParams(new URL(AUTHORIZE_URL), {
      state: "attacker-controlled",
      kc_idp_hint: "corp-idp",
    });

    expect(merged.searchParams.get("state")).toBe("xyz");
    expect(merged.searchParams.get("kc_idp_hint")).toBe("corp-idp");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("state");
  });

  it("returns the original URL when every configured key is reserved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = new URL(AUTHORIZE_URL);
    expect(
      applyAuthorizationParams(url, {
        Client_Id: "spoofed",
        code_challenge: "spoofed",
      }),
    ).toBe(url);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
