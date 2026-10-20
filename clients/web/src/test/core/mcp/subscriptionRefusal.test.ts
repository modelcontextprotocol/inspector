import { describe, it, expect } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import {
  subscriptionListenRefusal,
  subscriptionListenRefusalMessage,
} from "@inspector/core/mcp/subscriptionRefusal.js";

/**
 * Unit coverage of the HTTP-refusal classification (#2722). The *live* check —
 * that the SDK still surfaces a bare 403 as this error — is the integration
 * test in `inspectorClient-subscriptions-era.test.ts`, which drives a real
 * server refusing `subscriptions/listen`.
 */
describe("subscriptionListenRefusal (#2722)", () => {
  const postError = (status: number, statusText?: string) =>
    new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      "Error POSTing to endpoint: whatever",
      { status, ...(statusText ? { statusText } : {}) },
    );

  it.each([400, 403, 404, 405])("classifies HTTP %i as a refusal", (status) => {
    expect(subscriptionListenRefusal(postError(status, "Nope"))).toEqual({
      status,
      statusText: "Nope",
    });
  });

  it("omits an absent status text", () => {
    expect(subscriptionListenRefusal(postError(403))).toEqual({ status: 403 });
  });

  // The statuses that mean "try again later" stay with the retry machinery.
  it.each([408, 429, 500, 502, 503, 504])(
    "leaves HTTP %i retryable",
    (status) => {
      expect(subscriptionListenRefusal(postError(status))).toBeUndefined();
    },
  );

  // The status alone is not enough: a 403 that went through the auth flow and
  // still failed carries an auth code, and belongs to that flow, not to this.
  it("ignores an auth-coded 403", () => {
    expect(
      subscriptionListenRefusal(
        new SdkHttpError(SdkErrorCode.ClientHttpForbidden, "denied", {
          status: 403,
        }),
      ),
    ).toBeUndefined();
  });

  it("ignores anything that is not an SdkHttpError", () => {
    expect(
      subscriptionListenRefusal(
        new SdkError(SdkErrorCode.ConnectionClosed, "closed"),
      ),
    ).toBeUndefined();
    expect(subscriptionListenRefusal(new Error("socket hang up"))).toBe(
      undefined,
    );
    expect(subscriptionListenRefusal(undefined)).toBeUndefined();
  });
});

describe("subscriptionListenRefusalMessage (#2722)", () => {
  it("names the method, the HTTP status, and that nothing is retried", () => {
    const message = subscriptionListenRefusalMessage({
      status: 403,
      statusText: "Forbidden",
    });
    expect(message).toContain("subscriptions/listen");
    expect(message).toContain("HTTP 403 Forbidden");
    expect(message).toContain("Not retrying");
  });

  it("reads without a status text", () => {
    expect(subscriptionListenRefusalMessage({ status: 405 })).toContain(
      "(HTTP 405)",
    );
  });
});
