import { describe, it, expect, afterEach } from "vitest";
import {
  parseHttpUrl,
  parseOAuthCallbackParams,
  generateOAuthState,
  parseOAuthState,
  generateOAuthErrorDescription,
  formatOAuthFailureDetail,
  isUnauthorizedError,
} from "@inspector/core/auth/utils.js";
import {
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { z, ZodError } from "zod";

describe("parseHttpUrl", () => {
  it("parses valid URLs", () => {
    expect(parseHttpUrl("https://example.com/path", "test").href).toBe(
      "https://example.com/path",
    );
  });

  it("throws on invalid URLs", () => {
    expect(() => parseHttpUrl("not-a-url", "test")).toThrow(/Invalid test/);
  });

  it("includes the trimmed offending value in the thrown message", () => {
    expect(() => parseHttpUrl("  bad url  ", "Server URL")).toThrow(
      /Invalid Server URL: "bad url"/,
    );
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

describe("formatOAuthFailureDetail", () => {
  const zodTokenJson = `[ { "expected": "string", "code": "invalid_type", "path": [ "access_token" ], "message": "Invalid input" }, { "expected": "string", "code": "invalid_type", "path": [ "token_type" ], "message": "Invalid input" } ]`;

  it("replaces serialized Zod token-response issues with readable copy", () => {
    expect(formatOAuthFailureDetail(zodTokenJson)).toBe(
      "The authorization server did not return valid tokens. Check your OAuth client ID and secret, then try again.",
    );
  });

  it("formats ZodError instances", () => {
    const err = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["access_token"],
        message: "Invalid input",
      },
    ]);
    expect(formatOAuthFailureDetail(err)).toMatch(/valid tokens/i);
  });

  it("passes through ordinary error messages", () => {
    expect(formatOAuthFailureDetail(new Error("Network timeout"))).toBe(
      "Network timeout",
    );
  });

  it("passes through plain strings that are not bracketed JSON", () => {
    expect(formatOAuthFailureDetail("something went wrong")).toBe(
      "something went wrong",
    );
  });

  it("stringifies non-string/non-error values", () => {
    expect(formatOAuthFailureDetail(42)).toBe("42");
    expect(formatOAuthFailureDetail(null)).toBe("null");
  });

  it("formats a real ZodError instance (non-token path)", () => {
    const err = z.string().safeParse(123).error!;
    const result = formatOAuthFailureDetail(err);
    expect(result).not.toMatch(/valid tokens/i);
    // Root-level failure has an empty path → "input" label
    expect(result).toMatch(/^input: /);
  });

  it("joins non-token issues as `path: message`", () => {
    const err = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["client", "id"],
        message: "Required",
      },
    ]);
    expect(formatOAuthFailureDetail(err)).toBe("client.id: Required");
  });

  it("labels an issue with an empty path as `input` and defaults a missing message to `invalid`", () => {
    const err = new ZodError([
      {
        code: "custom",
        path: [],
      } as unknown as z.core.$ZodIssue,
    ]);
    expect(formatOAuthFailureDetail(err)).toBe("input: invalid");
  });

  it("formats a bracketed JSON string of non-token zod issues", () => {
    const json = `[ { "code": "invalid_type", "path": [ "scope" ], "message": "Required" } ]`;
    expect(formatOAuthFailureDetail(json)).toBe("scope: Required");
  });

  it("returns the raw string when bracketed JSON is invalid", () => {
    const bad = "[ not valid json";
    expect(formatOAuthFailureDetail(bad)).toBe(bad);
  });

  it("returns the raw string when bracketed JSON is not a zod-issue array", () => {
    // Parses fine, but empty array / first element lacks `code`
    expect(formatOAuthFailureDetail("[]")).toBe("[]");
    const notIssues = `[ { "foo": "bar" } ]`;
    expect(formatOAuthFailureDetail(notIssues)).toBe(notIssues);
  });

  it("returns the raw string when bracketed JSON is a non-array value", () => {
    const obj = `[1, 2, 3]`;
    // Array of numbers: first element is not an object → not a zod-issue array
    expect(formatOAuthFailureDetail(obj)).toBe(obj);
  });
});

describe("isUnauthorizedError", () => {
  it("returns true for an object with status 401", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
  });

  it("returns true for an object with code 401", () => {
    expect(isUnauthorizedError({ code: 401 })).toBe(true);
  });

  it("returns true when an Error message matches the transport wording", () => {
    expect(
      isUnauthorizedError(new Error("Connection failed for server (401)")),
    ).toBe(true);
  });

  it("returns true when a non-error value stringifies to matching wording", () => {
    expect(isUnauthorizedError("request failed with status (401)")).toBe(true);
  });

  it("returns false for unrelated (401) mentions without `failed`", () => {
    expect(isUnauthorizedError(new Error("error code (401) noted"))).toBe(
      false,
    );
  });

  it("returns false for a non-401 object", () => {
    expect(isUnauthorizedError({ status: 500 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUnauthorizedError(null)).toBe(false);
  });

  it("returns true for SDK UnauthorizedError", () => {
    expect(isUnauthorizedError(new UnauthorizedError("Unauthorized"))).toBe(
      true,
    );
  });

  it("returns true when EraNegotiationFailed wraps UnauthorizedError in data.cause", () => {
    const wrapped = new SdkError(
      SdkErrorCode.EraNegotiationFailed,
      "Version negotiation probe failed",
      { cause: new UnauthorizedError("Unauthorized") },
    );
    expect(isUnauthorizedError(wrapped)).toBe(true);
  });

  it("returns true when UnauthorizedError is on native Error.cause", () => {
    const wrapped = new Error("probe failed", {
      cause: new UnauthorizedError("Unauthorized"),
    });
    expect(isUnauthorizedError(wrapped)).toBe(true);
  });

  it("returns false for unrelated SdkError", () => {
    expect(
      isUnauthorizedError(
        new SdkError(SdkErrorCode.RequestTimeout, "timed out"),
      ),
    ).toBe(false);
  });
});

describe("generateOAuthErrorDescription without description/uri", () => {
  it("omits the details and more-info lines when absent", () => {
    const message = generateOAuthErrorDescription({
      successful: false,
      error: "server_error",
      error_description: null,
      error_uri: null,
    });
    expect(message).toBe("Error: server_error.");
  });
});

describe("parseOAuthCallbackParams error without description", () => {
  it("returns null description/uri when only error is present", () => {
    expect(parseOAuthCallbackParams("?error=access_denied")).toEqual({
      successful: false,
      error: "access_denied",
      error_description: null,
      error_uri: null,
    });
  });
});
