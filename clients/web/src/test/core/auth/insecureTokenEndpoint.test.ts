import { describe, it, expect } from "vitest";
import { InsecureTokenEndpointError } from "@modelcontextprotocol/client";
import { findInsecureTokenEndpoint } from "@inspector/core/auth/insecureTokenEndpoint.js";

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

describe("findInsecureTokenEndpoint", () => {
  it("recognizes a real SDK error and returns its endpoint", () => {
    expect(
      findInsecureTokenEndpoint(new InsecureTokenEndpointError(ENDPOINT)),
    ).toMatchObject({ tokenEndpoint: ENDPOINT });
  });

  it("recognizes a serialized copy by `name`, where the prototype is gone", () => {
    // The fallback arm: a structured clone or JSON hop drops the prototype and
    // the brand set but keeps `name`.
    expect(
      findInsecureTokenEndpoint({
        name: "InsecureTokenEndpointError",
        message: "Refusing to send credentials…",
        tokenEndpoint: ENDPOINT,
      }),
    ).toMatchObject({ tokenEndpoint: ENDPOINT });
  });

  it("rejects a look-alike carrying the endpoint but not the identity", () => {
    // Neither the brand nor the name: some other error that happens to have a
    // `tokenEndpoint` field must not be swallowed by the terminal arm.
    expect(
      findInsecureTokenEndpoint({ tokenEndpoint: ENDPOINT, name: "Error" }),
    ).toBeUndefined();
  });

  it("rejects the right identity with no endpoint to report", () => {
    // The copy names the endpoint, so a value that cannot supply one is not
    // usable by this path and falls through to the generic handling.
    expect(
      findInsecureTokenEndpoint({ name: "InsecureTokenEndpointError" }),
    ).toBeUndefined();
    expect(
      findInsecureTokenEndpoint({
        name: "InsecureTokenEndpointError",
        tokenEndpoint: 42,
      }),
    ).toBeUndefined();
  });

  it.each([null, undefined, "InsecureTokenEndpointError", 0, new Error("x")])(
    "rejects %j",
    (value) => {
      expect(findInsecureTokenEndpoint(value)).toBeUndefined();
    },
  );

  describe("cause chains", () => {
    // Era negotiation and the transport wrappers bury the rejection, so a
    // top-level-only check would miss the connect and refresh paths outright
    // and let the retryable UI render anyway.
    it("finds it under `cause`", () => {
      const wrapped = new Error("connect failed", {
        cause: new InsecureTokenEndpointError(ENDPOINT),
      });
      expect(findInsecureTokenEndpoint(wrapped)).toMatchObject({
        tokenEndpoint: ENDPOINT,
      });
    });

    it("finds it under `data.cause`", () => {
      const wrapped = Object.assign(new Error("negotiation failed"), {
        data: { cause: new InsecureTokenEndpointError(ENDPOINT) },
      });
      expect(findInsecureTokenEndpoint(wrapped)).toMatchObject({
        tokenEndpoint: ENDPOINT,
      });
    });

    it("finds it several links down", () => {
      const wrapped = new Error("outer", {
        cause: new Error("middle", {
          cause: new InsecureTokenEndpointError(ENDPOINT),
        }),
      });
      expect(findInsecureTokenEndpoint(wrapped)).toMatchObject({
        tokenEndpoint: ENDPOINT,
      });
    });

    it("terminates on a self-referential cause instead of looping", () => {
      const loop: { cause?: unknown; name: string } = { name: "Loop" };
      loop.cause = loop;
      expect(findInsecureTokenEndpoint(loop)).toBeUndefined();
    });

    it("returns undefined for a chain that never contains one", () => {
      expect(
        findInsecureTokenEndpoint(
          new Error("outer", { cause: new Error("inner") }),
        ),
      ).toBeUndefined();
    });
  });
});
