import { describe, it, expect } from "vitest";
import {
  findIssuerBindingFailure,
  isLostAuthorizationStateError,
} from "@inspector/core/auth/issuerBinding.js";

/**
 * Builds an object shaped like the SDK's `AuthorizationServerMismatchError`
 * (brand + the two issuer fields). The classifier is intentionally structural,
 * not `instanceof`, so a plain object is the honest fixture here.
 */
function mismatchError(recordedIssuer: string, currentIssuer: string): Error {
  const err = new Error(
    "Authorization server changed between redirect and callback",
  );
  Object.defineProperty(err, "mcpBrand", {
    value: "mcp.AuthorizationServerMismatchError",
  });
  Object.assign(err, { recordedIssuer, currentIssuer });
  return err;
}

const MISSING_STATE_SENTINEL =
  "discoveryState was not available on the callback leg; ensure your provider persists discoveryState alongside codeVerifier";

describe("findIssuerBindingFailure", () => {
  it("classifies the missing-discovery-state sentinel as recoverable", () => {
    const failure = findIssuerBindingFailure(
      mismatchError(MISSING_STATE_SENTINEL, "https://as.example.com"),
    );
    expect(failure).toEqual({
      kind: "lost_authorization_state",
      currentIssuer: "https://as.example.com",
    });
  });

  it("classifies non-URL prose in the recorded slot as recoverable", () => {
    const failure = findIssuerBindingFailure(
      mismatchError("nothing was recorded, sorry", "https://as.example.com"),
    );
    expect(failure?.kind).toBe("lost_authorization_state");
  });

  it("classifies a non-http(s) URL in the recorded slot as recoverable", () => {
    const failure = findIssuerBindingFailure(
      mismatchError("urn:example:not-an-issuer", "https://as.example.com"),
    );
    expect(failure?.kind).toBe("lost_authorization_state");
  });

  it("classifies two real issuers as a genuine mismatch", () => {
    const failure = findIssuerBindingFailure(
      mismatchError("https://old.example.com", "https://evil.example.com"),
    );
    expect(failure).toEqual({
      kind: "issuer_mismatch",
      recordedIssuer: "https://old.example.com",
      currentIssuer: "https://evil.example.com",
    });
  });

  it("accepts a plain http issuer as a genuine mismatch", () => {
    const failure = findIssuerBindingFailure(
      mismatchError("http://localhost:9000", "http://localhost:9001"),
    );
    expect(failure?.kind).toBe("issuer_mismatch");
  });

  it("walks the `cause` chain", () => {
    const wrapped = new Error("negotiation failed", {
      cause: mismatchError(MISSING_STATE_SENTINEL, "https://as.example.com"),
    });
    expect(findIssuerBindingFailure(wrapped)?.kind).toBe(
      "lost_authorization_state",
    );
  });

  it("walks `data.cause` (SdkError wrapper shape)", () => {
    const wrapped = Object.assign(new Error("ERA_NEGOTIATION_FAILED"), {
      data: {
        cause: mismatchError("https://a.example.com", "https://b.example.com"),
      },
    });
    expect(findIssuerBindingFailure(wrapped)?.kind).toBe("issuer_mismatch");
  });

  it("walks multiple levels", () => {
    const wrapped = new Error("outer", {
      cause: new Error("inner", {
        cause: mismatchError(MISSING_STATE_SENTINEL, "https://as.example.com"),
      }),
    });
    expect(findIssuerBindingFailure(wrapped)?.kind).toBe(
      "lost_authorization_state",
    );
  });

  it("ignores a non-object `data`", () => {
    const wrapped = Object.assign(new Error("outer"), { data: "nope" });
    expect(findIssuerBindingFailure(wrapped)).toBeUndefined();
  });

  it("ignores a null `data`", () => {
    const wrapped = Object.assign(new Error("outer"), { data: null });
    expect(findIssuerBindingFailure(wrapped)).toBeUndefined();
  });

  it("terminates on a cyclic cause chain", () => {
    const outer: { cause?: unknown } = new Error("outer");
    outer.cause = outer;
    expect(findIssuerBindingFailure(outer)).toBeUndefined();
  });

  it("returns undefined for unrelated errors and non-objects", () => {
    expect(findIssuerBindingFailure(new Error("boom"))).toBeUndefined();
    expect(findIssuerBindingFailure(undefined)).toBeUndefined();
    expect(findIssuerBindingFailure(null)).toBeUndefined();
    expect(findIssuerBindingFailure("string")).toBeUndefined();
  });

  it("ignores a branded error missing the issuer fields", () => {
    const err = new Error("half-shaped");
    Object.defineProperty(err, "mcpBrand", {
      value: "mcp.AuthorizationServerMismatchError",
    });
    expect(findIssuerBindingFailure(err)).toBeUndefined();

    const halfShaped = new Error("only recorded");
    Object.defineProperty(halfShaped, "mcpBrand", {
      value: "mcp.AuthorizationServerMismatchError",
    });
    Object.assign(halfShaped, { recordedIssuer: "https://as.example.com" });
    expect(findIssuerBindingFailure(halfShaped)).toBeUndefined();
  });

  it("ignores a different SDK brand", () => {
    const err = Object.assign(new Error("other"), {
      mcpBrand: "mcp.IssuerMismatchError",
      recordedIssuer: "https://a.example.com",
      currentIssuer: "https://b.example.com",
    });
    expect(findIssuerBindingFailure(err)).toBeUndefined();
  });
});

describe("isLostAuthorizationStateError", () => {
  it("is true only for the missing-discovery-state case", () => {
    expect(
      isLostAuthorizationStateError(
        mismatchError(MISSING_STATE_SENTINEL, "https://as.example.com"),
      ),
    ).toBe(true);
    expect(
      isLostAuthorizationStateError(
        mismatchError("https://a.example.com", "https://b.example.com"),
      ),
    ).toBe(false);
    expect(isLostAuthorizationStateError(new Error("boom"))).toBe(false);
  });
});
