import { describe, it, expect } from "vitest";
import {
  IDP_OAUTH_KEY_PREFIX,
  idpOAuthStorageKey,
  normalizeIdpIssuer,
  parseIdpOAuthStorageKey,
} from "@inspector/core/auth/ema/storage.js";

describe("normalizeIdpIssuer", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeIdpIssuer("https://idp.example.com/")).toBe(
      "https://idp.example.com",
    );
  });

  it("leaves an issuer without a trailing slash unchanged", () => {
    expect(normalizeIdpIssuer("https://idp.example.com")).toBe(
      "https://idp.example.com",
    );
  });
});

describe("idpOAuthStorageKey / parseIdpOAuthStorageKey", () => {
  it("builds a prefixed key and round-trips back to the issuer", () => {
    const key = idpOAuthStorageKey("https://idp.example.com");
    expect(key).toBe(`${IDP_OAUTH_KEY_PREFIX}https://idp.example.com`);
    expect(parseIdpOAuthStorageKey(key)).toBe("https://idp.example.com");
  });

  it("normalises a trailing slash before prefixing", () => {
    expect(idpOAuthStorageKey("https://idp.example.com/")).toBe(
      "ema-idp:https://idp.example.com",
    );
  });

  it("returns null for a plain server URL (not an IdP key)", () => {
    expect(parseIdpOAuthStorageKey("https://mcp.example.com/mcp")).toBeNull();
  });
});
