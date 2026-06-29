import { describe, it, expect } from "vitest";
import {
  formatAuthProtocol,
  formatClientRegistrationKind,
  formatIdpSession,
  formatScopes,
} from "../src/utils/oauthDisplay.js";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";

describe("oauthDisplay", () => {
  it("formatAuthProtocol distinguishes standard and EMA", () => {
    expect(formatAuthProtocol("standard")).toBe("Standard");
    expect(formatAuthProtocol("ema")).toBe("Enterprise-managed");
  });

  it("formatClientRegistrationKind covers registration kinds", () => {
    expect(formatClientRegistrationKind("static")).toBe(
      "Static (preregistered)",
    );
    expect(formatClientRegistrationKind("dcr")).toBe("Dynamic (DCR)");
    expect(formatClientRegistrationKind("cimd")).toBe(
      "Client ID Metadata (CIMD)",
    );
  });

  it("formatIdpSession maps session states", () => {
    expect(formatIdpSession("logged_in")).toBe("Signed in");
    expect(formatIdpSession("expired")).toBe("Session expired");
    expect(formatIdpSession("none")).toBe("Not signed in");
  });

  it("formatScopes joins granted scope", () => {
    const state = {
      grantedScope: "openid profile",
    } as OAuthConnectionState;
    expect(formatScopes(state)).toBe("openid, profile");
  });

  it("formatScopes falls back to configured scope", () => {
    const state = {
      configuredScope: "read write",
    } as OAuthConnectionState;
    expect(formatScopes(state)).toBe("read, write");
  });

  it("formatScopes returns undefined when no scopes are present", () => {
    expect(formatScopes({} as OAuthConnectionState)).toBeUndefined();
    expect(
      formatScopes({ grantedScope: "   " } as OAuthConnectionState),
    ).toBeUndefined();
  });
});
