import { describe, it, expect } from "vitest";
import {
  AuthChallengeError,
  AuthRecoveryRequiredError,
  isAuthChallengeError,
  isConnectAuthRecoveryError,
  parseAuthChallengeFromError,
  parseAuthChallengeFromResponse,
  parseScopeString,
  parseWwwAuthenticateBearer,
  unionAuthorizationScopes,
} from "@inspector/core/auth/challenge.js";

describe("parseWwwAuthenticateBearer", () => {
  it("parses insufficient_scope and scope parameters", () => {
    expect(
      parseWwwAuthenticateBearer(
        'Bearer error="insufficient_scope", scope="weather:read admin:write"',
      ),
    ).toEqual({
      error: "insufficient_scope",
      scope: "weather:read admin:write",
      resourceMetadata: undefined,
      errorDescription: undefined,
    });
  });

  it("parses invalid_token and error_description", () => {
    expect(
      parseWwwAuthenticateBearer(
        'Bearer error="invalid_token", error_description="Token expired"',
      ),
    ).toEqual({
      error: "invalid_token",
      scope: undefined,
      resourceMetadata: undefined,
      errorDescription: "Token expired",
    });
  });

  it("parses unquoted RFC 6750 parameters", () => {
    expect(
      parseWwwAuthenticateBearer(
        "Bearer error=insufficient_scope, scope=weather:read",
      ),
    ).toEqual({
      error: "insufficient_scope",
      scope: "weather:read",
      resourceMetadata: undefined,
      errorDescription: undefined,
    });
  });

  it("returns empty object for non-Bearer challenges", () => {
    expect(parseWwwAuthenticateBearer('Basic realm="test"')).toEqual({});
  });
});

describe("parseScopeString", () => {
  it("splits space-separated scopes", () => {
    expect(parseScopeString("mcp tools:read")).toEqual(["mcp", "tools:read"]);
  });

  it("returns empty array for blank input", () => {
    expect(parseScopeString(undefined)).toEqual([]);
    expect(parseScopeString("   ")).toEqual([]);
  });
});

describe("unionAuthorizationScopes", () => {
  it("unions previous and required scopes without duplicates", () => {
    expect(
      unionAuthorizationScopes("mcp tools:read", [
        "tools:read",
        "weather:read",
      ]),
    ).toEqual(["mcp", "tools:read", "weather:read"]);
  });

  it("returns required scopes when no previous scope exists", () => {
    expect(unionAuthorizationScopes(undefined, ["weather:read"])).toEqual([
      "weather:read",
    ]);
  });
});

describe("parseAuthChallengeFromResponse", () => {
  it("maps 401 invalid_token to invalid_token reason", () => {
    const response = new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      },
    });

    expect(parseAuthChallengeFromResponse(response)).toEqual({
      reason: "invalid_token",
      raw: {
        httpStatus: 401,
        wwwAuthenticate: 'Bearer error="invalid_token"',
      },
    });
  });

  it("maps 401 without error to token_expired", () => {
    const response = new Response(null, { status: 401 });
    expect(parseAuthChallengeFromResponse(response)?.reason).toBe(
      "token_expired",
    );
  });

  it("maps 401 insufficient_scope to insufficient_scope", () => {
    const response = new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate":
          'Bearer error="insufficient_scope", scope="weather:read"',
      },
    });

    expect(parseAuthChallengeFromResponse(response)).toMatchObject({
      reason: "insufficient_scope",
      requiredScopes: ["weather:read"],
    });
  });

  it("maps 403 insufficient_scope with required scopes", () => {
    const response = new Response(null, {
      status: 403,
      headers: {
        "WWW-Authenticate":
          'Bearer error="insufficient_scope", scope="weather:read"',
      },
    });

    expect(
      parseAuthChallengeFromResponse(response, { toolName: "get_temp" }),
    ).toMatchObject({
      reason: "insufficient_scope",
      requiredScopes: ["weather:read"],
      context: { toolName: "get_temp" },
    });
  });

  it("returns undefined for non-auth statuses", () => {
    const response = new Response(null, { status: 500 });
    expect(parseAuthChallengeFromResponse(response)).toBeUndefined();
  });
});

describe("parseAuthChallengeFromError", () => {
  it("extracts embedded authChallenge objects", () => {
    const challenge = {
      reason: "token_expired" as const,
    };
    expect(parseAuthChallengeFromError({ authChallenge: challenge })).toEqual(
      challenge,
    );
  });

  it("builds a challenge from status and WWW-Authenticate on errors", () => {
    expect(
      parseAuthChallengeFromError({
        status: 403,
        wwwAuthenticate:
          'Bearer error="insufficient_scope", scope="admin:write"',
      }),
    ).toMatchObject({
      reason: "insufficient_scope",
      requiredScopes: ["admin:write"],
    });
  });

  it("returns undefined for bare 401 without auth markers", () => {
    expect(parseAuthChallengeFromError({ status: 401 })).toBeUndefined();
  });
});

describe("isAuthChallengeError", () => {
  it("detects AuthChallengeError instances", () => {
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    expect(isAuthChallengeError(err)).toBe(true);
  });

  it("detects 401 and 403 with WWW-Authenticate as auth challenges", () => {
    expect(
      isAuthChallengeError({
        status: 401,
        wwwAuthenticate: 'Bearer error="invalid_token"',
      }),
    ).toBe(true);
    expect(
      isAuthChallengeError({
        status: 403,
        wwwAuthenticate: 'Bearer error="insufficient_scope"',
      }),
    ).toBe(true);
    expect(isAuthChallengeError({ status: 500 })).toBe(false);
  });

  it("does not treat bare 401/403 status without auth markers as auth challenge", () => {
    expect(isAuthChallengeError({ status: 401 })).toBe(false);
    expect(isAuthChallengeError({ status: 403 })).toBe(false);
  });

  it("does not treat connect-time unauthorized wording as auth challenge", () => {
    expect(isAuthChallengeError(new Error("network failed"))).toBe(false);
  });
});

describe("isConnectAuthRecoveryError", () => {
  it("treats AuthRecoveryRequiredError and 401 connect failures as recoverable", () => {
    expect(
      isConnectAuthRecoveryError(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "unauthorized",
        }),
      ),
    ).toBe(true);
    const unauthorized = new Error("Unauthorized") as Error & {
      status?: number;
    };
    unauthorized.status = 401;
    expect(isConnectAuthRecoveryError(unauthorized)).toBe(true);
  });

  it("does not treat other handshake failures as recoverable", () => {
    expect(isConnectAuthRecoveryError(new Error("Connection timed out"))).toBe(
      false,
    );
    expect(
      isConnectAuthRecoveryError(
        new AuthChallengeError({ reason: "token_expired" }, 403),
      ),
    ).toBe(false);
  });
});
