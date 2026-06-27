import { describe, it, expect } from "vitest";
import {
  jwtExpiresAtMs,
  isJwtExpired,
  isJwtFormat,
  decodeJwtPayload,
} from "@inspector/core/auth/ema/jwt.js";

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(payload: unknown, header: unknown = { alg: "RS256" }): string {
  return `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload),
  )}.sig`;
}

describe("ema jwt", () => {
  describe("jwtExpiresAtMs", () => {
    it("returns exp in milliseconds for a valid JWT", () => {
      expect(jwtExpiresAtMs(jwt({ exp: 1000 }))).toBe(1000 * 1000);
    });

    it("returns undefined when there are fewer than two segments", () => {
      expect(jwtExpiresAtMs("onlyonesegment")).toBeUndefined();
    });

    it("returns undefined when the payload is not valid JSON", () => {
      // Second segment decodes to non-JSON text → JSON.parse throws (catch path).
      const token = `${base64Url("header")}.${base64Url("not-json")}.sig`;
      expect(jwtExpiresAtMs(token)).toBeUndefined();
    });

    it("returns undefined when exp is missing", () => {
      expect(jwtExpiresAtMs(jwt({ sub: "user" }))).toBeUndefined();
    });

    it("returns undefined when exp is not a finite number", () => {
      expect(jwtExpiresAtMs(jwt({ exp: "soon" }))).toBeUndefined();
      expect(jwtExpiresAtMs(jwt({ exp: Number.POSITIVE_INFINITY }))).toBe(
        undefined,
      );
    });
  });

  describe("isJwtExpired", () => {
    it("returns false when there is no exp claim", () => {
      expect(isJwtExpired(jwt({ sub: "user" }))).toBe(false);
    });

    it("returns true when now is past exp minus skew", () => {
      const exp = 1_000_000;
      expect(isJwtExpired(jwt({ exp }), 60_000, exp * 1000 - 30_000)).toBe(
        true,
      );
    });

    it("returns false when the token is still valid beyond the skew window", () => {
      const exp = 1_000_000;
      expect(isJwtExpired(jwt({ exp }), 60_000, exp * 1000 - 120_000)).toBe(
        false,
      );
    });
  });

  describe("isJwtFormat", () => {
    it("returns true for a three-segment token with non-empty header/payload", () => {
      expect(isJwtFormat("a.b.")).toBe(true);
      expect(isJwtFormat("a.b.c")).toBe(true);
    });

    it("returns false when there are not exactly three segments", () => {
      expect(isJwtFormat("a.b")).toBe(false);
      expect(isJwtFormat("a.b.c.d")).toBe(false);
    });

    it("returns false when header or payload segments are empty", () => {
      expect(isJwtFormat(".b.c")).toBe(false);
      expect(isJwtFormat("a..c")).toBe(false);
    });
  });

  describe("decodeJwtPayload", () => {
    it("decodes header and payload of a well-formed JWT", () => {
      const decoded = decodeJwtPayload(
        jwt({ sub: "user", exp: 1000 }, { alg: "RS256", kid: "k1" }),
      );
      expect(decoded?.header).toEqual({ alg: "RS256", kid: "k1" });
      expect(decoded?.payload).toEqual({ sub: "user", exp: 1000 });
    });

    it("returns undefined when the token is not in JWT format", () => {
      expect(decodeJwtPayload("not-a-jwt")).toBeUndefined();
    });

    it("returns undefined when a segment is not valid JSON", () => {
      // Three segments (passes isJwtFormat) but header is non-JSON → catch path.
      const token = `${base64Url("not-json")}.${base64Url(
        JSON.stringify({ sub: "user" }),
      )}.sig`;
      expect(decodeJwtPayload(token)).toBeUndefined();
    });
  });
});
