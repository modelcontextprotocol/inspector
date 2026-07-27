import { describe, it, expect } from "vitest";
import {
  isStandardOAuthStepUp,
  isStepUpConfirmation,
  stepUpConfirmMessage,
  stepUpInsufficientScopeMessage,
} from "../src/utils/tuiOAuth.js";
import { makeFakeServerSettings } from "./helpers/oauth-test-fakes.js";

describe("tuiOAuth", () => {
  it("detects standard OAuth step-up", () => {
    expect(
      isStandardOAuthStepUp(
        { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
        makeFakeServerSettings({ enterpriseManaged: false }),
      ),
    ).toBe(true);
    expect(
      isStandardOAuthStepUp(
        { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
        makeFakeServerSettings({ enterpriseManaged: true }),
      ),
    ).toBe(false);
  });

  it("detects EMA step-up confirmation", () => {
    expect(
      isStepUpConfirmation(
        { reason: "insufficient_scope", requiredScopes: ["env:read"] },
        makeFakeServerSettings({ enterpriseManaged: true }),
      ),
    ).toBe(true);
    expect(
      isStepUpConfirmation(
        { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
        makeFakeServerSettings({ enterpriseManaged: false }),
      ),
    ).toBe(true);
  });

  it("formats step-up messages", () => {
    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
      context: { toolName: "get_temp" },
    };
    expect(stepUpConfirmMessage(challenge)).toMatch(/get_temp/);
    expect(stepUpInsufficientScopeMessage(challenge)).toMatch(/get_temp/);
  });
});
