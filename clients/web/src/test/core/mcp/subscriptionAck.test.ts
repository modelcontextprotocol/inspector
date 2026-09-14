import { describe, it, expect } from "vitest";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import {
  isNeverAcknowledgedSubscriptionClose,
  subscriptionFailureMessage,
  NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE,
} from "@inspector/core/mcp/subscriptionAck.js";

/**
 * Unit coverage of the never-acknowledged predicate (#2097). The *live* check —
 * that the SDK still phrases this rejection the way the predicate expects — is
 * the integration test in `inspectorClient-subscriptions-era.test.ts`, which
 * drives a real server answering `subscriptions/listen` with a bare result.
 */
describe("isNeverAcknowledgedSubscriptionClose (#2097)", () => {
  const neverAcknowledged = () =>
    new SdkError(
      SdkErrorCode.ConnectionClosed,
      "subscriptions/listen: server closed the subscription gracefully before acknowledging",
    );

  it("matches the SDK's never-acknowledged close", () => {
    expect(isNeverAcknowledgedSubscriptionClose(neverAcknowledged())).toBe(
      true,
    );
  });

  // The sibling rejection carries the SAME code, which is exactly why the
  // predicate has to read the message: a stream that closed for some other
  // reason before acknowledgement may well succeed on a retry.
  it("does not match a generic pre-ack close", () => {
    expect(
      isNeverAcknowledgedSubscriptionClose(
        new SdkError(
          SdkErrorCode.ConnectionClosed,
          "subscriptions/listen closed before the server acknowledged",
        ),
      ),
    ).toBe(false);
  });

  it("does not match another SDK error code carrying the same words", () => {
    expect(
      isNeverAcknowledgedSubscriptionClose(
        new SdkError(
          SdkErrorCode.RequestTimeout,
          "server closed the subscription gracefully before acknowledging",
        ),
      ),
    ).toBe(false);
  });

  it("does not match a plain Error or a non-error value", () => {
    expect(
      isNeverAcknowledgedSubscriptionClose(
        new Error(
          "server closed the subscription gracefully before acknowledging",
        ),
      ),
    ).toBe(false);
    expect(isNeverAcknowledgedSubscriptionClose(undefined)).toBe(false);
    expect(isNeverAcknowledgedSubscriptionClose("closed")).toBe(false);
  });
});

describe("subscriptionFailureMessage (#2097)", () => {
  it("reports the explanation for the never-acknowledged close", () => {
    expect(
      subscriptionFailureMessage(
        new SdkError(
          SdkErrorCode.ConnectionClosed,
          "subscriptions/listen: server closed the subscription gracefully before acknowledging",
        ),
      ),
    ).toBe(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE);
  });

  // Every other failure keeps its own message — that text is the diagnostic,
  // and replacing it would trade one silence for another.
  it("passes any other failure through unchanged", () => {
    expect(subscriptionFailureMessage(new Error("socket hang up"))).toBe(
      "socket hang up",
    );
    expect(subscriptionFailureMessage("not an Error")).toBe("not an Error");
  });
});

describe("NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE", () => {
  // The whole defect was silence, so the copy has to name the wire event, the
  // rule it broke, and the fact that nothing further will be attempted.
  it("names the notification, the result semantics, and the no-retry decision", () => {
    expect(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE).toContain(
      "notifications/subscriptions/acknowledged",
    );
    expect(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE).toContain(
      "graceful closure",
    );
    expect(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE).toContain("Not retrying");
  });
});
