import { describe, it, expect } from "vitest";
import { decodeJwtPayload, isJwtFormat } from "@inspector/core/auth/ema/jwt.js";

describe("jwt display helpers", () => {
  const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.";

  it("isJwtFormat accepts three segments", () => {
    expect(isJwtFormat(jwt)).toBe(true);
    expect(isJwtFormat("opaque-token")).toBe(false);
  });

  it("decodeJwtPayload returns header and payload", () => {
    expect(decodeJwtPayload(jwt)).toEqual({
      header: { alg: "none" },
      payload: { sub: "user" },
    });
  });
});
