import { describe, it, expect } from "vitest";
import {
  authRecoveryRestoredMessage,
  isReAuthBannerReason,
  oauthPreRedirectToastCopy,
  oauthResumeSuccessMessage,
  reAuthBannerMessage,
} from "./oauthUx.js";

describe("oauthUx", () => {
  it("returns pre-redirect toast for standard OAuth reauth", () => {
    expect(oauthPreRedirectToastCopy("reauth", { serverName: "srv" })).toEqual({
      title: 'Session expired for "srv"',
      message: "Session expired, re-authenticating…",
    });
  });

  it("returns no pre-redirect toast for connect-time OAuth", () => {
    expect(
      oauthPreRedirectToastCopy("reauth", {
        serverName: "srv",
        context: "connect",
      }),
    ).toBeUndefined();
    expect(
      oauthPreRedirectToastCopy("reauth", {
        serverName: "srv",
        enterpriseManaged: true,
        context: "connect",
      }),
    ).toBeUndefined();
  });

  it("returns pre-redirect toast for EMA reauth", () => {
    expect(
      oauthPreRedirectToastCopy("reauth", {
        serverName: "srv",
        enterpriseManaged: true,
      }),
    ).toEqual({
      title: 'Re-authenticating "srv"',
      message: "Re-authenticating…",
    });
  });

  it("returns pre-redirect toast for step-up", () => {
    expect(oauthPreRedirectToastCopy("step_up", { serverName: "srv" })).toEqual(
      {
        title: 'Step-up authorization for "srv"',
        message: "Redirecting to authorize additional permissions…",
      },
    );
  });

  it("identifies re-auth banner challenge reasons", () => {
    expect(isReAuthBannerReason("unauthorized")).toBe(true);
    expect(isReAuthBannerReason("token_expired")).toBe(true);
    expect(isReAuthBannerReason("invalid_token")).toBe(true);
    expect(isReAuthBannerReason("insufficient_scope")).toBe(false);
  });

  it("builds re-auth banner message", () => {
    expect(
      reAuthBannerMessage({ serverName: "demo", detail: "Sign in again." }),
    ).toBe('Authentication for "demo" needs attention. Sign in again.');
  });

  it("returns success toast copy only for action-triggered recovery", () => {
    expect(
      oauthResumeSuccessMessage("reauth", { recoverySource: "tool" }),
    ).toMatch(/Retry your action/);
    expect(oauthResumeSuccessMessage("reauth")).not.toMatch(
      /Retry your action/,
    );
    expect(authRecoveryRestoredMessage({ recoverySource: "prompt" })).toMatch(
      /Retry your action/,
    );
    expect(authRecoveryRestoredMessage()).not.toMatch(/Retry your action/);
  });
});
