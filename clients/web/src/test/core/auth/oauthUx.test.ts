import { describe, it, expect } from "vitest";
import {
  emaStepUpSuccessMessage,
  isEmaStepUp,
  isStepUpConfirmation,
  stepUpAdditionalScopes,
  stepUpConfirmMessage,
  stepUpFollowUpMessage,
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

  it("stepUpConfirmMessage uses organization language for EMA", () => {
    expect(
      stepUpConfirmMessage(challenge, { enterpriseManaged: true }),
    ).toMatch(/organization/i);
    expect(stepUpFollowUpMessage({ enterpriseManaged: true })).toMatch(
      /identity provider/i,
    );
    expect(stepUpModalTitle({ enterpriseManaged: true })).toMatch(
      /organization/i,
    );
    expect(stepUpAuthorizeActionLabel({ enterpriseManaged: true })).toBe(
      "Authorize",
    );
    expect(stepUpAuthorizeActionLabel()).toBe("Authorize (opens browser)");
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

  it("emaStepUpSuccessMessage suggests retry only for command-scoped recovery", () => {
    expect(emaStepUpSuccessMessage()).toBe(
      "Organization permissions were updated.",
    );
    expect(emaStepUpSuccessMessage({ recoverySource: "tool" })).toMatch(
      /Retry your action/,
    );
  });

  it("stepUpAdditionalScopes returns requiredScopes only", () => {
    expect(stepUpAdditionalScopes(challenge)).toEqual(["weather:read"]);
  });
});
