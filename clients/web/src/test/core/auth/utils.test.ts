import { describe, it, expect } from "vitest";
import {
  parseHttpUrl,
  parseOAuthCallbackParams,
  generateOAuthState,
  parseOAuthState,
  generateOAuthErrorDescription,
} from "@inspector/core/auth/utils.js";

describe("parseHttpUrl", () => {
  it("parses valid URLs", () => {
    expect(parseHttpUrl("https://example.com/path", "test").href).toBe(
      "https://example.com/path",
    );
  });

  it("throws on invalid URLs", () => {
    expect(() => parseHttpUrl("not-a-url", "test")).toThrow(/Invalid test/);
  });
});

describe("parseOAuthCallbackParams", () => {
  it("parses successful callback", () => {
    expect(parseOAuthCallbackParams("?code=abc123")).toEqual({
      successful: true,
      code: "abc123",
    });
  });

  it("parses error callback", () => {
    expect(
      parseOAuthCallbackParams(
        "?error=access_denied&error_description=User%20denied",
      ),
    ).toEqual({
      successful: false,
      error: "access_denied",
      error_description: "User denied",
      error_uri: null,
    });
  });

  it("returns invalid_request when code and error are missing", () => {
    expect(parseOAuthCallbackParams("?foo=bar")).toEqual({
      successful: false,
      error: "invalid_request",
      error_description: "Missing code or error in response",
      error_uri: null,
    });
  });
});

describe("generateOAuthState", () => {
  it("should generate 64-char hex state", () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[a-f0-9]{64}$/i);
  });

  it("should generate unique states", () => {
    const s1 = generateOAuthState();
    const s2 = generateOAuthState();
    expect(s1).not.toBe(s2);
  });

  it("throws instead of silently degrading when crypto.getRandomValues is unavailable", () => {
    const original = globalThis.crypto;
    // Simulate a runtime without Web Crypto — the CSRF token must not fall back
    // to a predictable Math.random source.
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(() => generateOAuthState()).toThrow(
        /crypto\.getRandomValues is not available/,
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});

describe("parseOAuthState", () => {
  it("should parse 64-char hex authId", () => {
    const hex = "a".repeat(64);
    const parsed = parseOAuthState(hex);
    expect(parsed).toEqual({ authId: hex });
  });

  it("should return null for invalid state", () => {
    expect(parseOAuthState("")).toBeNull();
    expect(parseOAuthState("invalid")).toBeNull();
    expect(parseOAuthState("abc123")).toBeNull();
    expect(parseOAuthState("other:xyz")).toBeNull();
  });
});

describe("generateOAuthErrorDescription", () => {
  it("formats error with description and uri", () => {
    const message = generateOAuthErrorDescription({
      successful: false,
      error: "access_denied",
      error_description: "User denied access",
      error_uri: "https://example.com/errors/access_denied",
    });
    expect(message).toContain("Error: access_denied.");
    expect(message).toContain("Details: User denied access.");
    expect(message).toContain(
      "More info: https://example.com/errors/access_denied.",
    );
  });
});
