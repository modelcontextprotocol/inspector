import { describe, it, expect } from "vitest";
import {
  authRecoveryRestoredMessage,
  authRecoveryRetryFailedMessage,
  authRecoveryAbandonedMessage,
  emaStepUpFailureMessage,
  emaStepUpInProgressMessage,
  emaStepUpSuccessMessage,
  insecureTokenEndpointMessage,
  insecureTokenEndpointTitle,
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
  issuerBindingFailureCopy,
  issuerMismatchMessage,
  issuerMismatchTitle,
  lostAuthorizationStateActionLabel,
  lostAuthorizationStateMessage,
  lostAuthorizationStateTitle,
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

  it("authRecoveryRetryFailedMessage appends only a non-blank detail", () => {
    const base =
      "Could not continue the pending authorization. The Inspector will try again the next time this tab becomes active or the session reconnects.";
    expect(authRecoveryRetryFailedMessage()).toBe(base);
    expect(authRecoveryRetryFailedMessage("   ")).toBe(base);
    expect(authRecoveryRetryFailedMessage(" token endpoint 500 ")).toBe(
      `${base} (token endpoint 500)`,
    );
  });

  it("authRecoveryAbandonedMessage promises no retry", () => {
    const base =
      "Could not continue the pending authorization, and the session it belonged to has ended. Reconnect to authorize again.";
    expect(authRecoveryAbandonedMessage()).toBe(base);
    expect(authRecoveryAbandonedMessage("  ")).toBe(base);
    expect(authRecoveryAbandonedMessage(" nope ")).toBe(`${base} (nope)`);
    expect(authRecoveryAbandonedMessage()).not.toContain("try again");
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

describe("oauthUx issuer-binding copy", () => {
  it("explains lost authorization state in plain language, with the server name", () => {
    const withName = lostAuthorizationStateMessage({ serverName: "svc" });
    expect(withName).toContain('"svc"');
    expect(withName).toContain("was lost");
    expect(withName).toContain("Authorize again");
    // Never leaks the SDK's security-flavoured wording.
    expect(withName).not.toContain("discoveryState");
    expect(withName).not.toContain("AuthorizationServerMismatchError");
    expect(lostAuthorizationStateMessage()).toContain("this server");
    expect(lostAuthorizationStateTitle()).toBe("Authorization state was lost");
    expect(lostAuthorizationStateActionLabel()).toBe("Authorize again");
  });

  it("names both issuers for a genuine mismatch and offers no retry nudge", () => {
    const message = issuerMismatchMessage({
      recordedIssuer: "https://old.example.com",
      currentIssuer: "https://evil.example.com",
      serverName: "svc",
    });
    expect(message).toContain('"svc"');
    expect(message).toContain("https://old.example.com");
    expect(message).toContain("https://evil.example.com");
    expect(message).toContain("was not exchanged");
    expect(message).not.toContain("Authorize again");
    expect(
      issuerMismatchMessage({
        recordedIssuer: "https://old.example.com",
        currentIssuer: "https://evil.example.com",
      }),
    ).toContain("this server");
    expect(issuerMismatchTitle()).toBe("Authorization server mismatch");
  });

  it("bounds an overlong remote-supplied issuer in the mismatch copy", () => {
    const overlong = `https://evil.example.com/${"a".repeat(400)}`;
    const message = issuerMismatchMessage({
      recordedIssuer: "https://old.example.com",
      currentIssuer: overlong,
    });
    expect(message).not.toContain(overlong);
    expect(message).toContain("…");
    // The short issuer on the same call is passed through untouched.
    expect(message).toContain("https://old.example.com");
  });

  it("issuerBindingFailureCopy dispatches on the failure kind", () => {
    expect(
      issuerBindingFailureCopy(
        {
          kind: "lost_authorization_state",
          currentIssuer: "https://as.example.com",
        },
        { serverName: "svc" },
      ),
    ).toEqual({
      title: lostAuthorizationStateTitle(),
      message: lostAuthorizationStateMessage({ serverName: "svc" }),
    });

    expect(
      issuerBindingFailureCopy({
        kind: "issuer_mismatch",
        recordedIssuer: "https://old.example.com",
        currentIssuer: "https://evil.example.com",
      }),
    ).toEqual({
      title: issuerMismatchTitle(),
      message: issuerMismatchMessage({
        recordedIssuer: "https://old.example.com",
        currentIssuer: "https://evil.example.com",
      }),
    });
  });
});

describe("insecureTokenEndpoint copy", () => {
  const ENDPOINT = "http://tenant.example.localhost:3300/api/oauth/token";

  it("names the failure as a configuration problem, not an auth failure", () => {
    expect(insecureTokenEndpointTitle()).toBe("Token endpoint is not secure");
  });

  it("describes the scheme as not-HTTPS rather than as plain HTTP", () => {
    // The SDK's check is `protocol !== "https:"`, so a mistyped `ftp:` or `ws:`
    // endpoint lands here too; naming the wrong scheme would send the reader
    // hunting for a problem they do not have.
    const message = insecureTokenEndpointMessage({
      tokenEndpoint: "ftp://as.example.com/token",
    });
    expect(message).toContain("not HTTPS");
    expect(message).not.toContain("plain HTTP");
  });

  it("names the endpoint, the server, and both ways out", () => {
    const message = insecureTokenEndpointMessage({
      tokenEndpoint: ENDPOINT,
      serverName: "Acme",
    });
    expect(message).toContain('"Acme"');
    expect(message).toContain(ENDPOINT);
    expect(message).toContain("HTTPS");
    expect(message).toContain("127.0.0.1");
    // Bracketed: a bare IPv6 literal is not a legal URL host, so `::1` copied
    // into the Token URL override would not parse.
    expect(message).toContain("[::1]");
    expect(message).toContain("Token URL override");
    // The section name the UI actually renders. Sending someone to a settings
    // section that does not exist is the worst error this message could make.
    expect(message).toContain("OAuth Settings");
    expect(message).not.toContain("Server Settings → Authorization");
  });

  it("does not claim no credentials were sent, which is false on a refresh", () => {
    // The same notice serves mid-session refresh and re-auth, where credentials
    // were legitimately sent earlier in the session. Scope the claim to the
    // request actually refused.
    const message = insecureTokenEndpointMessage({ tokenEndpoint: ENDPOINT });
    expect(message).toContain("without sending this request");
    expect(message).not.toContain("before any credentials were sent");
  });

  it("says a retry cannot help, which is the whole point of the message", () => {
    // The bug this copy fixes (#2280) was a Re-authenticate button that could
    // never succeed. If this sentence goes, the copy stops doing its job.
    expect(insecureTokenEndpointMessage({ tokenEndpoint: ENDPOINT })).toContain(
      "Re-authenticating cannot change this",
    );
  });

  it("falls back to a generic subject with no server name", () => {
    const message = insecureTokenEndpointMessage({ tokenEndpoint: ENDPOINT });
    expect(message).toContain("this server");
    expect(message).not.toContain('""');
  });

  it("bounds a hostile-length endpoint for display", () => {
    // The endpoint is remote-supplied (it comes from the server's AS metadata),
    // so an overlong value must not be echoed back whole into the layout.
    const long = `https://example.com/${"a".repeat(500)}`;
    const message = insecureTokenEndpointMessage({ tokenEndpoint: long });
    expect(message).not.toContain(long);
    expect(message).toContain("…");
  });
});
