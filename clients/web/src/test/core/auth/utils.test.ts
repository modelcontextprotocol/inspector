import { describe, it, expect, afterEach } from "vitest";
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
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    // Restore the real WebCrypto after tests that stub/remove it.
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      writable: true,
      value: originalCrypto,
    });
  });

  it("should generate 64-char hex state", () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[a-f0-9]{64}$/i);
  });

  it("should generate unique states", () => {
    const s1 = generateOAuthState();
    const s2 = generateOAuthState();
    expect(s1).not.toBe(s2);
  });

  it("throws when the crypto global is entirely absent (no silent Math.random fallback)", () => {
    // Simulate an exotic runtime with no WebCrypto at all. Rather than minting
    // a guessable CSRF token, generateOAuthState must fail loudly.
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(() => generateOAuthState()).toThrow(
      /crypto\.getRandomValues is not available/,
    );
  });

  it("throws when crypto.getRandomValues is missing", () => {
    // crypto exists but lacks getRandomValues — still refuse to degrade.
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      writable: true,
      value: {},
    });
    expect(() => generateOAuthState()).toThrow(
      /crypto\.getRandomValues is not available/,
    );
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
