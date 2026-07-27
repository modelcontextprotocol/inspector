import { describe, it, expect } from "vitest";
import { AuthorizationServerMismatchError } from "@modelcontextprotocol/client";
import { findIssuerBindingFailure } from "@inspector/core/auth/issuerBinding.js";

/**
 * Builds a **real** SDK `AuthorizationServerMismatchError`.
 *
 * This must stay the real class rather than a look-alike plain object. The SDK
 * declares `mcpBrand` in a `static {}` block, so it sits on the constructor and
 * is invisible from the instance; a fabricated fixture carrying an own
 * `mcpBrand` property would pass against a classifier that reads
 * `err.mcpBrand` — which no real thrown error would ever satisfy.
 */
function mismatchError(
  recordedIssuer: string,
  currentIssuer: string,
): AuthorizationServerMismatchError {
  return new AuthorizationServerMismatchError(recordedIssuer, currentIssuer);
}

/**
 * Documents why the classifier must not test `err.mcpBrand`: the SDK declares
 * that brand `static`, so it lives on the class and instances never carry it.
 * If a future SDK moves it onto the instance, this fails and the note in
 * `issuerBinding.ts` can be revisited.
 */
describe("SDK brand placement", () => {
  it("keeps `mcpBrand` on the class, not the instance", () => {
    const err = mismatchError("https://a.example.com", "https://b.example.com");
    expect("mcpBrand" in err).toBe(false);
    // The brand is defined at runtime via `Object.defineProperty` in a static
    // block, so it is absent from the SDK's published type declarations — hence
    // the cast to read it.
    const brandOnClass = (
      AuthorizationServerMismatchError as { mcpBrand?: unknown }
    ).mcpBrand;
    expect(brandOnClass).toBe("mcp.AuthorizationServerMismatchError");
  });

  it("matches via `isInstance`, which survives a foreign SDK copy", () => {
    const err = mismatchError("https://a.example.com", "https://b.example.com");
    expect(AuthorizationServerMismatchError.isInstance(err)).toBe(true);
  });
});

/**
 * An error that crossed a serialization boundary: neither the SDK's
 * `Symbol.for()`-keyed brand set nor the prototype survives, but `name` does.
 * This is the fallback arm of the classifier's predicate.
 */
function serializedMismatchError(
  recordedIssuer: string,
  currentIssuer: string,
): Error {
  const err = new Error(
    "Authorization server changed between redirect and callback",
  );
  err.name = "AuthorizationServerMismatchError";
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

  it("ignores a matching error missing the issuer fields", () => {
    const err = new Error("half-shaped");
    err.name = "AuthorizationServerMismatchError";
    expect(findIssuerBindingFailure(err)).toBeUndefined();

    const halfShaped = new Error("only recorded");
    halfShaped.name = "AuthorizationServerMismatchError";
    Object.assign(halfShaped, { recordedIssuer: "https://as.example.com" });
    expect(findIssuerBindingFailure(halfShaped)).toBeUndefined();
  });

  it("classifies a serialized error via the `name` fallback", () => {
    expect(
      findIssuerBindingFailure(
        serializedMismatchError(
          MISSING_STATE_SENTINEL,
          "https://as.example.com",
        ),
      )?.kind,
    ).toBe("lost_authorization_state");
  });

  it("ignores a different SDK error carrying the same fields", () => {
    const err = Object.assign(new Error("other"), {
      recordedIssuer: "https://a.example.com",
      currentIssuer: "https://b.example.com",
    });
    err.name = "IssuerMismatchError";
    expect(findIssuerBindingFailure(err)).toBeUndefined();
  });
});
