import { describe, it, expect } from "vitest";
import {
  authRecoveryRestoredMessage,
  emaStepUpFailureMessage,
  emaStepUpInProgressMessage,
  emaStepUpSuccessMessage,
  isActionTriggeredOAuthRecovery,
  isEmaStepUp,
  isReAuthBannerReason,
  isStandardOAuthStepUp,
  isStepUpConfirmation,
  oauthPreRedirectToastCopy,
  oauthResumeAbandonedMessage,
  oauthResumeSuccessMessage,
  reAuthBannerMessage,
  stepUpAdditionalScopes,
  stepUpConfirmMessage,
  stepUpFollowUpMessage,
  stepUpInsufficientScopeMessage,
  stepUpModalTitle,
  stepUpAuthorizeActionLabel,
} from "@inspector/core/auth/oauthUx.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";

describe("oauthUx step-up copy", () => {
  const challenge: AuthChallenge = {
    reason: "insufficient_scope",
    requiredScopes: ["weather:read"],
    authorizationScopes: ["mcp", "tools:read", "weather:read"],
    context: { toolName: "get_temp" },
  };

  it("stepUpConfirmMessage prefers tool context over scope union", () => {
    expect(stepUpConfirmMessage(challenge)).toMatch(/get_temp/);
    expect(stepUpConfirmMessage(challenge)).not.toMatch(/tools:read/);
  });

  it("stepUpConfirmMessage lists only requiredScopes when no tool context", () => {
    expect(
      stepUpConfirmMessage({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
        authorizationScopes: ["mcp", "tools:read", "weather:read"],
      }),
    ).toBe("This operation needs additional scope: weather:read.");
  });

  it("stepUpConfirmMessage uses plural label and organization language for multiple EMA scopes", () => {
    expect(
      stepUpConfirmMessage(
        {
          reason: "insufficient_scope",
          requiredScopes: ["weather:read", "weather:write"],
        },
        { enterpriseManaged: true },
      ),
    ).toBe(
      "This operation needs additional organization scopes: weather:read, weather:write.",
    );
  });

  it("stepUpConfirmMessage uses plural label for multiple standard scopes", () => {
    expect(
      stepUpConfirmMessage({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read", "weather:write"],
      }),
    ).toBe(
      "This operation needs additional scopes: weather:read, weather:write.",
    );
  });

  it("stepUpConfirmMessage falls back to generic standard copy with no tool or scopes", () => {
    expect(stepUpConfirmMessage({ reason: "insufficient_scope" })).toBe(
      "This operation needs additional OAuth scopes before it can continue.",
    );
  });

  it("stepUpConfirmMessage falls back to generic EMA copy with no tool or scopes", () => {
    expect(
      stepUpConfirmMessage(
        { reason: "insufficient_scope", requiredScopes: ["", ""] },
        { enterpriseManaged: true },
      ),
    ).toBe(
      "This operation needs additional permissions from your organization before it can continue.",
    );
  });

  it("stepUpConfirmMessage uses organization language for EMA", () => {
    expect(
      stepUpConfirmMessage(challenge, { enterpriseManaged: true }),
    ).toMatch(/organization/i);
    expect(stepUpFollowUpMessage({ enterpriseManaged: true })).toMatch(
      /identity provider/i,
    );
    expect(stepUpFollowUpMessage()).toMatch(/redirected to authorize/i);
    expect(stepUpModalTitle({ enterpriseManaged: true })).toMatch(
      /organization/i,
    );
    expect(stepUpModalTitle()).toBe("Additional permissions required");
    expect(stepUpAuthorizeActionLabel({ enterpriseManaged: true })).toBe(
      "Authorize",
    );
    expect(stepUpAuthorizeActionLabel()).toBe("Authorize (opens browser)");
  });

  it("isStandardOAuthStepUp is true only for non-EMA insufficient_scope", () => {
    expect(isStandardOAuthStepUp(challenge)).toBe(true);
    expect(isStandardOAuthStepUp(challenge, { enterpriseManaged: true })).toBe(
      false,
    );
    expect(isStandardOAuthStepUp({ reason: "token_expired" })).toBe(false);
  });

  it("isStepUpConfirmation covers standard OAuth and EMA insufficient_scope", () => {
    expect(isStepUpConfirmation(challenge)).toBe(true);
    expect(isStepUpConfirmation(challenge, { enterpriseManaged: true })).toBe(
      true,
    );
    expect(isEmaStepUp(challenge, { enterpriseManaged: true })).toBe(true);
    expect(isEmaStepUp(challenge)).toBe(false);
    expect(
      isStepUpConfirmation(
        { reason: "token_expired" },
        {
          enterpriseManaged: true,
        },
      ),
    ).toBe(false);
  });

  it("emaStepUpInProgressMessage describes requesting organization permissions", () => {
    expect(emaStepUpInProgressMessage()).toMatch(/organization/i);
  });

  it("emaStepUpSuccessMessage suggests retry only for command-scoped recovery", () => {
    expect(emaStepUpSuccessMessage()).toBe(
      "Organization permissions were updated.",
    );
    expect(emaStepUpSuccessMessage({ recoverySource: "tool" })).toMatch(
      /Retry your action/,
    );
  });

  it("emaStepUpFailureMessage returns detail when present, else generic copy", () => {
    expect(emaStepUpFailureMessage("boom")).toBe("boom");
    expect(emaStepUpFailureMessage("   ")).toBe(
      "Could not obtain the additional permissions from your organization.",
    );
    expect(emaStepUpFailureMessage()).toBe(
      "Could not obtain the additional permissions from your organization.",
    );
  });

  it("stepUpAdditionalScopes returns requiredScopes only", () => {
    expect(stepUpAdditionalScopes(challenge)).toEqual(["weather:read"]);
  });

  it("stepUpAdditionalScopes returns empty array when requiredScopes undefined", () => {
    expect(stepUpAdditionalScopes({ reason: "insufficient_scope" })).toEqual(
      [],
    );
  });
});

describe("oauthUx recovery-source predicates", () => {
  it("isActionTriggeredOAuthRecovery is true for action sources, false otherwise", () => {
    for (const source of ["tool", "prompt", "resource", "app"] as const) {
      expect(isActionTriggeredOAuthRecovery(source)).toBe(true);
    }
    expect(isActionTriggeredOAuthRecovery("ambient")).toBe(false);
    expect(isActionTriggeredOAuthRecovery(undefined)).toBe(false);
  });
});

describe("oauthUx resume/restore copy", () => {
  it("oauthResumeSuccessMessage step_up varies with retry", () => {
    expect(
      oauthResumeSuccessMessage("step_up", { recoverySource: "tool" }),
    ).toBe("Step-up authorization succeeded. Retry your action.");
    expect(oauthResumeSuccessMessage("step_up")).toBe(
      "Step-up authorization succeeded.",
    );
  });

  it("oauthResumeSuccessMessage reauth varies with retry", () => {
    expect(
      oauthResumeSuccessMessage("reauth", { recoverySource: "prompt" }),
    ).toBe("Authentication succeeded. Retry your action.");
    expect(oauthResumeSuccessMessage("reauth")).toBe(
      "Authentication succeeded.",
    );
  });

  it("authRecoveryRestoredMessage varies with retry", () => {
    expect(authRecoveryRestoredMessage({ recoverySource: "resource" })).toBe(
      "Session credentials were updated. Retry your action.",
    );
    expect(authRecoveryRestoredMessage()).toBe(
      "Session credentials were updated.",
    );
  });

  it("oauthResumeAbandonedMessage reauth is retry-agnostic", () => {
    expect(
      oauthResumeAbandonedMessage("reauth", { recoverySource: "tool" }),
    ).toBe("Sign-in was not completed. Re-authenticate to restore access.");
    expect(oauthResumeAbandonedMessage("reauth")).toBe(
      "Sign-in was not completed. Re-authenticate to restore access.",
    );
  });

  it("oauthResumeAbandonedMessage step_up varies with retry", () => {
    expect(
      oauthResumeAbandonedMessage("step_up", { recoverySource: "app" }),
    ).toBe("Step-up authorization was not completed. Retry your action.");
    expect(oauthResumeAbandonedMessage("step_up")).toBe(
      "Step-up authorization was not completed.",
    );
  });
});

describe("oauthUx insufficient-scope resolution copy", () => {
  it("prefers tool context", () => {
    expect(
      stepUpInsufficientScopeMessage({
        reason: "insufficient_scope",
        context: { toolName: "get_temp" },
      }),
    ).toMatch(/tool "get_temp"/);
  });

  it("uses authorizationScopes when present and no tool", () => {
    expect(
      stepUpInsufficientScopeMessage({
        reason: "insufficient_scope",
        authorizationScopes: ["a", "b"],
        requiredScopes: ["c"],
      }),
    ).toBe(
      "Authorization completed, but required scopes were not granted (a, b). Grant the requested permissions on the authorization server, then retry your action.",
    );
  });

  it("falls back to requiredScopes when authorizationScopes absent", () => {
    expect(
      stepUpInsufficientScopeMessage({
        reason: "insufficient_scope",
        requiredScopes: ["c"],
      }),
    ).toMatch(/\(c\)/);
  });

  it("uses generic copy when no tool or scopes", () => {
    expect(
      stepUpInsufficientScopeMessage({ reason: "insufficient_scope" }),
    ).toBe(
      "Authorization completed, but the required permissions were not granted. Grant the requested scopes on the authorization server, then retry your action.",
    );
  });
});

describe("oauthUx pre-redirect toast copy", () => {
  it("returns undefined for a fresh connect handshake", () => {
    expect(
      oauthPreRedirectToastCopy("reauth", { context: "connect" }),
    ).toBeUndefined();
  });

  it("step_up toast includes server name when provided", () => {
    expect(oauthPreRedirectToastCopy("step_up", { serverName: "svc" })).toEqual(
      {
        title: 'Step-up authorization for "svc"',
        message: "Redirecting to authorize additional permissions…",
      },
    );
    expect(oauthPreRedirectToastCopy("step_up", {})).toEqual({
      title: "Step-up authorization",
      message: "Redirecting to authorize additional permissions…",
    });
  });

  it("enterprise-managed reauth toast re-authenticates", () => {
    expect(
      oauthPreRedirectToastCopy("reauth", {
        serverName: "svc",
        enterpriseManaged: true,
      }),
    ).toEqual({
      title: 'Re-authenticating "svc"',
      message: "Re-authenticating…",
    });
    expect(
      oauthPreRedirectToastCopy("reauth", { enterpriseManaged: true }),
    ).toEqual({ title: "Re-authenticating", message: "Re-authenticating…" });
  });

  it("default reauth toast signals an expired session", () => {
    expect(oauthPreRedirectToastCopy("reauth", { serverName: "svc" })).toEqual({
      title: 'Session expired for "svc"',
      message: "Session expired, re-authenticating…",
    });
    expect(oauthPreRedirectToastCopy("reauth", {})).toEqual({
      title: "Session expired",
      message: "Session expired, re-authenticating…",
    });
  });
});

describe("oauthUx re-auth banner", () => {
  it("isReAuthBannerReason is true for degraded-session reasons", () => {
    for (const reason of [
      "token_expired",
      "unauthorized",
      "invalid_token",
    ] as const) {
      expect(isReAuthBannerReason(reason)).toBe(true);
    }
    expect(isReAuthBannerReason("insufficient_scope")).toBe(false);
    expect(isReAuthBannerReason(undefined)).toBe(false);
  });

  it("reAuthBannerMessage varies with server name and detail", () => {
    expect(
      reAuthBannerMessage({ serverName: "svc", detail: "Token expired." }),
    ).toBe('Authentication for "svc" needs attention. Token expired.');
    expect(reAuthBannerMessage({ serverName: "svc" })).toBe(
      'Authentication for "svc" needs attention.',
    );
    expect(reAuthBannerMessage({ detail: "Token expired." })).toBe(
      "Authentication needs attention. Token expired.",
    );
    expect(reAuthBannerMessage({})).toBe("Authentication needs attention.");
  });
});
