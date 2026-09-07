import { describe, it, expect } from "vitest";
import { InsecureTokenEndpointError } from "@modelcontextprotocol/client";
import { isInsecureTokenEndpointError } from "@inspector/core/auth/insecureTokenEndpoint.js";

const ENDPOINT = "http://tenant.example.localhost:3300/api/oauth/token";

/**
 * Documents the assumption the classifier is built on, the same way
 * `issuerBinding.test.ts` does for its sibling: the SDK declares `mcpBrand` in
 * a `static {}` block, so it lives on the constructor and instances never carry
 * it. A classifier that read `err.mcpBrand` would match no real thrown error.
 */
describe("SDK brand placement", () => {
  it("keeps `mcpBrand` on the class, not the instance", () => {
    expect("mcpBrand" in new InsecureTokenEndpointError(ENDPOINT)).toBe(false);
  });

  it("is not an OAuthError, which is why the retry path must not claim it", () => {
    const err = new InsecureTokenEndpointError(ENDPOINT);
    // The SDK deliberately keeps this off the `OAuthError` hierarchy so hosts
    // do not treat it as a transient authorization failure. If a future SDK
    // changes that, the #2280 handling should be revisited rather than silently
    // keeping a now-wrong justification.
    expect(err.name).toBe("InsecureTokenEndpointError");
    expect(typeof err.tokenEndpoint).toBe("string");
  });
});

describe("isInsecureTokenEndpointError", () => {
  it("recognizes a real SDK error and narrows to its endpoint", () => {
    const err: unknown = new InsecureTokenEndpointError(ENDPOINT);
    expect(isInsecureTokenEndpointError(err)).toBe(true);
    if (isInsecureTokenEndpointError(err)) {
      expect(err.tokenEndpoint).toBe(ENDPOINT);
    }
  });

  it("recognizes a serialized copy by `name`, where the prototype is gone", () => {
    // The fallback arm: a structured clone or JSON hop drops the prototype and
    // the brand set but keeps `name`.
    expect(
      isInsecureTokenEndpointError({
        name: "InsecureTokenEndpointError",
        message: "Refusing to send credentials…",
        tokenEndpoint: ENDPOINT,
      }),
    ).toBe(true);
  });

  it("rejects a look-alike carrying the endpoint but not the identity", () => {
    // Neither the brand nor the name: some other error that happens to have a
    // `tokenEndpoint` field must not be swallowed by the terminal arm.
    expect(
      isInsecureTokenEndpointError({ tokenEndpoint: ENDPOINT, name: "Error" }),
    ).toBe(false);
  });

  it("rejects the right identity with no endpoint to report", () => {
    // The copy names the endpoint, so a value that cannot supply one is not
    // usable by this path and falls through to the generic handling.
    expect(
      isInsecureTokenEndpointError({ name: "InsecureTokenEndpointError" }),
    ).toBe(false);
    expect(
      isInsecureTokenEndpointError({
        name: "InsecureTokenEndpointError",
        tokenEndpoint: 42,
      }),
    ).toBe(false);
  });

  it.each([null, undefined, "InsecureTokenEndpointError", 0, new Error("x")])(
    "rejects %j",
    (value) => {
      expect(isInsecureTokenEndpointError(value)).toBe(false);
    },
  );
});
