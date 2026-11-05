import { describe, expect, it } from "vitest";
import {
  accessTokenDetailLines,
  formatDuration,
  isAccessTokenSummaryExpired,
  summarizeAccessToken,
} from "@inspector/core/auth/accessTokenClaims.js";

function b64url(value: unknown): string {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");
}

function jwt(payload: unknown): string {
  return `${b64url({ alg: "RS256", typ: "at+jwt" })}.${b64url(payload)}.sig`;
}

// 2026-01-01T00:00:00.000Z
const NOW_S = 1_767_225_600;
const NOW_MS = NOW_S * 1000;

describe("summarizeAccessToken", () => {
  it("decodes RFC 9068 claims from a JWT access token", () => {
    const summary = summarizeAccessToken({
      access_token: jwt({
        iss: "https://as.example.com",
        aud: "https://mcp.example.com",
        sub: "user-1",
        client_id: "client-1",
        azp: "ignored-when-client_id-present",
        scope: "read  write",
        iat: NOW_S - 300,
        exp: NOW_S + 3300,
      }),
      scope: "response-scope",
      expires_in: 3600,
    });
    expect(summary).toEqual({
      format: "jwt",
      issuer: "https://as.example.com",
      audience: ["https://mcp.example.com"],
      subject: "user-1",
      clientId: "client-1",
      scopes: ["read", "write"],
      issuedAt: NOW_S - 300,
      expiresAt: NOW_S + 3300,
    });
  });

  it("falls back to azp and scp, and accepts an audience list", () => {
    const summary = summarizeAccessToken({
      access_token: jwt({
        aud: ["a", 7, "b"],
        azp: "azp-client",
        scp: ["x", "y"],
      }),
    });
    expect(summary).toMatchObject({
      format: "jwt",
      audience: ["a", "b"],
      clientId: "azp-client",
      scopes: ["x", "y"],
    });
  });

  it("drops malformed claim types and strips control characters", () => {
    const summary = summarizeAccessToken({
      access_token: jwt({
        iss: "https://as\u001b]52;c;evil\u0007.example\u009b",
        sub: "   ",
        aud: [],
        scope: 42,
        exp: "soon",
        iat: Number.NaN,
      }),
    });
    expect(summary).toEqual({
      format: "jwt",
      issuer: "https://as]52;c;evil.example",
      audience: undefined,
      subject: undefined,
      clientId: undefined,
      scopes: undefined,
      issuedAt: undefined,
      expiresAt: undefined,
    });
  });

  it("reads an opaque token from the token response", () => {
    expect(
      summarizeAccessToken({
        access_token: "opaque-token",
        scope: "mcp:read mcp:write",
        expires_in: 3600,
      }),
    ).toEqual({
      format: "opaque",
      scopes: ["mcp:read", "mcp:write"],
      expiresIn: 3600,
    });
    expect(summarizeAccessToken({ access_token: "opaque-token" })).toEqual({
      format: "opaque",
      scopes: undefined,
      expiresIn: undefined,
    });
  });

  it("treats a JWT-shaped token whose payload is not an object as opaque", () => {
    for (const payload of ["null", '"just a string"', "[1,2]"]) {
      expect(
        summarizeAccessToken({
          access_token: `${b64url({})}.${b64url(payload)}.s`,
        }).format,
      ).toBe("opaque");
    }
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45.9, "45s"],
    [-45, "45s"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h"],
    [3900, "1h 5m"],
    [86_400, "1d"],
    [86_400 + 4 * 3600 + 59, "1d 4h"],
  ])("%s seconds -> %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("isAccessTokenSummaryExpired", () => {
  it("is true only for a past exp", () => {
    expect(
      isAccessTokenSummaryExpired(
        { format: "jwt", expiresAt: NOW_S - 1 },
        NOW_MS,
      ),
    ).toBe(true);
    expect(
      isAccessTokenSummaryExpired({ format: "jwt", expiresAt: NOW_S }, NOW_MS),
    ).toBe(true);
    expect(
      isAccessTokenSummaryExpired(
        { format: "jwt", expiresAt: NOW_S + 1 },
        NOW_MS,
      ),
    ).toBe(false);
    expect(isAccessTokenSummaryExpired({ format: "jwt" }, NOW_MS)).toBe(false);
  });
});

describe("accessTokenDetailLines", () => {
  it("renders every JWT claim with relative times", () => {
    expect(
      accessTokenDetailLines(
        {
          format: "jwt",
          issuer: "https://as.example.com",
          audience: ["a", "b"],
          subject: "user-1",
          clientId: "client-1",
          scopes: ["read", "write"],
          issuedAt: NOW_S - 300,
          expiresAt: NOW_S + 3300,
        },
        NOW_MS,
      ),
    ).toEqual([
      { label: "Format", value: "JWT (signature not verified)" },
      { label: "Issuer", value: "https://as.example.com" },
      { label: "Audience", value: "a, b" },
      { label: "Subject", value: "user-1" },
      { label: "Client", value: "client-1" },
      { label: "Scopes", value: "read, write" },
      { label: "Issued", value: "2025-12-31T23:55:00.000Z (5m ago)" },
      { label: "Expires", value: "2026-01-01T00:55:00.000Z (in 55m)" },
    ]);
  });

  it("marks an expired JWT and an absent exp", () => {
    expect(
      accessTokenDetailLines({ format: "jwt", expiresAt: NOW_S - 120 }, NOW_MS),
    ).toEqual([
      { label: "Format", value: "JWT (signature not verified)" },
      {
        label: "Expires",
        value: "2025-12-31T23:58:00.000Z (expired 2m ago)",
      },
    ]);
    expect(accessTokenDetailLines({ format: "jwt" }, NOW_MS)).toEqual([
      { label: "Format", value: "JWT (signature not verified)" },
      { label: "Expires", value: "no exp claim" },
    ]);
  });

  it("falls back to the raw number for an out-of-range timestamp", () => {
    expect(
      accessTokenDetailLines({ format: "jwt", issuedAt: 1e20 }, NOW_MS)[1],
    ).toMatchObject({
      label: "Issued",
      value: expect.stringMatching(/^100000000000000000000 \(in /),
    });
  });

  it("renders an opaque token from the token response", () => {
    expect(
      accessTokenDetailLines(
        { format: "opaque", scopes: ["read"], expiresIn: 3600 },
        NOW_MS,
      ),
    ).toEqual([
      { label: "Format", value: "Opaque (not a JWT)" },
      { label: "Scopes", value: "read" },
      {
        label: "Expires in",
        value: "1h from issuance (token response expires_in)",
      },
    ]);
    expect(accessTokenDetailLines({ format: "opaque" }, NOW_MS)).toEqual([
      { label: "Format", value: "Opaque (not a JWT)" },
      { label: "Expires in", value: "not stated by the token response" },
    ]);
  });
});
